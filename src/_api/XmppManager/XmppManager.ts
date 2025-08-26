/* Tüm metotlara kapsamlı JSDoc eklenmiş sürüm - connection tipi 'any' KALDIRILDI */
import { BehaviorSubject, Subject } from 'rxjs'
import { auditTime } from 'rxjs/operators'
import { Strophe } from 'strophe.js'
import { ILogObj, Logger } from 'tslog'

import { calculateBackoffDelay } from './backoff'
import { OutboundQueue } from './OutboundQueue'
import {
  ConnectionState,
  ConnectionStateInfo,
  GiveupQueueSnapshot,
  HealthMetrics,
  IQueueMetricsSink,
  IXmppConnectionManager,
  OutboundQueueSnapshot,
  OutboundSendOptions,
  StanzaEnvelope,
  XmppConfig,
  XmppErrorEvent
} from './types'

/**
 * Kullandığımız Strophe.Connection API'sinin uygulamada ihtiyaç duyulan asgari arayüzü.
 * Eğer projede @types / resmi tipler mevcutsa bu interface'i güncelleyebilir / kaldırabilirsiniz.
 */
interface IStropheConnection {
  connect(
    jid: string,
    password: string,
    callback: (status: number, error?: any) => void,
    wait?: number,
    hold?: number
  ): void

  disconnect(reason?: string): void

  send(elem: Element): void

  addHandler(
    handler: (stanza: Element) => boolean,
    ns: string | null,
    name: string | null,
    type: string | null,
    id: string | null,
    from: string | null
  ): unknown
}

/**
 * İç bağlantı kontrol bayrakları.
 */
interface InternalFlags {
  intentionalDisconnect: boolean
  reconnectTimer?: ReturnType<typeof setTimeout>
  connectTimeoutTimer?: ReturnType<typeof setTimeout>
  currentAttempt: number
  networkOnline: boolean
  connectingPromise?: {
    resolve: () => void
    reject: (err: any) => void
  }
}

/**
 * XMPP bağlantı yönetimi + metrik + outbound kuyruk entegrasyon sınıfı.
 */
export class XmppManager implements IXmppConnectionManager {
  /** Metrik akışı (opsiyonel throttle). */
  public readonly metrics$
  /** Outbound kuyruk event akışı. */
  public readonly outboundQueueEvents$
  /**
   * İmmutable konfigürasyon.
   */
  private readonly cfg: XmppConfig
  /**
   * Altyapı Strophe connection örneği (lazy oluşturulur).
   */
  // private connection?: IStropheConnection
  private connection?: IStropheConnection
  private flags: InternalFlags = {
    intentionalDisconnect: false,
    currentAttempt: 0,
    networkOnline: true
  }
  private readonly connectionStateSubject =
    new BehaviorSubject<ConnectionStateInfo>({
      state: 'idle',
      timestamp: Date.now()
    })
  /** Bağlantı durum akışı. */
  public readonly connectionState$ = this.connectionStateSubject.asObservable()
  private readonly errorSubject = new Subject<XmppErrorEvent>()
  /** Hata akışı. */
  public readonly error$ = this.errorSubject.asObservable()
  private readonly inboundMessageSubject = new Subject<StanzaEnvelope>()
  /** Gelen stanza akışı. */
  public readonly inboundMessage$ = this.inboundMessageSubject.asObservable()
  private readonly outboundMessageSubject = new Subject<StanzaEnvelope>()
  /** Giden stanza akışı. */
  public readonly outboundMessage$ = this.outboundMessageSubject.asObservable()
  private readonly _metricsSubject = new BehaviorSubject<HealthMetrics>(
    this.initialMetrics()
  )
  /** Outbound kuyruk örneği. */
  private readonly queue: OutboundQueue
  private readonly logger: Logger<ILogObj>

