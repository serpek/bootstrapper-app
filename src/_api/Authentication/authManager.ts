import { createID } from '@bipweb/utils'
import { Cron } from 'croner'
import { BehaviorSubject, fromEvent, merge, Subject, takeUntil } from 'rxjs'

import { LogServiceImpl } from '../Logger'

import { MessageBuilder, MessageBuilderOptions } from './messageBuilder'
import { MessageHandler } from './messageHandler'
import {
  BwType,
  InboundBwType,
  isInboundBwType,
  Message,
  OutboundBwType,
  QrMessage,
  SessionContext,
  SessionUpdateReason,
  Status,
  TokenMessage
} from './types'

const log = LogServiceImpl.instance.create({ name: 'AuthManager' })
const channel = new BroadcastChannel('auth-manager')
const guid = createID()

export interface AuthManagerOptions {
  maxReconnectAttempts?: number
  baseReconnectDelayMs?: number
  pingIntervalSec?: number
  pingTimeoutMs?: number
  singleSessionEnforced?: boolean
  tokenStorageKey?: string
  useCronForPing?: boolean
  messageHandler?: MessageHandler // DI imkanı
  messageBuilder?: MessageBuilder // DI imkanı
  messageBuilderOptions?: MessageBuilderOptions
  autoConnect?: boolean
  persistToken?: boolean // localStorage kullanımını aç/kapat
}

export class AuthManager {
  private connectionDestroy$ = new Subject<void>()
  private globalDestroy$ = new Subject<void>()
  private socket: WebSocket | null = null
  private pingScheduler: Cron | null = null
  private pingIntervalId: ReturnType<typeof setInterval> | null = null
  private pingTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private isManualClose = false
  private lastPongAt: number | null = null
  private sessionInfo: SessionContext = {
    status: Status.INIT,
    index: 0,
    socket: -1,
    token: undefined,
    qr: undefined,
    msisdn: undefined,
    lastUpdate: Date.now(),
    guid,
    lastReason: null
  }
  public readonly sessionInfo$ = new BehaviorSubject<SessionContext>(
    this.sessionInfo
  )
  private readonly url: string
  private readonly maxReconnectAttempts: number
  private readonly baseReconnectDelay: number
  private readonly pingIntervalSec: number
  private readonly pingTimeoutMs: number
  private readonly singleSessionEnforced: boolean
  private readonly tokenStorageKey: string
  private readonly useCronForPing: boolean
  private readonly persistToken: boolean
  private readonly messageBuilder: MessageBuilder
  private readonly messageHandler: MessageHandler

  constructor(url: string, opts: AuthManagerOptions = {}) {
    this.url = url
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 10
    this.baseReconnectDelay = opts.baseReconnectDelayMs ?? 5000
    this.pingIntervalSec = opts.pingIntervalSec ?? 5
    this.pingTimeoutMs = opts.pingTimeoutMs ?? 30000
    this.singleSessionEnforced = opts.singleSessionEnforced ?? true
    this.tokenStorageKey = opts.tokenStorageKey ?? 'myKey'
    this.useCronForPing = opts.useCronForPing ?? true
    this.persistToken = opts.persistToken ?? true
    this.messageBuilder =
      opts.messageBuilder ?? new MessageBuilder(opts.messageBuilderOptions)
    this.messageHandler = opts.messageHandler ?? new MessageHandler()

    if (opts.autoConnect) {
      this.connect()
    }
  }

