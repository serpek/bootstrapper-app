/**
 * ActivityObserver (RxJS)
 * ------------------------------------------------------------
 * Kullanıcı etkinliğini gözlemler ve ActivityStatus yayınlar.
 * - RxJS tabanlı Observable/BehaviorSubject
 * - Mouse/keyboard/touch/scroll, focus/blur, visibilitychange, pageshow/pagehide
 * - Ağ online/offline
 * - (Varsa) Idle Detection API ile screen lock / system idle
 * - Electron olaylarını SADECE DİNLER; web tarafında Electron çalıştırmaz.
 *
 * Önemli davranışlar (revize):
 * - isActive yalnızca 2 durumda false olur:
 *   1) inactivityTimeout dolduğunda (kullanıcı girdisi yoksa)
 *   2) Sistem kilitli/idle olduğunda (IdleDetector/Electron)
 * - Blur/hidden gibi olaylar isActive'i anında düşürmez; yalnızca "aktivite" sayılıp idle süresini sıfırlar (isteğe bağlı).
 * - Başlangıçta "kullanıcı zaten aktif" varsayımı: startActive varsayılan true.
 *   Bu sayede sınıf create edildiğinde isActive true başlar ve inactivity_timeout hemen fırlamaz.
 * - Startup'ta sahte (backdate) lastActivityTime kullanımı kaldırıldı; lastActivityTime = now().
 * - inactivity_timeout, hiç aktif faz yaşanmamışsa yayınlanmaz (startup gürültüsünü önler).
 * - Pencere/sekme geçişlerinde coalesce (birleştirme) mantığı ile tek yayın (varsayılan 500 ms pencerede).
 */

// rxjs
import {
  BehaviorSubject,
  fromEvent,
  interval,
  merge,
  Observable,
  Subject,
  Subscription as RxSubscription
} from 'rxjs'
import {
  debounceTime as rxDebounceTime,
  distinctUntilChanged,
  filter,
  map,
  takeUntil,
  tap,
  throttleTime as rxThrottleTime
} from 'rxjs/operators'

export type ActivityReason =
  | 'user_interaction'
  | 'mouse_activity'
  | 'keyboard_activity'
  | 'touch_activity'
  | 'scroll_activity'
  | 'window_focus'
  | 'window_blur'
  | 'window_visible'
  | 'window_hidden'
  | 'page_visible'
  | 'page_hidden'
  | 'screen_lock'
  | 'screen_unlock'
  | 'system_idle'
  | 'system_active'
  | 'network_offline'
  | 'network_online'
  | 'inactivity_timeout'
  | 'electron_focus'
  | 'electron_blur'
  | 'electron_minimize'
  | 'electron_restore'
  | 'electron_system_idle'
  | 'electron_system_active'
  | 'initialization'

export interface UserInteractionEvent {
  type: 'mouse' | 'keyboard' | 'touch' | 'scroll'
  timestamp: number
  throttled?: boolean
}

export interface ElectronEvent {
  type:
    | 'focus'
    | 'blur'
    | 'minimize'
    | 'restore'
    | 'system-idle'
    | 'system-active'
    | 'heartbeat'
  data?: any
  timestamp: number
}

export interface ActivityObserverConfig {
  // Timing
  inactivityTimeout?: number // default: 30000 ms
  systemIdleThreshold?: number // IdleDetector threshold (ms), default: 60000
  screenLockCheckInterval?: number // heartbeat/durum kontrol (ms), default: 30000
  throttleTime?: number // mouse/scroll throttle (ms), default: 250
  debounceTime?: number // scroll debounce (ms), default: 150

  // Features
  trackWindowStates?: boolean
  trackUserInteractions?: boolean
  trackSystemStates?: boolean
  trackNetworkStates?: boolean
  enableScreenLockDetection?: boolean
  enableElectronListener?: boolean

  // Electron
  electronIpcChannel?: string
  electronHeartbeatInterval?: number // default: 10000

  // Logging
  debug?: boolean
  detailedLogging?: boolean // pushStatus içinde log basar (aboneniz de log basıyorsa çift görünebilir)

  // Başlangıç aktifliği
  startActive?: boolean // default: true (revize)

  // “Pencere/sekme geçişleri aktivite sayılır mı?”
  focusCountsAsActivity?: boolean // default: true
  blurCountsAsActivity?: boolean // default: true
  visibilityCountsAsActivity?: boolean // default: true
  pageshowCountsAsActivity?: boolean // default: true

