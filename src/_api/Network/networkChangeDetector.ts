import { Observable, ReplaySubject, Subject } from 'rxjs'
import { ILogObj, Logger } from 'tslog'

import { cacheBuster, classifyError, joinUrl } from './helpers'
import {
  ElectronIntegrationConfig,
  ElectronNetworkAugmentedInfo,
  ExternalProviderUpdate,
  InternalCheckResult,
  NetworkChangeDetectorConfig,
  NetworkChangeEvent,
  NetworkErrorEvent,
  NetworkErrorKind,
  NetworkInfo,
  NetworkMetrics,
  NetworkStatus,
  NetworkType,
  SourceStatusSnapshot
} from './types'

/**
 * Varsayılan config (revize).
 */
const DEFAULT_CFG: Required<
  Omit<
    NetworkChangeDetectorConfig,
    | 'primaryUrl'
    | 'checkUrls'
    | 'fetchFn'
    | 'timeProvider'
    | 'autoStart'
    | 'electronIntegration'
    | 'logger'
    | 'loggerOptions'
  >
> = {
  preferHead: true,
  requestTimeoutMs: 5000,
  baseIntervalMs: 30_000,
  maxIntervalMs: 5 * 60_000,
  maxRetries: 5,
  retryBackoffFactor: 2,
  initialRetryDelayMs: 500,
  maxRetryDelayMs: 8_000,
  flapWindowMs: 30_000,
  flapThreshold: 3,
  maxChecksPerHour: 120,
  accelerateOnFlap: true,
  healthPath: '',
  degradedGrowthFactor: 1.4,
  offlineInitialIntervalMultiplier: 2,
  includeMetricsInEvents: true,
  ewmaAlpha: 0.2,
  onlineAccelerationFactor: 0.5,
  eventOnUnchangedStatus: false,
  incrementEventOnUnchangedStatus: false
}

const DEFAULT_ELECTRON_CFG: Required<ElectronIntegrationConfig> = {
  enabled: false,
  providerPrecedence: 'merge',
  strategy: 'conservative',
  publishChannel: 'network:status',
  requestChannel: 'network:request-sample',
  overrideOfflineConfidenceThreshold: 0.85,
  overrideOnlineConfidenceThreshold: 0.9
}

/**
 * NetworkChangeDetector
 * - Tarayıcı olayları + aktif health check + (opsiyonel) Electron sağlayıcı birleşimi
 * - Yalnızca status değişiminde event (default)
 * - Metrik resetleme desteği
 */
export class NetworkChangeDetector {
  private readonly cfg: NetworkChangeDetectorConfig & typeof DEFAULT_CFG
  private readonly electronCfg: ElectronIntegrationConfig &
    typeof DEFAULT_ELECTRON_CFG
  private logger: Logger<ILogObj>
  private fetchFn: typeof fetch
  private now: () => number

  private status$ = new ReplaySubject<NetworkChangeEvent>(1)
  private changed$ = new ReplaySubject<NetworkChangeEvent>(1)
  private error$ = new Subject<NetworkErrorEvent>()

  private running = false
  private destroyed = false
  private paused = false

  private currentStatus: NetworkStatus = 'online'
  private statusLastChangedTs = 0
  private onlineSinceTs?: number
  private offlineSinceTs?: number

  private eventIndex = 0
  private retryIndex = 0

  private intervalHandle: ReturnType<typeof setTimeout> | null = null
  private currentInterval: number
  private consecutiveFailures = 0

  // Flap
  private flapTimestamps: number[] = []
  private totalTransitions = 0

  // Rate limit penceresi
  private checksWindow: number[] = []

  // RTT metrics
  private ewmaRtt?: number
  private minRtt?: number
  private maxRtt?: number

