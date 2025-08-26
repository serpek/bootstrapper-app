/**
 * ActivityMonitor (Rev 4.1.3 - Renamed)
 * -----------------------------------------------------------------------------
 * RENAMING / REBRANDING CHANGE:
 *  - Former name: UserSystemActivityObserver
 *  - All public facing identifiers & docs now use "ActivityMonitor"
 *  - Config, factory, log object, default config all updated accordingly.
 *
 * SCOPE:
 *  - Monitors user interactions + browser (visibility/focus) + multi-tab leadership
 *  - Optionally integrates Electron (IPC events) without importing electron
 *  - System heuristics: inactivity timeout, idle, (heuristic) screen lock
 *  - RxJS observable status stream
 *  - Uses tslog for structured logging
 *
 * Behavior (unchanged from Rev 4.1.2 except naming):
 *  - isActive = (isLeaderTab if leadership enabled) && inactivityTimeout not exceeded
 *  - Other states (blur, hidden, minimized, lock) do NOT immediately force isActive=false
 *    unless they indirectly prevent new activity until timeout elapses.
 */

import {
  BehaviorSubject,
  distinctUntilChanged,
  fromEvent,
  interval,
  map,
  Observable,
  shareReplay,
  Subscription,
  takeUntil,
  throttleTime
} from 'rxjs'
import { Logger as TsLogLogger } from 'tslog'

import { isElectronStatus, mapLogLevelToTsLog, now } from './helpers'
import {
  ActivityMetrics,
  ActivityMonitorConfig,
  ActivityMonitorLogObj,
  ActivityReason,
  ActivityStatus,
  ActivityStatusElectron,
  ActivityStatusWeb,
  BaseActivityStatus,
  ElectronEvent,
  ElectronIpcAdapter,
  InternalBroadcastMessage,
  LogLevel
} from './types'

export const DEFAULT_ACTIVITY_MONITOR_CONFIG: Required<
  Omit<
    ActivityMonitorConfig,
    'debug' | 'detailedLogging' | 'logLevel' | 'statusLogAt'
  >
> & {
  logLevel: LogLevel
  statusLogAt: 'trace' | 'debug'
  debug?: boolean
  detailedLogging?: boolean
} = {
  inactivityTimeout: 15000,
  systemIdleThreshold: 300000,
  screenLockCheckInterval: 60000,
  throttleTime: 100,

  trackWindowStates: true,
  trackUserInteractions: true,
  trackSystemStates: true,
  trackNetworkStates: true,
  enableScreenLockDetection: true,
  enableElectronListener: true,

  electronIpcChannel: 'electron-activity',
  electronHeartbeatInterval: 15000,

  logLevel: LogLevel.INFO,
  statusLogAt: 'debug',

  mouseContinuousQuietMs: 3000,
  scrollContinuousQuietMs: 2000,
  clickCooldownMs: 500,
  enableLeadership: true,
  leadershipStrategy: 'optimistic',
  leadershipHeartbeatInterval: 4000,
  leadershipStaleThreshold: 8000,
  screenLockHeuristicIdleMultiplier: 3,
  reasonHistoryLimit: 50,

  countWhileHidden: false,
  countWhileBlurred: false,
  minEmitIntervalMs: 150,
  forceWindowVisibleTrue: false,
  allowInactiveWhileBackground: true,

  traceUseConsoleLog: true,
  forceTraceVisible: true,

  debug: false,
  detailedLogging: false
}