  // Window/page olaylarını tek yayına indirme:
  activityCoalesceWindowMs?: number // default: 500 ms

  // Opsiyonel bağımlılıklar (test için)
  window?: Window
  document?: Document
  broadcastChannelFactory?: (name: string) => BroadcastChannel
}

declare global {
  interface Window {
    IdleDetector?: any // Experimental Idle Detection API
  }
}

export interface ActivityStatus {
  // Core
  isActive: boolean
  lastActivityTime: number
  inactiveTimeMs: number

  // Browser/Window
  windowVisible: boolean
  windowFocused: boolean
  pageVisible: boolean

  // User interactions
  hasMouseActivity: boolean
  hasKeyboardActivity: boolean
  hasTouchActivity: boolean
  hasScrollActivity: boolean

  // System
  screenLocked: boolean
  systemIdle: boolean
  networkOnline: boolean

  // Electron meta
  electronConnected: boolean
  electronAppFocused?: boolean
  electronWindowMinimized?: boolean
  electronSystemIdle?: boolean

  // Meta
  platform: 'web' | 'electron'
  detectionMethods: string[]
  reason: ActivityReason
  timestamp: number
}

function isDocumentHidden(doc: Document & any): boolean {
  if (typeof doc.hidden !== 'undefined') return !!doc.hidden
  if (typeof doc.webkitHidden !== 'undefined') return !!doc.webkitHidden
  return false
}

function getVisibilityState(
  doc: Document & any
): DocumentVisibilityState | string {
  const anyDoc = doc as any
  if (typeof doc.visibilityState === 'string') return doc.visibilityState
  if (typeof anyDoc.webkitVisibilityState === 'string')
    return anyDoc.webkitVisibilityState
  return isDocumentHidden(doc) ? 'hidden' : 'visible'
}

function now() {
  return Date.now ? Date.now() : new Date().getTime()
}

export class ActivityObserver {
  public readonly status$: Observable<ActivityStatus>
  private readonly cfg: Required<ActivityObserverConfig>
  private readonly win: Window
  private readonly doc: Document
  private statusSubject: BehaviorSubject<ActivityStatus>
  private destroyed$ = new Subject<void>()
  private subscriptions = new RxSubscription()

  // Zaman damgaları
  private lastActivityTime = now()
  private lastElectronHeartbeat = 0

  // Aktif faz yaşandı mı? (Startup'ta gereksiz inactivity_timeout yayınını engellemek için)
  private hadActivePhase = false

  // Inactivity timer
  private inactivityTimer: any = null

  // IdleDetector
  private idleDetector: any | null = null
  private idleAbortController: AbortController | null = null
  private idleDetectorActive = false

  // Electron
  private bc: BroadcastChannel | null = null

  // Dahili durumlar
  private windowFocused = false
  private pageVisible = true
  private windowVisible = true

  private hasMouseActivity = false
  private hasKeyboardActivity = false
  private hasTouchActivity = false
  private hasScrollActivity = false

  private screenLocked = false
  private systemIdle = false
  private networkOnline = true

  private electronConnected = false
  private electronAppFocused: boolean | undefined = undefined
  private electronWindowMinimized: boolean | undefined = undefined
  private electronSystemIdle: boolean | undefined = undefined

  // Coalesce (window/page olaylarını tek yayına indirmek için)
  private coalesceEmitTimer: any = null
  private coalesceReasonPending: ActivityReason | null = null