  // Metrikler
  private metrics: NetworkMetrics = {
    totalChecks: 0,
    successfulChecks: 0,
    failedChecks: 0,
    skippedChecks: 0,
    totalUrlsTried: 0,
    consecutiveFailures: 0,
    currentIntervalMs: 0,
    totalOnlineDurationMs: 0,
    totalOfflineDurationMs: 0,
    currentStatusDurationMs: 0,
    prevStatusDurationMs: 0,
    statusLastChangedTs: 0,
    totalTransitions: 0,
    flapCountWindow: 0,
    flapCountTotal: 0,
    isFlapping: false,
    electronUpdateCount: 0
  }

  private browserSource: SourceStatusSnapshot = {
    status: 'online',
    timestamp: 0,
    provider: 'browser'
  }

  private electronSource?: SourceStatusSnapshot & {
    augmented?: ElectronNetworkAugmentedInfo
  }
  private electronProviderAttached = false

  constructor(config: NetworkChangeDetectorConfig) {
    this.cfg = { ...DEFAULT_CFG, ...config }
    this.electronCfg = {
      ...DEFAULT_ELECTRON_CFG,
      ...(config.electronIntegration || {})
    }

    if (
      !this.cfg.primaryUrl &&
      (!this.cfg.checkUrls || this.cfg.checkUrls.length === 0)
    ) {
      throw new Error(
        'NetworkChangeDetector: primaryUrl veya checkUrls tanımlanmalı.'
      )
    }

    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis)
    this.now = config.timeProvider ?? (() => Date.now())

    if (config.logger) {
      this.logger = config.logger
    } else {
      this.logger = new Logger<ILogObj>({
        name: 'NetworkChangeDetector',
        ...config.loggerOptions
      })
    }

    this.currentInterval = this.cfg.baseIntervalMs
    this.metrics.currentIntervalMs = this.currentInterval