export class ActivityMonitor {
  public readonly status$: Observable<ActivityStatus>
  private readonly config: typeof DEFAULT_ACTIVITY_MONITOR_CONFIG
  private readonly logger: TsLogLogger<ActivityMonitorLogObj>
  private readonly _statusSubject: BehaviorSubject<ActivityStatus>
  private readonly statusInternal$: Observable<ActivityStatus>
  private destroyed = false
  private started = false
  private lastActivityTime = now()
  private lastMouseEmitTime = 0
  private lastScrollEmitTime = 0
  private lastAnyMouseEventTime = 0
  private lastKeyboardEventTime = 0
  private lastScrollEventTime = 0
  private lastTouchEventTime = 0
  private lastClickTime = 0
  private screenLocked = false
  private systemIdle = false
  private electronSystemIdle = false
  private electronConnected = false
  private electronAppFocused = false
  private electronWindowMinimized = false
  private networkOnline = true
  private windowFocused =
    typeof document !== 'undefined' ? document.hasFocus() : true
  private pageVisible =
    typeof document !== 'undefined'
      ? document.visibilityState === 'visible'
      : true
  private windowVisible = true
  private readonly tabId: string = this.generateTabId()
  private leaderTabId: string | null = null
  private isLeaderTab = false
  private broadcastChannel?: BroadcastChannel
  private lastHeartbeatReceived = now()
  private leadershipIntervalSub?: Subscription
  private leadershipMessagesSub?: Subscription
  private electronIpcAdapter?: ElectronIpcAdapter
  private boundElectronListener?: (event: unknown, data: ElectronEvent) => void
  private inactivityCheckSub?: Subscription
  private screenLockHeuristicSub?: Subscription
  private systemIdleHeuristicSub?: Subscription
  private compositeSub = new Subscription()
  private reasonHistory: ActivityReason[] = []
  private metrics: ActivityMetrics = {
    emissionCount: 0,
    userInteractionCount: 0,
    mouseEventCount: 0,
    keyboardEventCount: 0,
    touchEventCount: 0,
    scrollEventCount: 0,
    focusEventCount: 0,
    blurEventCount: 0,
    visibilityEventCount: 0,
    electronEventCount: 0,
    leadershipChangeCount: 0,
    inactivityTimeoutCount: 0,
    screenLockHeuristicCount: 0,
    systemIdleHeuristicCount: 0
  }
  private lastEmitTs = 0
  private pendingEmit: { reason: ActivityReason; force: boolean } | null = null
  private emitScheduled = false

  constructor(
    config: ActivityMonitorConfig = {},
    logger?: TsLogLogger<ActivityMonitorLogObj>,
    electronIpcAdapter?: ElectronIpcAdapter
  ) {
    this.config = { ...DEFAULT_ACTIVITY_MONITOR_CONFIG, ...config }
    if (config.debug && !config.logLevel) {
      this.config.logLevel = LogLevel.DEBUG
    }

    this.logger =
      logger ??
      new TsLogLogger<ActivityMonitorLogObj>({
        name: 'ActivityMonitor',
        minLevel: mapLogLevelToTsLog(this.config.logLevel)
      })

    if (config.detailedLogging) {
      this.logger.warn(
        'detailedLogging is deprecated. Use logLevel=TRACE or statusLogAt=trace.'
      )
    }

    this.electronIpcAdapter = electronIpcAdapter

    const initialStatus = this.buildStatus('initialization')
    this._statusSubject = new BehaviorSubject<ActivityStatus>(initialStatus)
    this.statusInternal$ = this._statusSubject
      .asObservable()
      .pipe(shareReplay(1))
    this.status$ = this.statusInternal$

    this.logger.debug('Initialized ActivityMonitor', {
      tabId: this.tabId,
      config: this.config as any
    })
  }

  public get current(): ActivityStatus {
    return this._statusSubject.getValue()
  }

  start(): void {
    if (this.started) {
      this.logger.debug('Already started')
      return
    }
    this.started = true

    this.emitStatus('initialization', true)

    this.setupUserInteractionListeners()
    this.setupWindowVisibilityListeners()
    this.setupInactivityTimer()
    this.setupScreenLockHeuristic()
    this.setupSystemIdleHeuristic()
    if (this.config.enableLeadership) this.setupLeadershipChannel()
    else {
      this.isLeaderTab = true
      this.leaderTabId = this.tabId
    }
    this.setupElectronIpc()
  }