  constructor(config: ActivityObserverConfig = {}) {
    this.win = config.window ?? window
    this.doc = config.document ?? document

    this.cfg = {
      inactivityTimeout: config.inactivityTimeout ?? 30000,
      systemIdleThreshold: config.systemIdleThreshold ?? 60000,
      screenLockCheckInterval: config.screenLockCheckInterval ?? 30000,
      throttleTime: config.throttleTime ?? 250,
      debounceTime: config.debounceTime ?? 150,

      trackWindowStates: config.trackWindowStates ?? true,
      trackUserInteractions: config.trackUserInteractions ?? true,
      trackSystemStates: config.trackSystemStates ?? true,
      trackNetworkStates: config.trackNetworkStates ?? true,
      enableScreenLockDetection: config.enableScreenLockDetection ?? true,
      enableElectronListener: config.enableElectronListener ?? true,

      electronIpcChannel: config.electronIpcChannel ?? 'electron-activity-ipc',
      electronHeartbeatInterval: config.electronHeartbeatInterval ?? 10000,

      debug: config.debug ?? false,
      detailedLogging: config.detailedLogging ?? false,

      // REVIZE: default true
      startActive: config.startActive ?? true,

      focusCountsAsActivity: config.focusCountsAsActivity ?? true,
      blurCountsAsActivity: config.blurCountsAsActivity ?? true,
      visibilityCountsAsActivity: config.visibilityCountsAsActivity ?? true,
      pageshowCountsAsActivity: config.pageshowCountsAsActivity ?? true,

      activityCoalesceWindowMs: config.activityCoalesceWindowMs ?? 500,

      window: this.win,
      document: this.doc,
      broadcastChannelFactory:
        config.broadcastChannelFactory ??
        ((name: string) => new BroadcastChannel(name))
    }

    // Başlangıç lastActivityTime = now (backdate kaldırıldı)
    this.lastActivityTime = now()

    // Başlangıç durumları
    this.windowFocused = this.safeHasFocus()
    this.pageVisible = getVisibilityState(this.doc) === 'visible'
    this.windowVisible = !isDocumentHidden(this.doc)
    this.networkOnline =
      typeof this.win.navigator?.onLine === 'boolean'
        ? this.win.navigator.onLine
        : true

    const inactiveTimeMs = 0 // now - now = 0
    const hardBlocked = this.screenLocked || this.systemIdle
    const computedIsActive =
      (this.cfg.startActive || false) &&
      !hardBlocked &&
      inactiveTimeMs < this.cfg.inactivityTimeout

    // hadActivePhase: startActive true ise başlangıçta aktif faz olarak kabul edilir
    this.hadActivePhase = computedIsActive

    const detectionMethods: string[] = [
      this.cfg.trackUserInteractions ? 'user-events' : '',
      this.cfg.trackWindowStates ? 'window' : '',
      // idle-detector yalnız aktifleşince eklenecek
      this.cfg.trackNetworkStates ? 'network' : '',
      this.cfg.enableElectronListener ? 'electron-listener' : ''
    ].filter(Boolean)

    const initialStatus: ActivityStatus = {
      isActive: computedIsActive,
      lastActivityTime: this.lastActivityTime,
      inactiveTimeMs,

      windowVisible: this.windowVisible,
      windowFocused: this.windowFocused,
      pageVisible: this.pageVisible,

      hasMouseActivity: false,
      hasKeyboardActivity: false,
      hasTouchActivity: false,
      hasScrollActivity: false,

      screenLocked: false,
      systemIdle: false,
      networkOnline: this.networkOnline,

      electronConnected: false,
      electronAppFocused: undefined,
      electronWindowMinimized: undefined,
      electronSystemIdle: undefined,

      platform: 'web',
      detectionMethods,
      reason: 'initialization',
      timestamp: now()
    }

    this.statusSubject = new BehaviorSubject<ActivityStatus>(initialStatus)
    this.status$ = this.statusSubject.asObservable()

    if (this.cfg.debug) this.log('constructed initial status', initialStatus)
  }

  start(): void {
    if (this.cfg.debug) this.log('ActivityObserver.start()')

    if (this.cfg.trackWindowStates) this.installWindowStateStreams()
    if (this.cfg.trackUserInteractions) this.installUserInteractionStreams()
    if (this.cfg.trackNetworkStates) this.installNetworkStreams()
    if (this.cfg.trackSystemStates && this.cfg.enableScreenLockDetection)
      void this.installIdleDetection()
    if (this.cfg.trackSystemStates) this.installPeriodicSystemHeuristics()
    if (this.cfg.enableElectronListener) this.installElectronListeners()

    // Başlangıçta inactivity timer tam timeout süresine ayarlanır
    this.scheduleInactivityTimer()

    // Başlangıç güncelle (değişiklik varsa yayınlar)
    this.pushStatus({ reason: 'initialization' })
  }