  /**
   * Yeni XmppManager oluşturur.
   * @param config Yapılandırma
   */
  constructor(config: XmppConfig) {
    this.cfg = Object.freeze({ ...config })

    this.logger = config.logger
      ? config.logger
      : new Logger<ILogObj>({
          name: 'XmppManager',
          ...config.loggerOptions
        })

    this.metrics$ =
      config.metricsThrottleMs && config.metricsThrottleMs > 0
        ? this._metricsSubject
            .asObservable()
            .pipe(auditTime(config.metricsThrottleMs))
        : this._metricsSubject.asObservable()

    // Outbound queue DI kurulumu
    this.queue = new OutboundQueue({
      config: config.outboundQueue,
      logger: this.logger.getSubLogger({ name: 'OutboundQueue' }),
      metrics: this.queueMetricsSink(),
      isConnected: () => this.isConnected(),
      sendFn: (el) => this.directSend(el)
    })
    this.outboundQueueEvents$ = this.queue.events$
  }

  /* ------------------------------------------------------------------------ */
  /*                                PUBLIC API                                */

  /* ------------------------------------------------------------------------ */

  /** Kullanılan konfigürasyon nesnesi (immutable). */
  getConfig(): XmppConfig {
    return this.cfg
  }

  /** Anlık bağlantı durumu snapshot'ı. */
  getCurrentState(): ConnectionStateInfo {
    return this.connectionStateSubject.getValue()
  }

  /** Metrik snapshot'ı (son BehaviorSubject değeri). */
  getMetrics(): HealthMetrics {
    return this._metricsSubject.getValue()
  }

  /**
   * Metrikleri sıfırlar (tüm sayaçlar ve oturum istatistikleri başa döner).
   */
  resetMetrics(): void {
    const prev = this.getMetrics()
    this._metricsSubject.next(this.initialMetrics())
    this.logger.trace('Metrics reset', {
      prevOutboundQueued: prev.outboundQueued
    })
  }

  /** Outbound kuyruğun aktif öğe sayısı. */
  getOutboundQueueSize(): number {
    return this.queue.getSize()
  }

  /** Aktif outbound kuyruğunu temizler. */
  clearOutboundQueue(): void {
    this.queue.clear()
  }

  /** Aktif outbound kuyruğunun snapshot'ını döndürür. */
  getOutboundQueueSnapshot(): OutboundQueueSnapshot {
    return this.queue.getSnapshot()
  }

  /** Retry limitini aşmış (giveup) öğelerin snapshot'ı. */
  getGiveupQueueSnapshot(): GiveupQueueSnapshot {
    return this.queue.getGiveupSnapshot()
  }

  /** Giveup kuyruğunu temizler. */
  clearGiveupQueue(): void {
    this.queue.clearGiveup()
  }

  /**
   * Ağ durumu bildir (online/offline).
   * @param isOnline true => online, false => offline
   */
  setNetworkStatus(isOnline: boolean): void {
    if (this.flags.networkOnline === isOnline) return
    this.flags.networkOnline = isOnline

    if (!isOnline) {
      this.logger.info('Network offline')
      this.setState('offline', 'network_offline')
      return
    }

    this.logger.info('Network online')
    const st = this.getCurrentState().state
    if (
      (st === 'offline' || st === 'disconnected' || st === 'failed') &&
      !this.flags.intentionalDisconnect &&
      this.cfg.reconnect.enabled
    ) {
      this.scheduleReconnect(1, true)
    } else if (st === 'offline') {
      this.setState('disconnected', 'network_online')
    }
  }

  /**
   * Bağlantı başlatır. Eğer halihazırda bağlantı süreci varsa bekler / yok sayar.
   * @returns Promise bağlantı kurulunca resolve olur.
   */
  async connect(): Promise<void> {
    const state = this.getCurrentState().state
    if (
      state === 'connected' ||
      state === 'connecting' ||
      state === 'reconnecting'
    ) {
      this.logger.trace('connect() ignored; state=', state)
      return this.flags.connectingPromise
        ? new Promise<void>((resolve, reject) => {
            const p = this.flags.connectingPromise!
            const or = p.resolve
            const oj = p.reject
            p.resolve = () => {
              or()
              resolve()
            }
            p.reject = (e) => {
              oj(e)
              reject(e)
            }
          })
        : Promise.resolve()
    }

    this.clearAllTimers()
    this.flags.intentionalDisconnect = false
    this.flags.currentAttempt = 0

    this.ensureConnection()
    this.setState('connecting')

    return new Promise<void>((resolve, reject) => {
      this.flags.connectingPromise = { resolve, reject }
      try {
        this.connection!.connect(
          this.cfg.jid,
          this.cfg.password,
          (status: number, error?: any) =>
            this.handleStropheStatus(status, error)
        )
        this.startConnectTimeout()
      } catch (err) {
        this.emitError(err, 'connect_initiation')
        this.setState('failed', 'connect_initiation_error')
        reject(err)
      }
    })
  }