  stop(): void {
    if (!this.started || this.destroyed) return
    this.started = false
    this.destroyed = true

    this.teardownElectronIpc()
    this.teardownLeadershipChannel()

    this.compositeSub.unsubscribe()
    this.inactivityCheckSub?.unsubscribe()
    this.screenLockHeuristicSub?.unsubscribe()
    this.systemIdleHeuristicSub?.unsubscribe()
    this.leadershipIntervalSub?.unsubscribe()
    this.leadershipMessagesSub?.unsubscribe()

    this._statusSubject.complete()
    this.logger.info('ActivityMonitor stopped & cleaned')
  }

  subscribe(next: (status: ActivityStatus) => void) {
    return this.status$.subscribe(next)
  }

  getStatus(): ActivityStatus {
    return this._statusSubject.getValue()
  }

  updateNetworkStatus(online: boolean) {
    if (this.networkOnline === online) return
    this.networkOnline = online
    this.emitStatus(online ? 'network_online' : 'network_offline')
  }

  injectElectronEvent(ev: ElectronEvent) {
    this.handleElectronEvent(ev)
  }

  configure(patch: Partial<ActivityMonitorConfig>) {
    const mutableKeys: (keyof ActivityMonitorConfig)[] = [
      'inactivityTimeout',
      'systemIdleThreshold',
      'screenLockCheckInterval',
      'throttleTime',
      'mouseContinuousQuietMs',
      'scrollContinuousQuietMs',
      'clickCooldownMs',
      'leadershipHeartbeatInterval',
      'leadershipStaleThreshold',
      'screenLockHeuristicIdleMultiplier',
      'reasonHistoryLimit',
      'logLevel',
      'statusLogAt',
      'countWhileHidden',
      'countWhileBlurred',
      'minEmitIntervalMs',
      'forceWindowVisibleTrue',
      'allowInactiveWhileBackground',
      'traceUseConsoleLog',
      'forceTraceVisible'
    ]
    let needsStatus = false
    for (const k of mutableKeys) {
      if (patch[k] !== undefined) {
        // @ts-expect-error dynamic assign
        this.config[k] = patch[k]
        if (k === 'logLevel') {
          this.setLogLevel(this.config.logLevel)
        }
        needsStatus = true
      }
    }
    this.logger.info('Config updated', patch as any)
    if (needsStatus) this.forceRefresh('user_interaction')
  }

  forceRefresh(reason: ActivityReason = 'user_interaction') {
    this.emitStatus(reason, true)
  }

  setLogLevel(level: LogLevel) {
    if (this.config.logLevel !== level) {
      this.config.logLevel = level
    }
    this.updateLoggerMinLevel(level)
    this.logger.info('Log level updated', { level })
  }

  private updateLoggerMinLevel(level: LogLevel) {
    const target = mapLogLevelToTsLog(level)
    const anyLogger: any = this.logger
    if (typeof anyLogger.setSettings === 'function') {
      try {
        anyLogger.setSettings({ minLevel: target })
        return
      } catch {
        // fallback
      }
    }
    if (anyLogger.settings) {
      anyLogger.settings.minLevel = target
    }
  }

  /* ----------------------------- Core Logic -------------------------------- */

  private computeIsActive(): boolean {
    if (this.config.enableLeadership && !this.isLeaderTab) return false
    const inactiveMs = now() - this.lastActivityTime
    if (inactiveMs >= this.config.inactivityTimeout) return false
    return true
  }