  stop(): void {
    if (this.cfg.debug) this.log('ActivityObserver.stop()')

    this.destroyed$.next()
    this.destroyed$.complete()

    try {
      this.subscriptions.unsubscribe()
    } catch {
      // Hata yakalama, unsubscribe sırasında hata oluşursa
      if (this.cfg.debug) this.log('Subscription unsubscribe error')
    }
    this.subscriptions = new RxSubscription()

    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer)
      this.inactivityTimer = null
    }

    if (this.coalesceEmitTimer) {
      clearTimeout(this.coalesceEmitTimer)
      this.coalesceEmitTimer = null
      this.coalesceReasonPending = null
    }

    if (this.idleAbortController) {
      try {
        this.idleAbortController.abort()
      } catch {
        // Hata yakalama, abort sırasında hata oluşursa
        if (this.cfg.debug) this.log('IdleDetector abort error')
      }
      this.idleAbortController = null
    }

    if (this.bc) {
      try {
        this.bc.close()
      } catch (err) {
        // Hata yakalama, close sırasında hata oluşursa
        if (this.cfg.debug) this.log('BroadcastChannel close error:', err)
      }
      this.bc = null
    }
  }

  getCurrentStatus(): ActivityStatus {
    return this.statusSubject.getValue()
  }

  feedElectronEvent(event: ElectronEvent): void {
    this.handleElectronEvent(event)
  }

  // ------- Kurulumlar

  private installWindowStateStreams(): void {
    // Focus / Blur (window) + focusin/focusout (document)
    const focusWin$ = fromEvent(this.win, 'focus').pipe(map(() => true))
    const blurWin$ = fromEvent(this.win, 'blur').pipe(map(() => false))
    const focusIn$ = fromEvent(this.doc, 'focusin').pipe(map(() => true))
    const focusOut$ = fromEvent(this.doc, 'focusout').pipe(map(() => false))

    const windowFocused$ = merge(focusWin$, blurWin$, focusIn$, focusOut$).pipe(
      distinctUntilChanged(),
      takeUntil(this.destroyed$),
      tap((focused) => {
        this.windowFocused = focused
        const reason: ActivityReason = focused ? 'window_focus' : 'window_blur'
        if (
          (focused && this.cfg.focusCountsAsActivity) ||
          (!focused && this.cfg.blurCountsAsActivity)
        ) {
          this.registerActivity(reason, { coalesce: true })
        } else {
          this.pushStatus({ reason })
        }
      })
    )
    this.subscriptions.add(windowFocused$.subscribe())

    // Visibility
    const visibility$ = fromEvent(this.doc, 'visibilitychange').pipe(
      map(() => !isDocumentHidden(this.doc)),
      distinctUntilChanged(),
      takeUntil(this.destroyed$),
      tap((visible) => {
        this.pageVisible = getVisibilityState(this.doc) === 'visible'
        this.windowVisible = visible

        const reason: ActivityReason = visible
          ? 'window_visible'
          : 'window_hidden'
        if (this.cfg.visibilityCountsAsActivity) {
          this.registerActivity(reason, { coalesce: true })
        } else {
          this.pushStatus({ reason })
        }
      })
    )
    this.subscriptions.add(visibility$.subscribe())

    // Page lifecycle
    const pageshow$ = fromEvent<PageTransitionEvent>(this.win, 'pageshow').pipe(
      takeUntil(this.destroyed$),
      tap(() => {
        this.pageVisible = true
        this.windowVisible = !isDocumentHidden(this.doc)
        if (this.cfg.pageshowCountsAsActivity) {
          this.registerActivity('page_visible', { coalesce: true })
        } else {
          this.pushStatus({ reason: 'page_visible' })
        }
      })
    )
    const pagehide$ = fromEvent<PageTransitionEvent>(this.win, 'pagehide').pipe(
      takeUntil(this.destroyed$),
      tap(() => {
        this.pageVisible = false
        if (this.cfg.visibilityCountsAsActivity) {
          this.registerActivity('page_hidden', { coalesce: true })
        } else {
          this.pushStatus({ reason: 'page_hidden' })
        }
      })
    )

    this.subscriptions.add(pageshow$.subscribe())
    this.subscriptions.add(pagehide$.subscribe())
  }

  private installUserInteractionStreams(): void {
    const opts: AddEventListenerOptions = { passive: true, capture: false }
    const onBoth = <E extends Event>(
      type: string,
      options?: AddEventListenerOptions
    ) =>
      merge(
        fromEvent<E>(this.win, type, options ?? opts),
        fromEvent<E>(this.doc, type, options ?? opts)
      )

    // Pointer + Mouse + Wheel
    const pointer$ = merge(
      onBoth<PointerEvent>('pointerdown'),
      onBoth<PointerEvent>('pointerup'),
      onBoth<PointerEvent>('pointermove').pipe(
        rxThrottleTime(this.cfg.throttleTime, undefined, {
          leading: true,
          trailing: true
        })
      )
    ).pipe(
      map(() => ({ type: 'mouse' as const, timestamp: now(), throttled: true }))
    )

    const mouseButtons$ = merge(
      onBoth<MouseEvent>('mousedown'),
      onBoth<MouseEvent>('mouseup')
    ).pipe(map(() => ({ type: 'mouse' as const, timestamp: now() })))

    const mouseMove$ = onBoth<MouseEvent>('mousemove').pipe(
      rxThrottleTime(this.cfg.throttleTime, undefined, {
        leading: true,
        trailing: true
      }),
      map(() => ({ type: 'mouse' as const, timestamp: now(), throttled: true }))
    )

    const wheel$ = onBoth<WheelEvent>('wheel').pipe(
      rxThrottleTime(this.cfg.throttleTime, undefined, {
        leading: true,
        trailing: true
      }),
      map(() => ({ type: 'mouse' as const, timestamp: now(), throttled: true }))
    )

    const keyboard$ = onBoth<KeyboardEvent>('keydown').pipe(
      map(() => ({ type: 'keyboard' as const, timestamp: now() }))
    )

    const touch$ = onBoth<TouchEvent>('touchstart').pipe(
      map(() => ({ type: 'touch' as const, timestamp: now() }))
    )

    const scroll$ = merge(
      fromEvent<Event>(this.win, 'scroll', { passive: true, capture: true }),
      fromEvent<Event>(this.doc, 'scroll', { passive: true, capture: true })
    ).pipe(
      rxThrottleTime(this.cfg.throttleTime, undefined, {
        leading: true,
        trailing: true
      }),
      rxDebounceTime(this.cfg.debounceTime),
      map(() => ({
        type: 'scroll' as const,
        timestamp: now(),
        throttled: true
      }))
    )

    const user$: Observable<UserInteractionEvent> = merge(
      pointer$,
      mouseButtons$,
      mouseMove$,
      wheel$,
      keyboard$,
      touch$,
      scroll$
    )

    this.subscriptions.add(
      user$
        .pipe(
          takeUntil(this.destroyed$),
          tap((evt) => this.onUserInteraction(evt))
        )
        .subscribe()
    )
  }

  private installNetworkStreams(): void {
    const online$ = fromEvent(this.win, 'online').pipe(map(() => true))
    const offline$ = fromEvent(this.win, 'offline').pipe(map(() => false))

    const net$ = merge(online$, offline$).pipe(
      distinctUntilChanged(),
      takeUntil(this.destroyed$),
      tap((online) => {
        const prev = this.networkOnline
        this.networkOnline = online
        if (prev !== online) {
          this.pushStatus({
            reason: online ? 'network_online' : 'network_offline'
          })
        }
      })
    )

    this.subscriptions.add(net$.subscribe())
  }

  private async installIdleDetection(): Promise<void> {
    try {
      if (!this.win.IdleDetector) {
        if (this.cfg.debug) this.log('IdleDetector not supported.')
        return
      }
      const hasPermAPI =
        typeof (navigator as any).permissions?.query === 'function'
      if (hasPermAPI) {
        // @ts-ignore
        const perm: PermissionStatus = await (
          navigator as any
        ).permissions.query({ name: 'idle-detection' as any })
        if (perm && perm.state !== 'granted') {
          if (this.cfg.debug)
            this.log(`IdleDetector permission state: ${perm.state}`)
          return
        }
      }

      this.idleAbortController = new AbortController()
      this.idleDetector = new this.win.IdleDetector()

      this.idleDetector.addEventListener(
        'change',
        () => {
          const userState = this.idleDetector.userState as 'active' | 'idle'
          const screenState = this.idleDetector.screenState as
            | 'locked'
            | 'unlocked'

          const prevSystemIdle = this.systemIdle
          const prevScreenLocked = this.screenLocked

          this.systemIdle = userState === 'idle'
          this.screenLocked = screenState === 'locked'

          if (prevScreenLocked !== this.screenLocked) {
            this.pushStatus({
              reason: this.screenLocked ? 'screen_lock' : 'screen_unlock'
            })
          } else if (prevSystemIdle !== this.systemIdle) {
            this.pushStatus({
              reason: this.systemIdle ? 'system_idle' : 'system_active'
            })
          }
        },
        { signal: this.idleAbortController.signal }
      )

      await this.idleDetector.start({
        threshold: this.cfg.systemIdleThreshold,
        signal: this.idleAbortController.signal
      })

      this.idleDetectorActive = true
      this.pushStatus({ reason: 'initialization' })

      if (this.cfg.debug) this.log('IdleDetector started.')
    } catch (err) {
      if (this.cfg.debug) this.log('IdleDetector error:', err)
    }
  }

  private installPeriodicSystemHeuristics(): void {
    const intervalMs = Math.max(5000, this.cfg.screenLockCheckInterval)
    const tick$ = interval(intervalMs).pipe(
      takeUntil(this.destroyed$),
      tap(() => {
        if (this.cfg.enableElectronListener) {
          const connected =
            this.lastElectronHeartbeat > 0 &&
            now() - this.lastElectronHeartbeat <=
              this.cfg.electronHeartbeatInterval * 3
          if (connected !== this.electronConnected) {
            this.electronConnected = connected
            this.pushStatus({ reason: 'initialization' }) // meta
          }
        }
      })
    )
    this.subscriptions.add(tick$.subscribe())
  }

  private installElectronListeners(): void {
    try {
      this.bc = this.cfg.broadcastChannelFactory(this.cfg.electronIpcChannel)
      this.bc.onmessage = (ev: MessageEvent) => {
        const data = ev?.data
        if (
          data &&
          typeof data === 'object' &&
          'type' in data &&
          'timestamp' in data
        ) {
          this.handleElectronEvent(data as ElectronEvent)
        }
      }
      if (this.cfg.debug)
        this.log(
          'BroadcastChannel listener ready:',
          this.cfg.electronIpcChannel
        )
    } catch (err) {
      if (this.cfg.debug)
        this.log('BroadcastChannel not available or failed:', err)
      this.bc = null
    }

    const postMsg$ = fromEvent<MessageEvent>(this.win, 'message').pipe(
      takeUntil(this.destroyed$),
      filter((ev) => {
        try {
          const d = ev.data
          return !!(
            d &&
            typeof d === 'object' &&
            d.channel === this.cfg.electronIpcChannel &&
            d.payload &&
            typeof d.payload.type === 'string'
          )
        } catch {
          return false
        }
      }),
      map((ev) => ev.data.payload as ElectronEvent),
      tap((evt) => this.handleElectronEvent(evt))
    )
    this.subscriptions.add(postMsg$.subscribe())

    const hb$ = interval(this.cfg.electronHeartbeatInterval).pipe(
      takeUntil(this.destroyed$),
      tap(() => {
        const connected =
          this.lastElectronHeartbeat > 0 &&
          now() - this.lastElectronHeartbeat <=
            this.cfg.electronHeartbeatInterval * 2
        if (connected !== this.electronConnected) {
          this.electronConnected = connected
          this.pushStatus({ reason: 'initialization' })
        }
      })
    )
    this.subscriptions.add(hb$.subscribe())
  }

  // ------- Event handlers

  private onUserInteraction(evt: UserInteractionEvent): void {
    // Kullanıcı girdileri coalesce edilmez (anlık geribildirim istenir)
    let reason: ActivityReason = 'user_interaction'
    switch (evt.type) {
      case 'mouse':
        this.hasMouseActivity = true
        reason = 'mouse_activity'
        break
      case 'keyboard':
        this.hasKeyboardActivity = true
        reason = 'keyboard_activity'
        break
      case 'touch':
        this.hasTouchActivity = true
        reason = 'touch_activity'
        break
      case 'scroll':
        this.hasScrollActivity = true
        reason = 'scroll_activity'
        break
    }
    this.registerActivity(reason, {
      coalesce: false,
      forceTimestamp: evt.timestamp
    })
  }

  private handleElectronEvent(event: ElectronEvent): void {
    this.lastElectronHeartbeat = now()
    if (!this.electronConnected) this.electronConnected = true

    let reason: ActivityReason | null = null
    switch (event.type) {
      case 'focus':
        this.electronAppFocused = true
        reason = 'electron_focus'
        break
      case 'blur':
        this.electronAppFocused = false
        reason = 'electron_blur'
        break
      case 'minimize':
        this.electronWindowMinimized = true
        reason = 'electron_minimize'
        break
      case 'restore':
        this.electronWindowMinimized = false
        reason = 'electron_restore'
        break
      case 'system-idle':
        this.electronSystemIdle = true
        this.systemIdle = true
        reason = 'electron_system_idle'
        break
      case 'system-active':
        this.electronSystemIdle = false
        this.systemIdle = false
        reason = 'electron_system_active'
        break
      case 'heartbeat':
        break // yalnız bağlantı teyidi
    }
    this.pushStatus({ reason: reason ?? 'initialization' })
  }

  // ------- Inactivity ve yayın

  private scheduleInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer)
      this.inactivityTimer = null
    }

    const remaining =
      this.cfg.inactivityTimeout - (now() - this.lastActivityTime)
    const due = Math.max(0, remaining)

    this.inactivityTimer = setTimeout(() => {
      const elapsed = now() - this.lastActivityTime
      if (elapsed >= this.cfg.inactivityTimeout) {
        // Sadece daha önce aktif faz yaşandıysa inactivity_timeout yayınla
        if (this.hadActivePhase) {
          this.pushStatus({ reason: 'inactivity_timeout' })
        }
        // hadActivePhase=false ise startup gürültüsü olarak kabul edip yayınlamıyoruz.
      } else {
        this.scheduleInactivityTimer()
      }
    }, due)
  }

  private pushStatus(patch: { reason: ActivityReason }): void {
    const prev = this.statusSubject.getValue()

    const inactiveTimeMs = Math.max(0, now() - this.lastActivityTime)
    const hardBlocked = this.screenLocked || this.systemIdle

    // isActive: yalnızca inactivity timeout/idle/lock ile düşer.
    const computedIsActive =
      !hardBlocked && inactiveTimeMs < this.cfg.inactivityTimeout

    // hadActivePhase: aktif bir dönem yaşandıysa true (startup'ta startActive true ise da true)
    if (computedIsActive) this.hadActivePhase = true

    const detectionMethods: string[] = [
      this.cfg.trackUserInteractions ? 'user-events' : '',
      this.cfg.trackWindowStates ? 'window' : '',
      this.cfg.enableScreenLockDetection && this.idleDetectorActive
        ? 'idle-detector'
        : '',
      this.cfg.trackNetworkStates ? 'network' : '',
      this.cfg.enableElectronListener ? 'electron-listener' : ''
    ].filter(Boolean)

    const next: ActivityStatus = {
      isActive: computedIsActive,
      lastActivityTime: this.lastActivityTime,
      inactiveTimeMs,

      windowVisible: this.windowVisible,
      windowFocused: this.windowFocused,
      pageVisible: this.pageVisible,

      hasMouseActivity: this.hasMouseActivity,
      hasKeyboardActivity: this.hasKeyboardActivity,
      hasTouchActivity: this.hasTouchActivity,
      hasScrollActivity: this.hasScrollActivity,

      screenLocked: this.screenLocked,
      systemIdle: this.systemIdle,
      networkOnline: this.networkOnline,

      electronConnected: this.electronConnected,
      electronAppFocused: this.electronAppFocused,
      electronWindowMinimized: this.electronWindowMinimized,
      electronSystemIdle: this.electronSystemIdle,

      platform: 'web',
      detectionMethods,
      reason: patch.reason,
      timestamp: now()
    }

    // Yalnız anlamlı değişikliklerde veya kritik nedenlerde yayınla.
    const alwaysReasons = new Set<ActivityReason>([
      'mouse_activity',
      'keyboard_activity',
      'touch_activity',
      'scroll_activity',
      'screen_lock',
      'screen_unlock',
      'system_idle',
      'system_active',
      'electron_system_idle',
      'electron_system_active'
    ])

    const shouldEmitInactivityTimeout =
      patch.reason === 'inactivity_timeout' && this.hadActivePhase // startup'ta bastır

    const meaningfulChange =
      prev.isActive !== next.isActive ||
      prev.windowFocused !== next.windowFocused ||
      prev.pageVisible !== next.pageVisible ||
      prev.windowVisible !== next.windowVisible ||
      prev.screenLocked !== next.screenLocked ||
      prev.systemIdle !== next.systemIdle ||
      prev.networkOnline !== next.networkOnline ||
      prev.electronConnected !== next.electronConnected ||
      prev.electronAppFocused !== next.electronAppFocused ||
      prev.electronWindowMinimized !== next.electronWindowMinimized ||
      prev.electronSystemIdle !== next.electronSystemIdle ||
      prev.detectionMethods.join('|') !== next.detectionMethods.join('|') ||
      alwaysReasons.has(patch.reason) ||
      shouldEmitInactivityTimeout

    if (meaningfulChange) {
      if (this.cfg.detailedLogging) this.log('[status]', next)
      this.statusSubject.next(next)
    }
  }

  // ------- Yardımcılar

  /**
   * Window/page olayları için coalesce: aynı pencere içinde tek yayın.
   * Kullanıcı girdileri için coalesce=false (anlık yayın).
   */
  private registerActivity(
    reason: ActivityReason,
    options?: { coalesce?: boolean; forceTimestamp?: number }
  ) {
    // Zaman damgasını güncelle ve idle zamanlayıcıyı tazele
    this.lastActivityTime = options?.forceTimestamp ?? now()
    this.scheduleInactivityTimer()

    // Kullanıcı girdileri: anlık yayın
    if (options?.coalesce === false) {
      this.pushStatus({ reason })
      return
    }

    // Window/page geçişleri: tek yayına indir
    if (this.coalesceEmitTimer) {
      // Aynı pencere içindeyiz; sadece pending reason'ı güncelle
      this.coalesceReasonPending = reason
      return
    }

    this.coalesceReasonPending = reason
    this.coalesceEmitTimer = setTimeout(() => {
      const r = this.coalesceReasonPending ?? reason
      this.coalesceEmitTimer = null
      this.coalesceReasonPending = null
      this.pushStatus({ reason: r })
    }, this.cfg.activityCoalesceWindowMs)
  }

  private safeHasFocus(): boolean {
    try {
      if (typeof this.doc.hasFocus === 'function') return this.doc.hasFocus()
    } catch {
      // hasFocus çağrılırken hata oluşursa (ör. iframe'de erişim hatası)
      if (this.cfg.debug) this.log('safeHasFocus error:', 'hasFocus failed')
    }
    return getVisibilityState(this.doc) === 'visible'
  }

  private log(...args: any[]) {
    console.log('[ActivityObserver]' + args[0].reason, ...args)
  }
}