  /**
   * Bağlantıyı sonlandırır.
   * @param reconnect true ise yeniden bağlanma sürecini başlatır.
   */
  async disconnect(reconnect?: boolean): Promise<void> {
    this.logger.info('disconnect()', { reconnect })
    this.flags.intentionalDisconnect = !reconnect
    this.clearReconnectTimer()
    this.clearConnectTimeout()

    if (this.connection) {
      try {
        this.connection.disconnect()
      } catch (err) {
        this.emitError(err, 'manual_disconnect')
      }
    }

    if (reconnect && this.cfg.reconnect.enabled) {
      this.scheduleReconnect(1, true)
    } else {
      this.setState('disconnected', 'manual')
      this.closeSessionMetrics()
    }
  }

  /**
   * Ham XML gönderir (bağlı değilse kuyruk).
   * @param xml String stanza
   * @param options Kuyruk opsiyonları
   */
  sendRaw(xml: string, options?: OutboundSendOptions): void {
    if (!xml) return
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xml, 'text/xml')
      this.sendElement(doc.documentElement, options)
    } catch (err) {
      this.emitError(err, 'send_raw_parse')
    }
  }

  /**
   * DOM Element gönderir (bağlı değilse kuyruk).
   * @param element Stanza elemanı
   * @param options Kuyruk opsiyonları
   */
  sendElement(element: Element, options?: OutboundSendOptions): void {
    if (!element) return
    if (this.isConnected()) {
      try {
        this.directSend(element)
      } catch (err) {
        this.logger.warn('directSend failed, enqueue', {
          err: this.describeError(err)
        })
        this.queue.enqueue(element, undefined, options, 0)
      }
    } else {
      this.queue.enqueue(element, undefined, options, 0)
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                            METRICS & HELPERS                              */

  /* ------------------------------------------------------------------------ */

  /**
   * Başlangıç metrik değerlerini üretir.
   */
  private initialMetrics(): HealthMetrics {
    return {
      startTime: Date.now(),
      totalUptimeMs: 0,
      currentSessionUptimeMs: 0,
      sessions: 0,
      totalReconnectAttempts: 0,
      successfulReconnects: 0,
      consecutiveFailures: 0,
      totalMessagesIn: 0,
      totalMessagesOut: 0,
      outboundQueued: 0,
      outboundDropped: 0,
      outboundExpired: 0,
      outboundRetried: 0,
      outboundGiveups: 0,
      outboundQueueFullEvents: 0
    }
  }

  /**
   * OutboundQueue'nun metrik güncellemesi için sink üretir.
   */
  private queueMetricsSink(): IQueueMetricsSink {
    return {
      bump: (key, inc = 1) => {
        const m = { ...this.getMetrics() }
        m[key] = (m[key] as number) + inc
        this._metricsSubject.next(m)
      },
      getMetrics: () => this.getMetrics()
    }
  }

  /** Gelen mesaj sayacını arttırır. */
  private bumpInbound(): void {
    const m = { ...this.getMetrics() }
    m.totalMessagesIn += 1
    this._metricsSubject.next(m)
  }

  /** Giden mesaj sayacını arttırır. */
  private bumpOutbound(): void {
    const m = { ...this.getMetrics() }
    m.totalMessagesOut += 1
    this._metricsSubject.next(m)
  }

  /**
   * Oturum boyunca uptime sayaç güncellemesi (debug amaçlı sık tetiklenebilir).
   */
  private tickSessionUptime(): void {
    const m = this.getMetrics()
    if (m.currentSessionStart != null) {
      const start = m.currentSessionStart
      this._metricsSubject.next({
        ...m,
        currentSessionUptimeMs: Date.now() - start
      })
    }
  }

  /**
   * Yeni oturum metrik alanlarını açar.
   */
  private openSessionMetrics(): void {
    const m = { ...this.getMetrics() }
    m.sessions += 1
    m.currentSessionStart = Date.now()
    m.lastConnectedAt = m.currentSessionStart
    m.consecutiveFailures = 0
    this._metricsSubject.next(m)
  }

  /**
   * Oturum sonu metrik güncellemelerini finalize eder.
   */
  private closeSessionMetrics(): void {
    const m = { ...this.getMetrics() }
    if (m.currentSessionStart) {
      const dur = Date.now() - m.currentSessionStart
      m.totalUptimeMs += dur
      m.lastSessionDurationMs = dur
      if (!m.longestSessionDurationMs || dur > m.longestSessionDurationMs) {
        m.longestSessionDurationMs = dur
      }
      if (m.sessions > 0) {
        m.averageSessionDurationMs = Math.round(m.totalUptimeMs / m.sessions)
      }
      m.currentSessionStart = undefined
      m.currentSessionUptimeMs = 0
      m.lastDisconnectedAt = Date.now()
    }
    this._metricsSubject.next(m)
  }

  /**
   * Reconnect attempt sayaçlarını arttırır.
   */
  private bumpReconnectAttempt(): void {
    const m = { ...this.getMetrics() }
    m.totalReconnectAttempts += 1
    m.consecutiveFailures += 1
    this._metricsSubject.next(m)
  }

  /**
   * Başarılı reconnect sonrası sayaç güncellemesi yapar.
   */
  private markSuccessfulReconnect(): void {
    const m = { ...this.getMetrics() }
    m.successfulReconnects += 1
    m.consecutiveFailures = 0
    this._metricsSubject.next(m)
  }

  /* ------------------------------------------------------------------------ */
  /*                         CONNECTION / RECONNECT FLOW                       */

  /* ------------------------------------------------------------------------ */

  /**
   * Strophe.Connection örneğini temin eder (lazy init).
   */
  private ensureConnection(): void {
    if (!this.connection) {
      // Strophe.Connection tipleri yoksa cast kullanıyoruz.

      const Ctor: any = (Strophe as any).Connection
      this.connection = new Ctor(this.cfg.serviceUrl) as IStropheConnection
    }
  }

  /**
   * Bağlantı zaman aşımı timer başlatır.
   */
  private startConnectTimeout(): void {
    const timeout = this.cfg.timeouts?.connectTimeoutMs
    if (!timeout || timeout <= 0) return
    this.clearConnectTimeout()
    this.flags.connectTimeoutTimer = setTimeout(() => {
      const st = this.getCurrentState().state
      if (st === 'connecting' || st === 'reconnecting') {
        this.emitError(new Error('Connect timeout'), 'connect_timeout')
        this.connection?.disconnect()
        this.setState('failed', 'connect_timeout')
        this.closeSessionMetrics()
        this.autoScheduleReconnect(true)
      }
    }, timeout)
  }

  /**
   * Aktif bağlantı timeout timer'ını temizler.
   */
  private clearConnectTimeout(): void {
    if (this.flags.connectTimeoutTimer) {
      clearTimeout(this.flags.connectTimeoutTimer)
      this.flags.connectTimeoutTimer = undefined
    }
  }

  /**
   * Bağlı mı?
   */
  private isConnected(): boolean {
    return this.getCurrentState().state === 'connected'
  }

  /**
   * Strophe status callback yönlendiricisi.
   */
  private handleStropheStatus(status: number, error?: any): void {
    const St = Strophe.Status
    this.logger.trace('Strophe status', { status, error })
    switch (status) {
      case St.CONNECTING:
        this.setState('connecting', undefined, status)
        break
      case St.CONNFAIL:
        this.emitError(error || new Error('Connection failed'), 'connfail')
        this.transitionFailure('connfail', status)
        break
      case St.AUTHFAIL:
        this.emitError(error || new Error('Auth failed'), 'authfail')
        this.transitionFailure('authfail', status, true)
        break
      case St.ERROR:
        this.emitError(error || new Error('Generic error'), 'error')
        this.transitionFailure('generic_error', status)
        break
      case St.CONNECTED:
        this.onConnected(status)
        break
      case St.DISCONNECTED:
        this.onDisconnected(status)
        break
      case St.DISCONNECTING:
        break
      default:
        this.logger.trace('Unhandled status', { status })
    }
  }

  /**
   * Başarılı bağlanma (CONNECTED) işlemleri.
   */
  private onConnected(stStatus: number): void {
    this.clearConnectTimeout()
    const wasRe = this.flags.currentAttempt > 0
    this.flags.currentAttempt = 0

    this.setState('connected', undefined, stStatus)
    this.markSuccessfulReconnect()
    this.flags.connectingPromise?.resolve()
    this.flags.connectingPromise = undefined

    this.openSessionMetrics()
    this.installMessageHandler()

    const tick = () => this.tickSessionUptime()
    if (typeof requestAnimationFrame !== 'undefined')
      requestAnimationFrame(tick)
    else queueMicrotask(tick)

    if (wasRe) this.logger.info('Reconnect OK')
    else this.logger.info('Connected')

    this.queue.onConnected()
  }

  /**
   * Bağlantı kopma (DISCONNECTED) işleyicisi.
   */
  private onDisconnected(stStatus: number): void {
    this.clearConnectTimeout()
    if (this.flags.intentionalDisconnect) {
      this.setState('disconnected', 'intentional', stStatus)
      this.flags.connectingPromise?.reject(
        new Error('Disconnected intentionally')
      )
      this.flags.connectingPromise = undefined
      this.closeSessionMetrics()
    } else {
      this.transitionFailure('disconnected', stStatus)
    }
    this.queue.onDisconnected()
  }

  /**
   * Başarısızlık geçişi + metrik + reconnect planlama.
   */
  private transitionFailure(
    reason: string,
    stStatus?: number,
    authFatal = false
  ): void {
    this.setState('failed', reason, stStatus)
    this.closeSessionMetrics()

    if (this.flags.connectingPromise) {
      this.flags.connectingPromise.reject(new Error(reason))
      this.flags.connectingPromise = undefined
    }
    if (authFatal) return
    this.autoScheduleReconnect()
  }

  /**
   * Reconnect planlama koşullarını değerlendirir.
   */
  private autoScheduleReconnect(forceImmediate = false): void {
    if (
      this.cfg.reconnect.enabled &&
      !this.flags.intentionalDisconnect &&
      this.flags.networkOnline
    ) {
      const next = (this.flags.currentAttempt || 0) + 1
      this.scheduleReconnect(next, forceImmediate)
    }
  }

  /**
   * Reconnect denemesini programlar.
   */
  private scheduleReconnect(attempt: number, immediate = false): void {
    this.clearReconnectTimer()
    if (!this.cfg.reconnect.enabled) return

    const { maxAttempts } = this.cfg.reconnect
    if (maxAttempts && attempt > maxAttempts) {
      this.logger.warn('Max reconnect attempts exceeded', { attempt })
      return
    }
    this.flags.currentAttempt = attempt

    if (!this.flags.networkOnline) {
      this.logger.info('Reconnect delayed (offline)', { attempt })
      return
    }

    this.bumpReconnectAttempt()
    const calc = calculateBackoffDelay(attempt, this.cfg.reconnect)
    const delay = immediate ? 0 : calc.jitteredDelay

    this.setState(
      'reconnecting',
      immediate ? 'immediate' : 'schedule',
      undefined,
      attempt
    )
    this.logger.info('Reconnect scheduled', {
      attempt,
      delay,
      planned: calc.plannedDelay,
      immediate
    })

    this.flags.reconnectTimer = setTimeout(() => {
      this.logger.info('Reconnect attempt', { attempt })
      this.internalReconnectAttempt(attempt)
    }, delay)
  }

  /**
   * Reconnect denemesini başlatır.
   */
  private internalReconnectAttempt(attempt: number): void {
    if (this.flags.intentionalDisconnect) return
    if (!this.flags.networkOnline) return
    this.ensureConnection()
    try {
      this.connection!.connect(
        this.cfg.jid,
        this.cfg.password,
        (status: number, error?: any) => this.handleStropheStatus(status, error)
      )
      this.setState('reconnecting', undefined, undefined, attempt)
      this.startConnectTimeout()
    } catch (err) {
      this.emitError(err, 'reconnect_attempt_exception')
      this.scheduleReconnect(attempt + 1)
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                                 SENDING                                  */

  /* ------------------------------------------------------------------------ */

  /**
   * Bağlantı üzerinden doğrudan send (kuyruk bypass).
   * @throws Gönderim hatasında
   */
  private directSend(element: Element): void {
    this.connection!.send(element)
    this.emitOutbound(element)
    this.bumpOutbound()
  }

  /* ------------------------------------------------------------------------ */
  /*                              MESSAGE HANDLERS                            */

  /* ------------------------------------------------------------------------ */

  /**
   * Strophe inbound handler kurar (mesaj türü için).
   */
  private installMessageHandler(): void {
    try {
      this.connection!.addHandler(
        (stanza: Element) => {
          if (stanza?.nodeName?.toLowerCase() === 'message') {
            this.emitInbound(stanza)
            this.bumpInbound()
            if (this.cfg.debugMode) this.tickSessionUptime()
          }
          return true
        },
        null,
        'message',
        null,
        null,
        null
      )
    } catch (err) {
      this.emitError(err, 'install_message_handler')
    }
  }

  /**
   * Gelen stanza publish eder (filtre uygular).
   */
  private emitInbound(element: Element): void {
    const xml = this.serialize(element)
    const env: StanzaEnvelope = {
      xml,
      element,
      direction: 'in',
      timestamp: Date.now()
    }
    if (
      this.cfg.filters?.inboundMessage &&
      !this.cfg.filters.inboundMessage(env)
    )
      return
    this.inboundMessageSubject.next(env)
  }

  /**
   * Giden stanza publish eder (filtre uygular).
   */
  private emitOutbound(element: Element): void {
    const xml = this.serialize(element)
    const env: StanzaEnvelope = {
      xml,
      element,
      direction: 'out',
      timestamp: Date.now()
    }
    if (
      this.cfg.filters?.outboundMessage &&
      !this.cfg.filters?.outboundMessage(env)
    )
      return
    this.outboundMessageSubject.next(env)
  }

  /**
   * Element'i XML string'e çevirir (Strophe.serialize varsa onu kullanır).
   */
  private serialize(element: Element): string {
    try {
      if ((Strophe as any).serialize) return (Strophe as any).serialize(element)
      return new XMLSerializer().serializeToString(element)
    } catch {
      return '<serialization_error/>'
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                         STATE / ERROR / CLEANUP                           */

  /* ------------------------------------------------------------------------ */

  /**
   * Hata event'i yayınlar.
   */
  private emitError(error: any, context: string): void {
    const evt: XmppErrorEvent = {
      error,
      context,
      timestamp: Date.now(),
      attempt: this.flags.currentAttempt || undefined
    }
    this.errorSubject.next(evt)
    this.logger.error('Error', {
      context,
      error:
        error instanceof Error
          ? { message: error.message, name: error.name, stack: error.stack }
          : { value: String(error) }
    })
  }

  /**
   * Durum değişimini publish eder (log seviyesini config'e göre ayarlar).
   */
  private setState(
    state: ConnectionState,
    reason?: string,
    stropheStatus?: number,
    attempt?: number
  ): void {
    const info: ConnectionStateInfo = {
      state,
      reason,
      stropheStatus,
      attempt,
      timestamp: Date.now()
    }
    this.connectionStateSubject.next(info)
    if (this.cfg.debugMode) {
      this.logger.trace('State change', info)
    } else if (
      ['failed', 'reconnecting', 'connected', 'disconnected'].includes(state)
    ) {
      this.logger.info('State change', { state, reason, attempt })
    }
  }

  /**
   * Reconnect timer temizler.
   */
  private clearReconnectTimer(): void {
    if (this.flags.reconnectTimer) {
      clearTimeout(this.flags.reconnectTimer)
      this.flags.reconnectTimer = undefined
    }
  }

  /**
   * Tüm dahili timer'ları temizler (reconnect + connect timeout).
   */
  private clearAllTimers(): void {
    this.clearReconnectTimer()
    this.clearConnectTimeout()
  }

  /**
   * Hata nesnesini açıklayıcı objeye dönüştürür.
   */
  private describeError(e: any): Record<string, unknown> {
    if (e instanceof Error) return { message: e.message, name: e.name }
    return { value: String(e) }
  }
}