  private buildStatus(reason: ActivityReason): ActivityStatus {
    const inactiveTimeMs = now() - this.lastActivityTime

    if (!this.electronConnected) {
      this.windowVisible = this.config.forceWindowVisibleTrue
        ? true
        : this.pageVisible && this.windowFocused
    }

    const base: BaseActivityStatus = {
      isActive: false,
      lastActivityTime: this.lastActivityTime,
      inactiveTimeMs,
      windowVisible: this.windowVisible,
      windowFocused: this.windowFocused,
      pageVisible: this.pageVisible,
      hasMouseActivity: this.lastAnyMouseEventTime > 0,
      hasKeyboardActivity: this.lastKeyboardEventTime > 0,
      hasTouchActivity: this.lastTouchEventTime > 0,
      hasScrollActivity: this.lastScrollEventTime > 0,
      screenLocked: this.screenLocked,
      systemIdle: this.systemIdle,
      networkOnline: this.networkOnline,
      platform: this.electronConnected ? 'electron' : 'web',
      detectionMethods: this.collectDetectionMethods(),
      reason,
      reasonHistory: [...this.reasonHistory],
      timestamp: now(),
      isLeaderTab: this.isLeaderTab,
      tabId: this.tabId,
      leaderTabId: this.leaderTabId,
      metrics: { ...this.metrics }
    }

    if (this.electronConnected) {
      const st: ActivityStatusElectron = {
        ...base,
        platform: 'electron',
        electronConnected: this.electronConnected,
        electronAppFocused: this.electronAppFocused,
        electronWindowMinimized: this.electronWindowMinimized,
        electronSystemIdle: this.electronSystemIdle
      }
      st.isActive = this.computeIsActive()
      return st
    }
    const w: ActivityStatusWeb = {
      ...base,
      platform: 'web',
      electronConnected: false
    }
    w.isActive = this.computeIsActive()
    return w
  }

  private emitStatus(reason: ActivityReason, force = false) {
    const nowTs = now()
    if (!force && nowTs - this.lastEmitTs < this.config.minEmitIntervalMs) {
      this.pendingEmit = { reason, force: false }
      if (!this.emitScheduled) {
        this.emitScheduled = true
        setTimeout(() => {
          this.emitScheduled = false
          const p = this.pendingEmit
          this.pendingEmit = null
          if (p) this.emitStatus(p.reason, p.force)
        }, this.config.minEmitIntervalMs)
      }
      return
    }

    if (reason !== 'initialization') {
      this.reasonHistory.push(reason)
      if (this.reasonHistory.length > this.config.reasonHistoryLimit) {
        this.reasonHistory.shift()
      }
    }

    const newStatus = this.buildStatus(reason)
    const prev = this._statusSubject.getValue()
    const changed = force || this.statusChanged(prev, newStatus)
    if (changed) {
      this.metrics.emissionCount++
      this._statusSubject.next(newStatus)
      this.lastEmitTs = nowTs
      const logPayload: ActivityMonitorLogObj = {
        isActive: newStatus.isActive,
        reason,
        inactiveMs: newStatus.inactiveTimeMs,
        leader: newStatus.isLeaderTab
      }
      if (this.config.statusLogAt === 'trace') {
        this.logger.trace('Status', logPayload)
      } else {
        this.logger.debug('Status', logPayload)
      }
    }
  }

  private statusChanged(a: ActivityStatus, b: ActivityStatus): boolean {
    const changed =
      a.isActive !== b.isActive ||
      a.reason !== b.reason ||
      a.lastActivityTime !== b.lastActivityTime ||
      a.leaderTabId !== b.leaderTabId ||
      a.isLeaderTab !== b.isLeaderTab ||
      a.electronConnected !== b.electronConnected
    if (changed) return true

    const aElectron = isElectronStatus(a)
    const bElectron = isElectronStatus(b)
    if (aElectron && bElectron) {
      if (a.electronWindowMinimized !== b.electronWindowMinimized) return true
      if (a.electronAppFocused !== b.electronAppFocused) return true
      if (a.electronSystemIdle !== b.electronSystemIdle) return true
    } else if (aElectron !== bElectron) return true

    return false
  }

  private collectDetectionMethods(): string[] {
    const methods: string[] = []
    if (this.config.trackUserInteractions) methods.push('user')
    if (this.config.trackWindowStates) methods.push('visibility')
    if (this.config.trackSystemStates) methods.push('system')
    if (this.config.enableScreenLockDetection) methods.push('screenLock')
    if (this.config.enableElectronListener && this.electronConnected)
      methods.push('electron')
    if (this.config.trackNetworkStates) methods.push('network')
    if (this.config.enableLeadership) methods.push('multiTab')
    return methods
  }