/*

// 1) En kolay kullanım: Native BroadcastChannel (modern tarayıcılar)
const observerNative = new ActivityObserver({
  enableElectronListener: true,
  electronIpcChannel: 'electron-activity-ipc',
  broadcastChannelFactory: createNativeBroadcastChannelFactory(),
});

// 2) Polyfill: 'broadcast-channel' (npm) kütüphanesi
// npm i broadcast-channel
const observerPolyfill = new ActivityObserver({
  enableElectronListener: true,
  electronIpcChannel: 'electron-activity-ipc',
  broadcastChannelFactory: createBroadcastChannelLibFactory(),
});

// 3) Shim: localStorage 'storage' event'i ile basit çapraz-sekme köprüsü
const observerStorageShim = new ActivityObserver({
  enableElectronListener: true,
  electronIpcChannel: 'electron-activity-ipc',
  broadcastChannelFactory: createLocalStorageShimFactory(),
});

// 4) Köprü: window.postMessage ile (ör. preload/iframe köprüsü)
const observerPostMessageBridge = new ActivityObserver({
  enableElectronListener: true,
  electronIpcChannel: 'electron-activity-ipc',
  broadcastChannelFactory: createPostMessageBridgeFactory(),
});

// 5) Test/no-op: Kanalı devre dışı bırak (hiç mesaj almaz)
const observerNoop = new ActivityObserver({
  enableElectronListener: true,
  electronIpcChannel: 'electron-activity-ipc',
  broadcastChannelFactory: createNoopBroadcastChannelFactory(),
});

// Electron (renderer) tarafında web sayfasına durum yayınlama örnekleri

// A) Native BroadcastChannel varsa:
const channelName = 'electron-activity-ipc';
const canUseNative = 'BroadcastChannel' in window;

if (canUseNative) {
  const bc = new BroadcastChannel(channelName);

  // Heartbeat
  setInterval(() => {
    bc.postMessage({ type: 'heartbeat', timestamp: Date.now() });
  }, 5000);

  // Sistem durumları (örnek): Main process powerMonitor bilgisini ipcRenderer ile renderer’a aktarın,
// sonra bc.postMessage ile yayınlayın.
  // ipcRenderer.on('system-idle', () => bc.postMessage({ type: 'system-idle', timestamp: Date.now() }));
  // ipcRenderer.on('system-active', () => bc.postMessage({ type: 'system-active', timestamp: Date.now() }));

  // Pencere odak/blur (renderer window olayları)
  window.addEventListener('focus', () => bc.postMessage({ type: 'focus', timestamp: Date.now() }));
  window.addEventListener('blur', () => bc.postMessage({ type: 'blur', timestamp: Date.now() }));
} else {
  // B) BroadcastChannel yoksa, window.postMessage köprüsü:
  const post = (payload: any) => window.postMessage({ channel: channelName, payload }, '*');

  setInterval(() => post({ type: 'heartbeat', timestamp: Date.now() }), 5000);
  window.addEventListener('focus', () => post({ type: 'focus', timestamp: Date.now() }));
  window.addEventListener('blur', () => post({ type: 'blur', timestamp: Date.now() }));
}
 */
