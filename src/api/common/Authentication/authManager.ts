import { Cron } from 'croner'
import { BehaviorSubject, fromEvent, merge, Subject, takeUntil } from 'rxjs'
import { inject, singleton } from 'tsyringe'

import { dependsOn } from '@bipweb/core'
import { createID } from '@bipweb/utils'

import type { ILogService } from '../Logger'

import { MessageBuilder } from './messageBuilder'
import { MessageHandler } from './messageHandler'
import {
  AuthManagerConfig,
  BwType,
  IAuthManager,
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

const channel = new BroadcastChannel('auth-manager')
const guid = createID()
const DEFAULT_CFG: Required<
  Omit<
    AuthManagerConfig,
    | 'logger'
    | 'loggerOptions'
    | 'messageHandler'
    | 'messageBuilder'
    | 'messageBuilderOptions'
  >
> = {
  url: '',
  maxReconnectAttempts: 10,
  baseReconnectDelay: 5000,
  pingIntervalSec: 5,
  pingTimeoutMs: 30000,
  singleSessionEnforced: true,
  tokenStorageKey: 'myKey',
  useCronForPing: true,
  persistToken: true,
  autoConnect: false
}

@dependsOn('LogService')
@singleton()
export class AuthManager implements IAuthManager {
  public isInitialized: boolean = false
  private readonly _name: string = 'AuthManager'
  private _logger: ILogService<any>
  private config!: typeof DEFAULT_CFG
  // private logger!: Logger<ILogObj>
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
  // private url!: string
  // private maxReconnectAttempts!: number
  // private baseReconnectDelay!: number
  // private pingIntervalSec!: number
  // private pingTimeoutMs!: number
  // private singleSessionEnforced!: boolean
  // private tokenStorageKey!: string
  // private useCronForPing!: boolean
  // private persistToken!: boolean
  private messageBuilder!: MessageBuilder
  private messageHandler!: MessageHandler

  constructor(@inject('LogService') private logger: ILogService<any>) {
    this._logger = this.logger.create({
      name: this._name
    })
    this._logger.init(`${this._name} created...`)
  }

  get isOpened(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  get readyState(): number {
    return this.socket?.readyState ?? -1
  }

  init(): void {
    if (!this.isInitialized) {
      this.isInitialized = true
      // this._logger.debug(`${this._name} initialized`)
      //await sleep(1000)
    }
  }

  configure(config: AuthManagerConfig): void {
    this.config = { ...DEFAULT_CFG, ...config }
    // if (config.logger) {
    //   this.logger = config.logger
    // } else {
    //   this.logger = new Logger<ILogObj>({
    //     name: 'AuthManager',
    //     ...config.loggerOptions
    //   })
    // }

    this.messageBuilder =
      config.messageBuilder ?? new MessageBuilder(config.messageBuilderOptions)
    this.messageHandler = config.messageHandler ?? new MessageHandler()

    if (config.autoConnect) {
      this.connect()
    }
  }

  connect(): void {
    if (this.isConnectingOrOpen()) {
      this._logger.warn('Connection already in progress or open')
      return
    }

    this.connectionDestroy$.next()
    this.connectionDestroy$.complete()
    this.connectionDestroy$ = new Subject<void>()

    this.socket = new WebSocket(`${this.config.url}?t=${Date.now()}`)
    const sock = this.socket

    merge(
      fromEvent(sock, 'open'),
      fromEvent(sock, 'close'),
      fromEvent(sock, 'message'),
      fromEvent(sock, 'error')
    )
      .pipe(takeUntil(this.connectionDestroy$), takeUntil(this.globalDestroy$))
      .subscribe(this.handleSocketEvent.bind(this))

    if (this.config.singleSessionEnforced) {
      fromEvent<MessageEvent<SessionContext>>(channel, 'message')
        .pipe(
          takeUntil(this.connectionDestroy$),
          takeUntil(this.globalDestroy$)
        )
        .subscribe((event) => {
          if (event.data.guid !== this.sessionInfo.guid) {
            this._logger.warn('Another session detected, closing this one')
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
        this._logger.debug('Message sent', {
          bwType: message.bw,
          id: message.id
        })
      } catch (err) {
        this._logger.error('Failed to send message', { err })
      }
    } else {
      this._logger.warn('Attempted to send while socket not open', {
        bwType: message.bw
      })
    }
  }

  logout(): void {
    if (this.sessionInfo.token) {
      this.send(this.messageBuilder.Logout(this.sessionInfo.token))
      this.updateSessionContext({}, 'LOGOUT_REQUESTED')
      this._logger.info('Logout initiated')
    } else {
      this._logger.warn('No token present for logout')
    }
  }

  close(): void {
    this.isManualClose = true
    this.teardownConnection('MANUAL_CLOSE')
    this._logger.info('Connection manually closed')
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
    this._logger.info('WebSocket connection established')
    this.isManualClose = false
    this.reconnectAttempts = 0

    const token = this.config.persistToken
      ? localStorage.getItem(this.config.tokenStorageKey)
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
    this._logger.info('Connection closed', {
      code: event.code,
      reason: event.reason
    })
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
      this._logger.error('Invalid JSON message', { error, data: event.data })
      return
    }

    const message = parsed as Message<BwType>
    if (!message || typeof message.bw !== 'string') {
      this._logger.warn('Malformed message shape', parsed)
      return
    }

    if (isInboundBwType(message.bw)) {
      this.processInbound(message as Message<InboundBwType>)
    } else {
      this._logger.warn('Unknown message direction / bwType', {
        bw: message.bw
      })
    }
  }

  private handleError(event: Event): void {
    this._logger.error('WebSocket error occurred', { event })
  }

  // ---------- Inbound Processing ----------

  private processInbound(message: Message<InboundBwType>): void {
    this._logger.debug('Inbound message', { bw: message.bw, id: message.id })

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
        if (this.config.persistToken) {
          try {
            localStorage.setItem(
              this.config.tokenStorageKey,
              tokenMessage.apikey
            )
            this.updateSessionContext({}, 'TOKEN_PERSISTED')
          } catch (e) {
            this._logger.warn('Failed to persist token', { e })
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

    if (this.config.useCronForPing) {
      this.pingScheduler = new Cron(
        `*/${this.config.pingIntervalSec} * * * * *`,
        () => {
          this.sendPing()
        }
      )
    } else {
      this.pingIntervalId = setInterval(() => {
        this.sendPing()
      }, this.config.pingIntervalSec * 1000)
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
      this._logger.error('Ping timeout - no pong received', { lastPongAge })
      this.updateSessionContext({}, 'PING_TIMEOUT')
      this.teardownConnection('PING_TIMEOUT', false)
      this.attemptReconnect()
    }, this.config.pingTimeoutMs)
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

    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      const delay = this.calculateReconnectDelay()
      const nextAttempt = this.reconnectAttempts + 1
      this._logger.info(`Reconnect attempt ${nextAttempt} in ${delay}ms`)
      this.updateSessionContext({}, 'RECONNECT_ATTEMPT')
      setTimeout(() => {
        if (this.isManualClose) return
        this.reconnectAttempts++
        this.updateSessionContext({ status: Status.AUTHORIZING }, 'AUTHORIZING')
        this.connect()
      }, delay)
    } else {
      this._logger.error('Maximum reconnect attempts reached')
      this.updateSessionContext(
        { status: Status.UNAUTHORIZED },
        'RECONNECT_GIVE_UP'
      )
    }
  }

  private calculateReconnectDelay(): number {
    const cap = 30000
    const exp = Math.min(
      this.config.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
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
        this._logger.debug('Socket close error ignored', { e })
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