  /* --------------------- Interaction & Foreground Logic -------------------- */

  private canCountInteraction(): boolean {
    if (!this.config.trackUserInteractions) return false
    if (!this.pageVisible && !this.config.countWhileHidden) return false
    if (!this.windowFocused && !this.config.countWhileBlurred) return false
    return true
  }

  private setupUserInteractionListeners() {
    if (!this.config.trackUserInteractions || typeof window === 'undefined')
      return

    const mouseMove$ = fromEvent<MouseEvent>(window, 'mousemove')
    const click$ = fromEvent<MouseEvent>(window, 'mousedown')
    const key$ = fromEvent<KeyboardEvent>(window, 'keydown')
    const touch$ = fromEvent<TouchEvent>(window, 'touchstart')
    const scroll$ = fromEvent<Event>(window, 'scroll', { passive: true })

    mouseMove$
      .pipe(
        throttleTime(this.config.throttleTime, undefined, {
          leading: true,
          trailing: false
        }),
        takeUntil(this.onDestroy$())
      )
      .subscribe(() => {
        const t = now()
        this.metrics.mouseEventCount++
        this.lastAnyMouseEventTime = t
        if (this.canCountInteraction()) {
          const quietEnough =
            t - this.lastMouseEmitTime >= this.config.mouseContinuousQuietMs
          this.lastActivityTime = t
          if (quietEnough) {
            this.lastMouseEmitTime = t
            this.metrics.userInteractionCount++
            this.emitStatus('mouse_activity')
            this.broadcastClaimLeadership(t)
          }
        }
      })

    click$.pipe(takeUntil(this.onDestroy$())).subscribe(() => {
      const t = now()
      if (!this.canCountInteraction()) return
      const since = t - this.lastClickTime
      if (since < this.config.clickCooldownMs) return
      this.lastClickTime = t
      this.metrics.mouseEventCount++
      this.registerUserInteraction('mouse_activity')
    })

    key$
      .pipe(
        throttleTime(this.config.throttleTime, undefined, {
          leading: true,
          trailing: true
        }),
        takeUntil(this.onDestroy$())
      )
      .subscribe(() => {
        if (!this.canCountInteraction()) return
        this.metrics.keyboardEventCount++
        this.lastKeyboardEventTime = now()
        this.registerUserInteraction('keyboard_activity')
      })

    touch$
      .pipe(
        throttleTime(this.config.throttleTime),
        takeUntil(this.onDestroy$())
      )
      .subscribe(() => {
        if (!this.canCountInteraction()) return
        this.metrics.touchEventCount++
        this.lastTouchEventTime = now()
        this.registerUserInteraction('touch_activity')
      })

    scroll$
      .pipe(
        throttleTime(this.config.throttleTime),
        takeUntil(this.onDestroy$())
      )
      .subscribe(() => {
        const t = now()
        if (!this.canCountInteraction()) return
        this.metrics.scrollEventCount++
        this.lastScrollEventTime = t
        this.lastActivityTime = t
        const quietEnough =
          t - this.lastScrollEmitTime >= this.config.scrollContinuousQuietMs
        if (quietEnough) {
          this.lastScrollEmitTime = t
          this.metrics.userInteractionCount++
          this.emitStatus('scroll_activity')
          this.broadcastClaimLeadership(t)
        }
      })
  }

  private registerUserInteraction(reason: ActivityReason) {
    const t = now()
    if (!this.canCountInteraction()) return
    this.lastActivityTime = t
    this.metrics.userInteractionCount++
    this.emitStatus(reason)
    this.broadcastClaimLeadership(t)
  }

  /* ---------------------- Window / Visibility Listeners -------------------- */