  get isOpened(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  get readyState(): number {
    return this.socket?.readyState ?? -1
  }

  connect(): void {
    if (this.isConnectingOrOpen()) {
      log.warn('Connection already in progress or open')
      return
    }

    this.connectionDestroy$.next()
    this.connectionDestroy$.complete()
    this.connectionDestroy$ = new Subject<void>()

    this.socket = new WebSocket(`${this.url}?t=${Date.now()}`)
    const sock = this.socket

    merge(
      fromEvent(sock, 'open'),
      fromEvent(sock, 'close'),
      fromEvent(sock, 'message'),
      fromEvent(sock, 'error')
    )
      .pipe(takeUntil(this.connectionDestroy$), takeUntil(this.globalDestroy$))
      .subscribe(this.handleSocketEvent.bind(this))

    if (this.singleSessionEnforced) {
      fromEvent<MessageEvent<SessionContext>>(channel, 'message')
        .pipe(
          takeUntil(this.connectionDestroy$),
          takeUntil(this.globalDestroy$)
        )
        .subscribe((event) => {
          if (event.data.guid !== this.sessionInfo.guid) {
            log.warn('Another session detected, closing this one')
            this.close()
          }
        })
    }

    this.updateSessionContext({ status: Status.AUTHORIZING }, 'CONNECT_START')
  }

  send(message: Message<OutboundBwType>): void {
    if (this.isOpened && this.socket) {
      try {
        this.socket.send(JSON.stringify(message))
        log.debug('Message sent', { bwType: message.bw, id: message.id })
      } catch (err) {
        log.error('Failed to send message', { err })
      }
    } else {
      log.warn('Attempted to send while socket not open', {
        bwType: message.bw
      })
    }
  }

  logout(): void {
    if (this.sessionInfo.token) {
      this.send(this.messageBuilder.Logout(this.sessionInfo.token))
      this.updateSessionContext({}, 'LOGOUT_REQUESTED')
      log.info('Logout initiated')
    } else {
      log.warn('No token present for logout')
    }
  }

  close(): void {
    this.isManualClose = true
    this.teardownConnection('MANUAL_CLOSE')
    log.info('Connection manually closed')
  }

  dispose(): void {
    this.isManualClose = true
    this.teardownConnection('MANUAL_CLOSE')
    this.globalDestroy$.next()
    this.globalDestroy$.complete()
    channel.close()
    this.sessionInfo$.complete()
  }

  reconnect(): void {
    if (!this.isManualClose) {
      this.teardownConnection('CLEANUP', false)
      this.connect()
    }
  }

  // ---------- Internal Handlers ----------

  private handleSocketEvent(event: Event): void {
    switch (event.type) {
      case 'open':
        this.handleOpen()
        break
      case 'close':
        this.handleClose(event as CloseEvent)
        break
      case 'message':
        this.handleMessage(event as MessageEvent)
        break
      case 'error':
        this.handleError(event as Event)
        break
    }
  }

  private handleOpen(): void {
    log.info('WebSocket connection established')
    this.isManualClose = false
    this.reconnectAttempts = 0

    const token = this.persistToken
      ? localStorage.getItem(this.tokenStorageKey)
      : this.sessionInfo.token

    if (token) {
      this.send(this.messageBuilder.Reconnect(token))
      this.updateSessionContext({ token }, 'RECONNECT_MESSAGE_SENT')
    } else {
      this.send(this.messageBuilder.Init())
      this.updateSessionContext({ token: undefined }, 'INIT_MESSAGE_SENT')
    }

    this.startPingCycle()

    channel.postMessage(this.sessionInfo)
  }

  private handleClose(event: CloseEvent): void {
    log.info('Connection closed', { code: event.code, reason: event.reason })
    this.teardownConnection('SOCKET_CLOSE', false)

    if (!this.isManualClose) {
      this.attemptReconnect()
    } else {
      this.updateSessionContext({ status: Status.INIT }, 'STATUS_RESET')
    }
  }

  private handleMessage(event: MessageEvent): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(event.data)
    } catch (error) {
      log.error('Invalid JSON message', { error, data: event.data })
      return
    }

    const message = parsed as Message<BwType>
    if (!message || typeof message.bw !== 'string') {
      log.warn('Malformed message shape', parsed)
      return
    }