    if (this.cfg.autoStart) {
      this.start().catch((e) => this.logger.error('Auto start failed', e))
    }
  }

  // ---------------- Public API ----------------

  /**
   * Servisi başlatır.
   */
  public async start(): Promise<void> {
    if (this.running || this.destroyed) return
    if (!this.isBrowser()) {
      this.logger.warn('Browser ortamı değil; start ertelendi.')
      return
    }
    this.running = true
    const t = this.now()
    this.statusLastChangedTs = t
    this.onlineSinceTs = t
    this.browserSource = { status: 'online', timestamp: t, provider: 'browser' }

    this.attachBrowserListeners()
    if (this.electronCfg.enabled) {
      this.attachElectronIpc()
    }

    // Initial emit (status değişimi olarak kabul ediyoruz)
    this.emitCompositeStatus('initial', true)

    this.scheduleNext()
  }

  /**
   * Servisi durdurur ve stream'leri complete eder.
   */
  public stop(): void {
    if (this.destroyed) return
    this.running = false
    this.destroyed = true
    this.clearTimer()
    this.detachBrowserListeners()
    this.detachElectronIpc()
    this.status$.complete()
    this.error$.complete()
  }

  /**
   * Sağlık check döngüsünü geçici duraklatır (manual checkNow yine çalışır).
   */
  public pause(): void {
    if (this.paused || this.destroyed) return
    this.paused = true
    this.clearTimer()
  }

  /**
   * pause sonrası devam.
   */
  public resume(): void {
    if (!this.paused || this.destroyed) return
    this.paused = false
    if (this.running) this.scheduleNext()
  }

  /**
   * Status değişim event akışı (ReplaySubject(1)).
   */
  public onNetworkChange(): Observable<NetworkChangeEvent> {
    return this.status$.asObservable()
  }

  public onNetworkChangeOnce(): Observable<NetworkChangeEvent> {
    return this.changed$.asObservable()
  }

  /**
   * Hata event akışı.
   */
  public onError(): Observable<NetworkErrorEvent> {
    return this.error$.asObservable()
  }

  /**
   * Manuel anlık health check (rate limit kontrolü yapılır).
   */
  public async checkNow(): Promise<void> {
    await this.performHealthCheck(true)
  }

  /**
   * Son composite status.
   */
  public getStatus(): NetworkStatus {
    return this.currentStatus
  }

  /**
   * Mevcut network info (tarayıcı).
   */
  public getNetworkInfo(): NetworkInfo {
    return this.readNetworkInfo()
  }

  /**
   * Metrik snapshot.
   */
  public getMetrics(): NetworkMetrics {
    return { ...this.metrics }
  }

  /**
   * Flapping var mı.
   */
  public isFlapping(): boolean {
    this.pruneFlapWindow(this.now())
    return this.flapTimestamps.length >= this.cfg.flapThreshold
  }

  /**
   * Electron update simülasyonu (test).
   */
  public simulateElectronUpdate(update: ExternalProviderUpdate): void {
    this.handleExternalProviderUpdate(update)
  }

  /**
   * Metrikleri resetler. Varsayılan davranış: her şeyi sıfırla fakat
   * current status süre ölçerleri yeniden başlatılır.
   * Seçenekler ile RTT veya sayaçların korunması sağlanabilir.
   */
  public resetMetrics(options?: {
    preserveRtt?: boolean
    preserveCounts?: boolean
  }): void {
    const now = this.now()
    const status = this.currentStatus

    const preservedRtt = options?.preserveRtt
      ? {
          averageRttMs: this.metrics.averageRttMs,
          minRttMs: this.metrics.minRttMs,
          maxRttMs: this.metrics.maxRttMs
        }
      : {}

    const preservedCounts = options?.preserveCounts
      ? {
          totalChecks: this.metrics.totalChecks,
          successfulChecks: this.metrics.successfulChecks,
          failedChecks: this.metrics.failedChecks,
          skippedChecks: this.metrics.skippedChecks,
          totalUrlsTried: this.metrics.totalUrlsTried,
          totalTransitions: this.metrics.totalTransitions,
          flapCountTotal: this.metrics.flapCountTotal
        }
      : {}

    this.metrics = {
      // totalChecks: 0,
      // successfulChecks: 0,
      // failedChecks: 0,
      // skippedChecks: 0,
      // totalUrlsTried: 0,
      consecutiveFailures: this.consecutiveFailures,
      currentIntervalMs: this.currentInterval,
      lastSuccessTs: undefined,
      lastFailureTs: undefined,
      totalOnlineDurationMs: 0,
      totalOfflineDurationMs: 0,
      currentStatusDurationMs: 0,
      prevStatusDurationMs: 0,
      statusLastChangedTs: now,
      totalTransitions: options?.preserveCounts
        ? preservedCounts.totalTransitions!
        : 0,
      flapCountWindow: 0,
      flapCountTotal: options?.preserveCounts
        ? preservedCounts.flapCountTotal!
        : 0,
      isFlapping: false,
      onlineSinceTs: status === 'online' ? now : undefined,
      offlineSinceTs: status === 'offline' ? now : undefined,
      electronUpdateCount: 0,
      averageRttMs: preservedRtt.averageRttMs,
      minRttMs: preservedRtt.minRttMs,
      maxRttMs: preservedRtt.maxRttMs,
      totalChecks: options?.preserveCounts ? preservedCounts.totalChecks! : 0,
      successfulChecks: options?.preserveCounts
        ? preservedCounts.successfulChecks!
        : 0,
      failedChecks: options?.preserveCounts ? preservedCounts.failedChecks! : 0,
      skippedChecks: options?.preserveCounts
        ? preservedCounts.skippedChecks!
        : 0,
      totalUrlsTried: options?.preserveCounts
        ? preservedCounts.totalUrlsTried!
        : 0,
      providerDominance: this.metrics.providerDominance,
      electronOfflineConfidence: undefined,
      electronOnlineConfidence: undefined,
      lastElectronLatencyMs: undefined
    }

    if (!options?.preserveRtt) {
      this.ewmaRtt = undefined
      this.minRtt = undefined
      this.maxRtt = undefined
    }

    this.flapTimestamps = []
  }

  // ---------------- Electron IPC Integration ----------------

  private attachElectronIpc(): void {
    if (this.electronProviderAttached) return
    const anyWin = window as any
    const ipc =
      anyWin?.electron?.ipcRenderer ||
      anyWin?.ipcRenderer ||
      anyWin?.electronNetwork?.ipcRenderer

    if (!ipc?.on) {
      this.logger.warn(
        'Electron IPC erişilemedi; electron entegrasyonu devre dışı.'
      )
      return
    }

    const channel = this.electronCfg.publishChannel
    ipc.on(channel, (_e: unknown, payload: ExternalProviderUpdate) => {
      this.handleExternalProviderUpdate(payload)
    })
    this.electronProviderAttached = true
    this.logger.info(`Electron IPC dinleniyor (channel=${channel})`)
  }

  private detachElectronIpc(): void {
    if (!this.electronProviderAttached) return
    const anyWin = window as any
    const ipc =
      anyWin?.electron?.ipcRenderer ||
      anyWin?.ipcRenderer ||
      anyWin?.electronNetwork?.ipcRenderer
    if (ipc?.removeAllListeners) {
      ipc.removeAllListeners(this.electronCfg.publishChannel)
    }
    this.electronProviderAttached = false
  }

  private handleExternalProviderUpdate(update: ExternalProviderUpdate): void {
    const now = this.now()
    this.metrics.electronUpdateCount++
    this.metrics.lastElectronUpdateTs = now
    if (update.latencyMs != null)
      this.metrics.lastElectronLatencyMs = update.latencyMs
    if (update.augmentedInfo?.offlineConfidence != null) {
      this.metrics.electronOfflineConfidence =
        update.augmentedInfo.offlineConfidence
    }
    if (update.augmentedInfo?.onlineConfidence != null) {
      this.metrics.electronOnlineConfidence =
        update.augmentedInfo.onlineConfidence
    }
    this.electronSource = {
      status: update.status,
      timestamp: update.timestamp || now,
      confidence: update.confidence,
      provider: 'electron',
      augmented: update.augmentedInfo
    }
    this.composeAndMaybeEmit('electron:update')
  }

  // ---------------- Composite Logic ----------------

  private composeAndMaybeEmit(triggerReason: string): void {
    const prev = this.currentStatus
    const { newStatus, compositeReason, dominance } =
      this.determineStatusFromSources(triggerReason)

    if (newStatus !== prev) {
      this.transitionStatusInternal(newStatus, compositeReason, dominance)
    } else {
      // Status değişmedi
      if (this.cfg.eventOnUnchangedStatus) {
        this.metrics.providerDominance = dominance
        this.emitCompositeStatus(
          compositeReason,
          this.cfg.incrementEventOnUnchangedStatus
        )
      }
    }
  }

  private determineStatusFromSources(triggerReason: string): {
    newStatus: NetworkStatus
    compositeReason: string
    dominance: 'browser' | 'electron' | 'merged'
  } {
    const browserStatus = this.browserSource.status
    const es = this.electronSource
    if (!this.electronCfg.enabled || !es) {
      return {
        newStatus: browserStatus,
        compositeReason:
          triggerReason === 'initial' ? 'browser-only' : triggerReason,
        dominance: 'browser'
      }
    }

    const precedence = this.electronCfg.providerPrecedence
    const strategy = this.electronCfg.strategy
    const offlineOverride =
      es.augmented?.offlineConfidence != null &&
      es.augmented.offlineConfidence >=
        this.electronCfg.overrideOfflineConfidenceThreshold
    const onlineOverride =
      es.augmented?.onlineConfidence != null &&
      es.augmented.onlineConfidence >=
        this.electronCfg.overrideOnlineConfidenceThreshold

    if (precedence === 'electron-first') {
      if (offlineOverride)
        return {
          newStatus: 'offline',
          compositeReason: 'electron:offline-confidence',
          dominance: 'electron'
        }
      if (onlineOverride)
        return {
          newStatus: 'online',
          compositeReason: 'electron:online-confidence',
          dominance: 'electron'
        }
      return {
        newStatus: es.status,
        compositeReason: `electron-first:${triggerReason}`,
        dominance: 'electron'
      }
    }

    if (precedence === 'browser-first') {
      if (offlineOverride)
        return {
          newStatus: 'offline',
          compositeReason: 'electron:offline-override',
          dominance: 'electron'
        }
      if (onlineOverride)
        return {
          newStatus: 'online',
          compositeReason: 'electron:online-override',
          dominance: 'electron'
        }
      return {
        newStatus: browserStatus,
        compositeReason: `browser-first:${triggerReason}`,
        dominance: 'browser'
      }
    }

    // merge
    if (strategy === 'conservative') {
      if (offlineOverride)
        return {
          newStatus: 'offline',
          compositeReason: 'merge:offline-confidence',
          dominance: 'electron'
        }
      if (browserStatus === 'offline' || es.status === 'offline') {
        return {
          newStatus: 'offline',
          compositeReason: `merge:conservative-offline(${browserStatus},${es.status})`,
          dominance: es.status === 'offline' ? 'electron' : 'browser'
        }
      }
      if (onlineOverride)
        return {
          newStatus: 'online',
          compositeReason: 'merge:online-confidence',
          dominance: 'electron'
        }
      return {
        newStatus: 'online',
        compositeReason: 'merge:both-online',
        dominance: 'merged'
      }
    } else {
      // optimistic
      if (onlineOverride)
        return {
          newStatus: 'online',
          compositeReason: 'merge:optimistic-online-override',
          dominance: 'electron'
        }
      if (browserStatus === 'online' || es.status === 'online') {
        return {
          newStatus: 'online',
          compositeReason: 'merge:optimistic-online',
          dominance: 'merged'
        }
      }
      if (offlineOverride)
        return {
          newStatus: 'offline',
          compositeReason: 'merge:offline-confidence',
          dominance: 'electron'
        }
      return {
        newStatus: 'offline',
        compositeReason: 'merge:both-offline',
        dominance: 'merged'
      }
    }
  }

  private emitCompositeStatus(reason: string, statusChanged: boolean): void {
    const ts = this.now()
    this.pruneFlapWindow(ts)
    const isFlapping = this.isFlapping()
    this.updateDurations(ts)
    this.metrics.flapCountWindow = this.flapTimestamps.length
    this.metrics.isFlapping = isFlapping

    if (statusChanged) {
      this.eventIndex++
    } else if (this.cfg.incrementEventOnUnchangedStatus) {
      this.eventIndex++
    }

    const evt: NetworkChangeEvent = {
      status: this.currentStatus,
      network: this.readNetworkInfo(),
      eventIndex: this.eventIndex,
      retryIndex: this.retryIndex++,
      timestamp: ts,
      isFlapping,
      flapCount: this.flapTimestamps.length,
      reason,
      sources: {
        browser: this.browserSource,
        electron: this.electronSource
      },
      compositeStatusReason: reason
    }
    if (!this.electronSource) {
      delete evt.sources.electron
    }
    if (this.cfg.includeMetricsInEvents) {
      evt.metrics = this.getMetrics()
    }
    this.status$.next(evt)

    if (evt.retryIndex === 0) {
      this.changed$.next(evt)
    }
  }

  private transitionStatusInternal(
    newStatus: NetworkStatus,
    compositeReason: string,
    dominance: 'browser' | 'electron' | 'merged'
  ): void {
    const prev = this.currentStatus
    this.metrics.prevStatusDurationMs = this.metrics.currentStatusDurationMs
    const now = this.now()
    this.updateDurations(now)
    this.currentStatus = newStatus
    this.statusLastChangedTs = now
    if (newStatus !== prev) {
      this.retryIndex = 0
    }
    if (newStatus === 'online') {
      this.onlineSinceTs = now
      this.offlineSinceTs = undefined
      this.consecutiveFailures = 0
      this.metrics.consecutiveFailures = 0
    } else {
      this.offlineSinceTs = now
      this.onlineSinceTs = undefined
    }
    this.registerFlap(now)
    this.metrics.providerDominance = dominance
    this.emitCompositeStatus(compositeReason, true)
    this.logger.info(
      `Network status changed ${prev} -> ${newStatus} (${compositeReason})`
    )

    if (this.cfg.accelerateOnFlap && this.isFlapping()) {
      this.currentInterval = Math.max(
        2000,
        Math.round(this.cfg.baseIntervalMs / 2)
      )
      this.metrics.currentIntervalMs = this.currentInterval
      this.resetSchedule()
    }
  }

  // ---------------- Browser Listeners ----------------

  private onlineListener = () => {
    const t = this.now()
    this.browserSource = { status: 'online', timestamp: t, provider: 'browser' }
    if (
      this.cfg.onlineAccelerationFactor &&
      this.cfg.onlineAccelerationFactor < 1
    ) {
      this.currentInterval = Math.max(
        2000,
        Math.round(this.cfg.baseIntervalMs * this.cfg.onlineAccelerationFactor)
      )
      this.metrics.currentIntervalMs = this.currentInterval
      this.resetSchedule()
    }
    this.composeAndMaybeEmit('browser:online')
    this.performHealthCheck(true).catch(() => void 0)
  }

  private offlineListener = () => {
    const t = this.now()
    this.browserSource = {
      status: 'offline',
      timestamp: t,
      provider: 'browser'
    }
    this.composeAndMaybeEmit('browser:offline')
  }

  private connectionListener = () => {
    if (this.cfg.eventOnUnchangedStatus) {
      this.emitCompositeStatus('browser:connection-change', false)
    }
  }

  private attachBrowserListeners(): void {
    window.addEventListener('online', this.onlineListener)
    window.addEventListener('offline', this.offlineListener)
    const conn = (navigator as any)?.connection
    if (conn?.addEventListener) {
      conn.addEventListener('change', this.connectionListener)
    }
  }

  private detachBrowserListeners(): void {
    window.removeEventListener('online', this.onlineListener)
    window.removeEventListener('offline', this.offlineListener)
    const conn = (navigator as any)?.connection
    if (conn?.removeEventListener) {
      conn.removeEventListener('change', this.connectionListener)
    }
  }

  // ---------------- Scheduling & Health Check ----------------

  private clearTimer(): void {
    if (this.intervalHandle) {
      clearTimeout(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  private scheduleNext(): void {
    if (!this.running || this.destroyed || this.paused) return
    this.clearTimer()
    this.intervalHandle = setTimeout(async () => {
      await this.performHealthCheck(false)
      this.scheduleNext()
    }, this.currentInterval)
  }

  private resetSchedule(): void {
    this.clearTimer()
    this.scheduleNext()
  }

  private async performHealthCheck(manual: boolean): Promise<void> {
    const ts = this.now()
    if (!this.rateLimitAllow(ts)) {
      this.logger.debug('Health check skipped (rate limit).')
      this.registerSkipped()
      this.emitErrorEvent({
        error: new Error('Rate limited'),
        attempt: this.consecutiveFailures + 1,
        isFinal: false,
        reason: 'check:skipped-rate-limit',
        kind: 'skipped-rate-limit'
      })
      return
    }
    this.metrics.totalChecks++

    const urls = this.prepareUrlList()
    let lastError: InternalCheckResult | undefined
    let success: InternalCheckResult | undefined

    for (const url of urls) {
      const res = await this.tryUrl(url)
      this.metrics.totalUrlsTried++
      if (res.ok) {
        success = res
        break
      } else {
        lastError = res
      }
    }

    if (success) {
      this.handleSuccess(success)
    } else {
      this.handleFail(lastError)
      await this.maybeRetry(manual)
    }
  }

  private async maybeRetry(_manual: boolean): Promise<void> {
    this.consecutiveFailures++
    this.metrics.consecutiveFailures = this.consecutiveFailures
    if (this.consecutiveFailures < this.cfg.maxRetries) {
      const retryDelay = Math.min(
        Math.round(
          this.cfg.initialRetryDelayMs *
            Math.pow(this.cfg.retryBackoffFactor, this.consecutiveFailures - 1)
        ),
        this.cfg.maxRetryDelayMs
      )
      this.logger.debug('Scheduling quick retry', {
        retryDelay,
        attempt: this.consecutiveFailures
      })
      await this.delay(retryDelay)
      if (!this.running || this.paused || this.destroyed) return
      await this.performHealthCheck(false)
      return
    }

    // max retries aşıldı -> browser source offline
    const t = this.now()
    this.browserSource = {
      status: 'offline',
      timestamp: t,
      provider: 'browser'
    }
    this.currentInterval = Math.min(
      Math.round(
        this.cfg.baseIntervalMs * this.cfg.offlineInitialIntervalMultiplier
      ),
      this.cfg.maxIntervalMs
    )
    this.metrics.currentIntervalMs = this.currentInterval
    this.composeAndMaybeEmit('check:fail:maxRetries')
  }

  private handleSuccess(result: InternalCheckResult): void {
    const now = this.now()
    this.metrics.successfulChecks++
    this.metrics.lastSuccessTs = now
    this.consecutiveFailures = 0
    this.metrics.consecutiveFailures = 0
    if (result.rttMs !== undefined) {
      this.updateRttMetrics(result.rttMs)
    }
    this.currentInterval = this.cfg.baseIntervalMs
    this.metrics.currentIntervalMs = this.currentInterval
    this.browserSource = {
      status: 'online',
      timestamp: now,
      provider: 'browser'
    }
    this.composeAndMaybeEmit('check:success')
  }

  private handleFail(result?: InternalCheckResult): void {
    const now = this.now()
    this.metrics.failedChecks++
    this.metrics.lastFailureTs = now
    this.currentInterval = Math.min(
      Math.round(
        this.currentInterval *
          (this.currentStatus === 'offline'
            ? this.cfg.degradedGrowthFactor
            : this.cfg.retryBackoffFactor)
      ),
      this.cfg.maxIntervalMs
    )
    this.metrics.currentIntervalMs = this.currentInterval

    const isFinal = this.consecutiveFailures + 1 >= this.cfg.maxRetries
    this.emitErrorEvent({
      error: result?.error ?? new Error('Unknown network failure'),
      attempt: this.consecutiveFailures + 1,
      isFinal,
      reason: 'check:fail',
      kind: result?.errorKind || 'other',
      httpStatus: result?.statusCode,
      urlTried: result?.url
    })
  }

  private registerSkipped(): void {
    this.metrics.skippedChecks++
  }

  private async tryUrl(url: string): Promise<InternalCheckResult> {
    const full = this.appendHealthPath(url)
    if (this.cfg.preferHead) {
      const head = await this.fetchWithTiming(full, 'HEAD')
      if (head.ok) return head
    }
    return this.fetchWithTiming(full, 'GET')
  }

  // ---------------- Helpers: Fetch & Metrics ----------------

  private async fetchWithTiming(
    url: string,
    method: 'HEAD' | 'GET'
  ): Promise<InternalCheckResult> {
    const started = this.now()
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.cfg.requestTimeoutMs
    )
    const finalUrl = cacheBuster(url)
    try {
      const resp = await this.fetchFn(finalUrl, {
        method,
        cache: 'no-store',
        mode: 'cors',
        signal: controller.signal,
        headers: method === 'GET' ? { Accept: 'text/plain' } : undefined
      })
      const rtt = this.now() - started
      clearTimeout(timer)
      if (resp.type === 'opaque' || resp.type === 'opaqueredirect') {
        return { ok: true, url: finalUrl, rttMs: rtt }
      }
      if (resp.ok) {
        return { ok: true, url: finalUrl, rttMs: rtt, statusCode: resp.status }
      }
      return {
        ok: false,
        url: finalUrl,
        rttMs: rtt,
        statusCode: resp.status,
        error: new Error(`HTTP ${resp.status}`),
        errorKind: 'http-error'
      }
    } catch (err: any) {
      clearTimeout(timer)
      const rtt = this.now() - started
      return {
        ok: false,
        url: finalUrl,
        rttMs: rtt,
        error: err,
        errorKind: classifyError(err)
      }
    }
  }

  private updateRttMetrics(rtt: number): void {
    if (this.ewmaRtt == null) {
      this.ewmaRtt = rtt
    } else {
      this.ewmaRtt =
        this.cfg.ewmaAlpha * rtt + (1 - this.cfg.ewmaAlpha) * this.ewmaRtt
    }
    if (this.minRtt == null || rtt < this.minRtt) this.minRtt = rtt
    if (this.maxRtt == null || rtt > this.maxRtt) this.maxRtt = rtt
    this.metrics.averageRttMs = this.ewmaRtt
    this.metrics.minRttMs = this.minRtt
    this.metrics.maxRttMs = this.maxRtt
  }

  private rateLimitAllow(now: number): boolean {
    const cutoff = now - 60 * 60_000
    this.checksWindow = this.checksWindow.filter((ts) => ts >= cutoff)
    if (this.checksWindow.length >= this.cfg.maxChecksPerHour) return false
    this.checksWindow.push(now)
    return true
  }

  private delay(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms))
  }

  // ---------------- Status / Flap / Durations ----------------

  private registerFlap(now: number): void {
    this.flapTimestamps.push(now)
    this.totalTransitions++
    this.metrics.totalTransitions = this.totalTransitions
    this.metrics.flapCountTotal = this.totalTransitions
    this.pruneFlapWindow(now)
  }

  private pruneFlapWindow(now: number): void {
    const cutoff = now - this.cfg.flapWindowMs
    while (this.flapTimestamps.length && this.flapTimestamps[0] < cutoff) {
      this.flapTimestamps.shift()
    }
  }

  private updateDurations(now: number): void {
    const delta = now - this.statusLastChangedTs
    if (this.currentStatus === 'online') {
      this.metrics.totalOnlineDurationMs += delta
    } else {
      this.metrics.totalOfflineDurationMs += delta
    }
    this.metrics.currentStatusDurationMs = now - this.statusLastChangedTs
    this.metrics.statusLastChangedTs = this.statusLastChangedTs
    this.metrics.onlineSinceTs = this.onlineSinceTs
    this.metrics.offlineSinceTs = this.offlineSinceTs
  }

  // ---------------- Network Info ----------------

  private readNetworkInfo(): NetworkInfo {
    const connection = (navigator as any)?.connection
    return {
      type: this.mapConnectionType(connection?.type),
      effectiveType: connection?.effectiveType || 'unknown',
      downlinkMBps: connection?.downlink ? connection.downlink / 8 : 0,
      rtt: connection?.rtt || 0
    }
  }

  private mapConnectionType(t?: string): NetworkType {
    switch (t) {
      case 'wifi':
        return 'wifi'
      case 'cellular':
        return 'cellular'
      case 'ethernet':
        return 'ethernet'
      default:
        return 'unknown'
    }
  }

  // ---------------- URL Helpers ----------------

  private prepareUrlList(): string[] {
    const baseList =
      this.cfg.checkUrls && this.cfg.checkUrls.length > 0
        ? [...this.cfg.checkUrls]
        : this.cfg.primaryUrl
          ? [this.cfg.primaryUrl]
          : []
    return baseList
  }

  private appendHealthPath(url: string): string {
    if (!this.cfg.healthPath) return url
    try {
      new URL(url)
      return url
    } catch {
      return joinUrl(url, this.cfg.healthPath)
    }
  }

  // ---------------- Utils ----------------

  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof navigator !== 'undefined'
  }

  private emitErrorEvent(e: {
    error: unknown
    attempt: number
    isFinal: boolean
    reason: string
    kind: NetworkErrorKind
    httpStatus?: number
    urlTried?: string
  }): void {
    const evt: NetworkErrorEvent = {
      error: e.error,
      attempt: e.attempt,
      isFinal: e.isFinal,
      timestamp: this.now(),
      reason: e.reason,
      kind: e.kind,
      httpStatus: e.httpStatus,
      urlTried: e.urlTried
    }
    this.error$.next(evt)
  }
}