  private setupWindowVisibilityListeners() {
    if (!this.config.trackWindowStates || typeof document === 'undefined')
      return

    if (typeof document.addEventListener === 'function') {
      const visibility$ = fromEvent(document, 'visibilitychange').pipe(
        map(() => document.visibilityState === 'visible'),
        distinctUntilChanged()
      )
      this.compositeSub.add(
        visibility$.subscribe((visible) => {
          this.metrics.visibilityEventCount++
          this.pageVisible = visible
          this.emitStatus(visible ? 'page_visible' : 'page_hidden')
        })
      )
    }

    fromEvent(window, 'focus')
      .pipe(takeUntil(this.onDestroy$()))
      .subscribe(() => {
        this.metrics.focusEventCount++
        this.windowFocused = true
        this.registerUserInteraction('window_focus')
      })

    fromEvent(window, 'blur')
      .pipe(takeUntil(this.onDestroy$()))
      .subscribe(() => {
        this.metrics.blurEventCount++
        this.windowFocused = false
        this.emitStatus('window_blur')
      })
  }

  /* ----------------------- Inactivity / Idle Logic ------------------------- */

  private setupInactivityTimer() {
    const poll$ = interval(1000).pipe(takeUntil(this.onDestroy$()))
    this.inactivityCheckSub = poll$.subscribe(() => {
      const inactiveMs = now() - this.lastActivityTime
      const prev = this._statusSubject.getValue()
      if (
        inactiveMs >= this.config.inactivityTimeout &&
        prev.isActive &&
        this.isLeaderTab
      ) {
        this.metrics.inactivityTimeoutCount++
        this.emitStatus('inactivity_timeout')
      }
    })
  }

  private setupSystemIdleHeuristic() {
    if (!this.config.trackSystemStates) return
    this.systemIdleHeuristicSub = interval(2000)
      .pipe(takeUntil(this.onDestroy$()))
      .subscribe(() => {
        if (this.electronSystemIdle) return
        const inactiveMs = now() - this.lastActivityTime
        const threshold = this.config.systemIdleThreshold
        const prevIdle = this.systemIdle
        const newIdle = inactiveMs >= threshold
        if (newIdle !== prevIdle) {
          this.systemIdle = newIdle
          this.emitStatus(newIdle ? 'system_idle' : 'system_active')
        }
      })
  }

  private setupScreenLockHeuristic() {
    if (!this.config.enableScreenLockDetection) return
    this.screenLockHeuristicSub = interval(this.config.screenLockCheckInterval)
      .pipe(takeUntil(this.onDestroy$()))
      .subscribe(() => {
        if (this.electronConnected) return
        const inactiveMs = now() - this.lastActivityTime
        const required =
          this.config.inactivityTimeout *
          this.config.screenLockHeuristicIdleMultiplier
        const shouldLock =
          inactiveMs >= required &&
          !this.pageVisible &&
          !this.windowFocused &&
          this.systemIdle
        if (shouldLock && !this.screenLocked) {
          this.screenLocked = true
          this.metrics.screenLockHeuristicCount++
          this.emitStatus('screen_lock')
        } else if (!shouldLock && this.screenLocked) {
          this.screenLocked = false
          this.emitStatus('screen_unlock')
        }
      })
  }

  /* ----------------------- Multi-Tab Leadership --------------------------- */