    if (isInboundBwType(message.bw)) {
      this.processInbound(message as Message<InboundBwType>)
    } else {
      log.warn('Unknown message direction / bwType', { bw: message.bw })
    }
  }

  private handleError(event: Event): void {
    log.error('WebSocket error occurred', { event })
  }

  // ---------- Inbound Processing ----------

  private processInbound(message: Message<InboundBwType>): void {
    log.debug('Inbound message', { bw: message.bw, id: message.id })

    switch (message.bw) {
      case 'qr': {
        const qrMsg = message as QrMessage
        this.updateSessionContext(
          {
            qr: qrMsg.qr,
            status: Status.QR
          },
          'INBOUND_QR'
        )
        break
      }
      case 'token': {
        const tokenMessage = message as TokenMessage
        this.updateSessionContext(
          {
            qr: undefined,
            token: tokenMessage.apikey,
            keys: { mobile: tokenMessage.mobileIdentityKey },
            status: Status.AUTHORIZED
          },
          'INBOUND_TOKEN'
        )
        if (this.persistToken) {
          try {
            localStorage.setItem(this.tokenStorageKey, tokenMessage.apikey)
            this.updateSessionContext({}, 'TOKEN_PERSISTED')
          } catch (e) {
            log.warn('Failed to persist token', { e })
          }
        }
        break
      }
      case 'pong': {
        this.lastPongAt = Date.now()
        this.clearPingTimeout()
        this.updateSessionContext({}, 'PONG_RECEIVED')
        break
      }
      case 'error':
        console.error('Error Message processed:', message)
        break
      case 'logout':
        console.log('Logout Message processed:', message)
        break
      case 'online':
        console.log('Online Message processed:', message)
        break
      case 'offline':
        console.log('Offline Message processed:', message)
        break
      case 'mobilestatus':
        console.log('Mobile Status Message processed:', message)
        break
      case 'userstatus':
        console.log('User Status Message processed:', message)
        break
      case 'statistics':
        console.log('Statistics Message processed:', message)
        break
      default:
        this.messageHandler.handleMessage(message)
    }
  }

  // ---------- Ping / Pong ----------

  private startPingCycle(): void {
    this.stopPingCycle()

    if (this.useCronForPing) {
      this.pingScheduler = new Cron(
        `*/${this.pingIntervalSec} * * * * *`,
        () => {
          this.sendPing()
        }
      )
    } else {
      this.pingIntervalId = setInterval(() => {
        this.sendPing()
      }, this.pingIntervalSec * 1000)
    }
  }

  private sendPing(): void {
    if (!this.isOpened) {
      this.stopPingCycle()
      return
    }
    this.send(this.messageBuilder.Ping())
    this.clearPingTimeout()
    this.pingTimeout = setTimeout(() => {
      const lastPongAge = this.lastPongAt ? Date.now() - this.lastPongAt : null
      log.error('Ping timeout - no pong received', { lastPongAge })
      this.updateSessionContext({}, 'PING_TIMEOUT')
      this.teardownConnection('PING_TIMEOUT', false)
      this.attemptReconnect()
    }, this.pingTimeoutMs)
  }

  private stopPingCycle(): void {
    this.pingScheduler?.stop()
    this.pingScheduler = null
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId)
      this.pingIntervalId = null
    }
    this.clearPingTimeout()
  }

  private clearPingTimeout(): void {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout)
      this.pingTimeout = null
    }
  }

  // ---------- Reconnect Strategy ----------

  private attemptReconnect(): void {
    if (this.isManualClose) return

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.calculateReconnectDelay()
      const nextAttempt = this.reconnectAttempts + 1
      log.info(`Reconnect attempt ${nextAttempt} in ${delay}ms`)
      this.updateSessionContext({}, 'RECONNECT_ATTEMPT')
      setTimeout(() => {
        if (this.isManualClose) return
        this.reconnectAttempts++
        this.updateSessionContext({ status: Status.AUTHORIZING }, 'AUTHORIZING')
        this.connect()
      }, delay)
    } else {
      log.error('Maximum reconnect attempts reached')
      this.updateSessionContext(
        { status: Status.UNAUTHORIZED },
        'RECONNECT_GIVE_UP'
      )
    }
  }

  private calculateReconnectDelay(): number {
    const cap = 30000
    const exp = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      cap
    )
    return Math.floor(Math.random() * exp)
  }

  // ---------- Teardown ----------

  private teardownConnection(
    reason: SessionUpdateReason,
    updateStatus = true
  ): void {
    this.stopPingCycle()
    this.connectionDestroy$.next()
    this.connectionDestroy$.complete()
    this.connectionDestroy$ = new Subject<void>()

    if (this.socket) {
      try {
        this.socket.close()
      } catch (e) {
        log.debug('Socket close error ignored', { e })
      }
      this.socket = null
    }

    if (updateStatus) {
      this.updateSessionContext(
        { qr: undefined, status: Status.INIT },
        reason === 'MANUAL_CLOSE' ? reason : 'STATUS_RESET'
      )
    } else {
      this.updateSessionContext({}, reason)
    }
  }

  // ---------- Session & Helpers ----------

  private updateSessionContext(
    updates: Partial<SessionContext>,
    reason: SessionUpdateReason
  ): void {
    this.sessionInfo = {
      ...this.sessionInfo,
      ...updates,
      socket: this.readyState,
      lastUpdate: Date.now(),
      lastReason: reason
    }
    this.sessionInfo$.next(this.sessionInfo)
  }

  private isConnectingOrOpen(): boolean {
    return (
      this.readyState === WebSocket.CONNECTING ||
      this.readyState === WebSocket.OPEN
    )
  }
}