  private setupLeadershipChannel() {
    if (!this.config.enableLeadership) return
    if (typeof BroadcastChannel === 'undefined') {
      this.isLeaderTab = true
      this.leaderTabId = this.tabId
      return
    }
    this.broadcastChannel = new BroadcastChannel('activity-monitor-channel')
    const messages$ = fromEvent<MessageEvent>(
      this.broadcastChannel,
      'message'
    ).pipe(
      map((ev) => ev.data as InternalBroadcastMessage),
      takeUntil(this.onDestroy$())
    )
    this.leadershipMessagesSub = messages$.subscribe((msg) =>
      this.handleBroadcastMessage(msg)
    )

    if (this.config.leadershipStrategy === 'optimistic') {
      this.isLeaderTab = true
      this.leaderTabId = this.tabId
      this.emitStatus('leadership_gain')
      this.postBroadcast({
        kind: 'claim',
        tabId: this.tabId,
        ts: now(),
        lastActivity: this.lastActivityTime
      })
    } else {
      this.broadcastClaimLeadership(this.lastActivityTime)
    }

    this.leadershipIntervalSub = interval(
      this.config.leadershipHeartbeatInterval
    )
      .pipe(takeUntil(this.onDestroy$()))
      .subscribe(() => {
        if (!this.config.enableLeadership) return
        if (this.isLeaderTab) {
          this.postBroadcast({
            kind: 'heartbeat',
            tabId: this.tabId,
            ts: now(),
            lastActivity: this.lastActivityTime
          })
        } else {
          if (
            now() - this.lastHeartbeatReceived >
            this.config.leadershipStaleThreshold
          ) {
            this.broadcastClaimLeadership(this.lastActivityTime)
          }
        }
      })
  }

  private teardownLeadershipChannel() {
    try {
      this.broadcastChannel?.close()
    } catch (e) {
      this.logger.error('BroadcastChannel close error', e)
    }
  }

  private broadcastClaimLeadership(lastActivity: number) {
    if (!this.config.enableLeadership) return
    if (!this.broadcastChannel) {
      if (!this.isLeaderTab) {
        this.isLeaderTab = true
        this.leaderTabId = this.tabId
        this.emitStatus('leadership_gain')
      }
      return
    }
    this.postBroadcast({
      kind: 'claim',
      tabId: this.tabId,
      ts: now(),
      lastActivity
    })
  }

  private handleBroadcastMessage(msg: InternalBroadcastMessage) {
    if (!this.config.enableLeadership) return
    switch (msg.kind) {
      case 'heartbeat':
        if (this.leaderTabId === msg.tabId) {
          this.lastHeartbeatReceived = now()
        }
        break
      case 'claim':
        this.resolveLeadershipClaim(msg)
        break
      case 'leader-change':
        if (msg.newLeader !== this.leaderTabId) {
          this.leaderTabId = msg.newLeader
          const wasLeader = this.isLeaderTab
          this.isLeaderTab = this.tabId === msg.newLeader
          if (wasLeader && !this.isLeaderTab) {
            this.metrics.leadershipChangeCount++
            this.emitStatus('leadership_loss')
          } else if (!wasLeader && this.isLeaderTab) {
            this.metrics.leadershipChangeCount++
            this.emitStatus('leadership_gain')
          }
        }
        break
      case 'release':
        if (this.leaderTabId === msg.tabId) {
          this.broadcastClaimLeadership(this.lastActivityTime)
        }
        break
    }
  }

  private resolveLeadershipClaim(
    claim: Extract<InternalBroadcastMessage, { kind: 'claim' }>
  ) {
    if (!this.leaderTabId) {
      this.assignLeader(claim.tabId)
      return
    }
    if (this.leaderTabId === this.tabId) {
      if (claim.lastActivity > this.lastActivityTime) {
        this.assignLeader(claim.tabId)
      }
    } else {
      if (
        now() - this.lastHeartbeatReceived >
        this.config.leadershipStaleThreshold
      ) {
        this.assignLeader(claim.tabId)
      }
    }
  }

  private assignLeader(newLeader: string) {
    if (!this.broadcastChannel) {
      this.isLeaderTab = true
      this.leaderTabId = this.tabId
      return
    }
    this.leaderTabId = newLeader
    const wasLeader = this.isLeaderTab
    this.isLeaderTab = this.tabId === newLeader
    this.postBroadcast({
      kind: 'leader-change',
      tabId: this.tabId,
      newLeader,
      ts: now()
    })
    if (wasLeader && !this.isLeaderTab) {
      this.metrics.leadershipChangeCount++
      this.emitStatus('leadership_loss')
    } else if (!wasLeader && this.isLeaderTab) {
      this.metrics.leadershipChangeCount++
      this.emitStatus('leadership_gain')
    }
  }

  private postBroadcast(msg: InternalBroadcastMessage) {
    try {
      this.broadcastChannel?.postMessage(msg)
    } catch (e) {
      this.logger.error('Broadcast post error', e)
    }
  }

  /* --------------------------- Electron IPC -------------------------------- */

  private setupElectronIpc() {
    if (!this.config.enableElectronListener) return
    if (!this.electronIpcAdapter) return

    this.boundElectronListener = (_event, data) => {
      this.handleElectronEvent(data)
    }
    try {
      this.electronIpcAdapter.on(
        this.config.electronIpcChannel,
        this.boundElectronListener
      )
      this.logger.info(
        'Electron IPC listener attached',
        this.config.electronIpcChannel
      )
    } catch (e) {
      this.logger.error('Electron IPC attach error', e)
    }
  }

  private teardownElectronIpc() {
    if (this.electronIpcAdapter && this.boundElectronListener) {
      try {
        this.electronIpcAdapter.removeListener(
          this.config.electronIpcChannel,
          this.boundElectronListener
        )
      } catch (e) {
        this.logger.error('Electron IPC remove error', e)
      }
    }
  }

  private handleElectronEvent(ev: ElectronEvent) {
    if (!ev || typeof ev !== 'object' || !('type' in ev)) {
      this.logger.warn('Invalid electron event payload', ev)
      return
    }
    this.metrics.electronEventCount++
    this.electronConnected = true

    switch (ev.type) {
      case 'focus':
        this.electronAppFocused = true
        this.registerUserInteraction('electron_focus')
        break
      case 'blur':
        this.electronAppFocused = false
        this.emitStatus('electron_blur')
        break
      case 'minimize':
        this.electronWindowMinimized = true
        this.emitStatus('electron_minimize')
        break
      case 'restore':
        this.electronWindowMinimized = false
        this.emitStatus('electron_restore')
        break
      case 'system-idle':
        this.electronSystemIdle = true
        this.systemIdle = true
        this.emitStatus('electron_system_idle')
        break
      case 'system-active':
        this.electronSystemIdle = false
        this.systemIdle = false
        this.emitStatus('electron_system_active')
        break
      case 'heartbeat':
        this.emitStatus('electron_heartbeat')
        break
      default:
        this.logger.warn('Unhandled electron event type', (ev as any).type)
    }
  }

  /* ----------------------------- Helper Streams ----------------------------- */

  private onDestroy$(): Observable<void> {
    return new Observable<void>((subscriber) => {
      if (this.destroyed) {
        subscriber.complete()
        return
      }
      const originalStop = this.stop.bind(this)
      this.stop = () => {
        originalStop()
        subscriber.next()
        subscriber.complete()
      }
    })
  }

  private generateTabId(): string {
    return (
      'tab-' +
      Math.random().toString(36).slice(2, 10) +
      '-' +
      Date.now().toString(36)
    )
  }
}

/* ----------------------------- Usage Example ------------------------------- */
/**
 * import { ActivityMonitor, LogLevel, createActivityMonitor } from './activity-monitor';
 * import { Logger } from 'tslog';
 *
 * const logger = new Logger({ name: 'ActivityMonitor', minLevel: 1 }); // 1 = trace
 * const monitor = new ActivityMonitor({ logLevel: LogLevel.TRACE, statusLogAt: 'trace' }, logger);
 * monitor.start();
 * monitor.subscribe(s => console.log('[Consumer]', s.isActive, s.reason));
 *
 * // Factory:
 * const monitor2 = createActivityMonitor({ inactivityTimeout: 20000 });
 */

export function createActivityMonitor(
  config?: ActivityMonitorConfig,
  logger?: TsLogLogger<ActivityMonitorLogObj>,
  electronAdapter?: ElectronIpcAdapter
) {
  const m = new ActivityMonitor(config, logger, electronAdapter)
  m.start()
  return m
}
