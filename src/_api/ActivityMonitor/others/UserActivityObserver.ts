/**
 * Performance-Optimized User Activity Observer
 *
 * Highly optimized TypeScript class for detecting user activity in complex applications.
 * Designed for minimal memory footprint, CPU usage, and maximum performance.
 *
 * Key Optimizations:
 * - Lazy initialization and cleanup
 * - Efficient event throttling and debouncing
 * - Memory leak prevention
 * - Minimal DOM interactions
 * - Smart caching and state management
 * - Reduced observable chains
 */

import { BehaviorSubject, Observable, Subscription } from 'rxjs'
import { distinctUntilChanged, share } from 'rxjs/operators'

/**
 * Lightweight activity status interface
 */
interface ActivityStatus {
  isActive: boolean
  lastActivityTime: number
  reason: ActivityReason
  timestamp: number

  // Optional detailed info (only when needed)
  windowFocused?: boolean
  windowVisible?: boolean
  screenLocked?: boolean
  electronConnected?: boolean
  inactiveTimeMs?: number
}

/**
 * Simplified activity reasons
 */
type ActivityReason =
  | 'user_interaction'
  | 'window_focus'
  | 'window_blur'
  | 'window_visible'
  | 'window_hidden'
  | 'screen_lock'
  | 'screen_unlock'
  | 'inactivity_timeout'
  | 'electron_focus'
  | 'electron_blur'
  | 'system_active'
  | 'initialization'

/**
 * Optimized configuration interface
 */
interface OptimizedConfig {
  // Core timing
  inactivityTimeout?: number
  throttleTime?: number

  // Feature flags (disable unused features for performance)
  trackWindowStates?: boolean
  trackUserInteractions?: boolean
  enableScreenLockDetection?: boolean
  enableElectronListener?: boolean

  // Performance settings
  usePassiveListeners?: boolean
  enableDetailedStatus?: boolean
  maxEventBuffer?: number
  cleanupInterval?: number

  // Electron
  electronIpcChannel?: string

  // Debug (disable in production)
  debug?: boolean
}

/**
 * Event buffer for performance optimization
 */
interface EventBuffer {
  type: string
  timestamp: number
  count: number
}

/**
 * Performance-optimized User Activity Observer
 */
class OptimizedUserActivityObserver {
  // Core configuration
  private readonly config: Required<OptimizedConfig>

  // State management
  private activitySubject: BehaviorSubject<ActivityStatus>
  private isObserving: boolean = false
  private isDestroyed: boolean = false

  // Performance-critical state
  private lastActivityTime: number = Date.now()
  private lastStatusUpdate: number = 0
  private windowFocused: boolean = true
  private windowVisible: boolean = true
  private screenLocked: boolean = false

  // Electron state (minimal)
  private electronConnected: boolean = false
  private electronAppFocused: boolean = true
  private ipcRenderer: any = null

  // Event management
  private eventListeners: Map<string, EventListener> = new Map()
  private subscriptions: Subscription[] = []
  private eventBuffer: EventBuffer[] = []

  // Timers
  private inactivityTimer: number | null = null
  private cleanupTimer: number | null = null
  private electronHeartbeat: number | null = null

  // Performance monitoring
  private performanceMetrics = {
    eventCount: 0,
    lastCleanup: Date.now(),
    memoryUsage: 0
  }

  constructor(config: OptimizedConfig = {}) {
    this.config = {
      // Core settings
      inactivityTimeout: config.inactivityTimeout ?? 30000,
      throttleTime: config.throttleTime ?? 200, // Increased for performance

      // Features
      trackWindowStates: config.trackWindowStates ?? true,
      trackUserInteractions: config.trackUserInteractions ?? true,
      enableScreenLockDetection: config.enableScreenLockDetection ?? false, // Disabled by default
      enableElectronListener: config.enableElectronListener ?? false, // Auto-detect later

      // Performance
      usePassiveListeners: config.usePassiveListeners ?? true,
      enableDetailedStatus: config.enableDetailedStatus ?? false,
      maxEventBuffer: config.maxEventBuffer ?? 100,
      cleanupInterval: config.cleanupInterval ?? 60000, // 1 minute

      // Electron
      electronIpcChannel: config.electronIpcChannel ?? 'user-activity',

      // Debug
      debug: config.debug ?? false
    }

    // Initialize core state
    this.initializeCore()

    // Create activity subject with initial status
    const initialStatus = this.createLightweightStatus('initialization', true)
    this.activitySubject = new BehaviorSubject<ActivityStatus>(initialStatus)

    // Setup cleanup timer
    this.startCleanupTimer()

    this.log('OptimizedUserActivityObserver initialized with minimal footprint')
  }

  /**
   * Start observing with optimized event handling
   */
  public startObserving(): void {
    if (this.isObserving || this.isDestroyed) return

    this.isObserving = true
    this.lastActivityTime = Date.now()

    // Setup event listeners efficiently
    this.setupOptimizedEventListeners()

    // Start inactivity timer
    this.startInactivityTimer()

    this.log('Started observing with optimized event handling')

    // Emit initial active status
    this.updateStatus('system_active', true)
  }

  /**
   * Stop observing
   */
  public stopObserving(): void {
    if (!this.isObserving) return

    this.isObserving = false
    this.clearAllEventListeners()
    this.clearInactivityTimer()

    this.log('Stopped observing, resources cleaned up')
  }

  /**
   * Get activity status observable (optimized)
   */
  public getActivityStatus$(): Observable<ActivityStatus> {
    return this.activitySubject.asObservable().pipe(
      distinctUntilChanged(
        (prev, curr) =>
          prev.isActive === curr.isActive && prev.reason === curr.reason
      ),
      share() // Share subscription for multiple subscribers
    )
  }

  /**
   * Get current status
   */
  public getCurrentStatus(): ActivityStatus {
    return this.activitySubject.value
  }

  /**
   * Get performance metrics
   */
  public getPerformanceMetrics() {
    return {
      ...this.performanceMetrics,
      isObserving: this.isObserving,
      eventListenersCount: this.eventListeners.size,
      subscriptionsCount: this.subscriptions.length,
      electronConnected: this.electronConnected
    }
  }

  /**
   * Update configuration efficiently
   */
  public updateConfig(newConfig: Partial<OptimizedConfig>): void {
    const wasObserving = this.isObserving

    if (wasObserving) {
      this.stopObserving()
    }

    Object.assign(this.config, newConfig)

    if (wasObserving) {
      this.startObserving()
    }

    this.log('Configuration updated efficiently')
  }

  /**
   * Manual activity trigger (for testing or external events)
   */
  public triggerActivity(reason: ActivityReason = 'user_interaction'): void {
    this.handleActivity(reason)
  }

  /**
   * Check if currently observing
   */
  public isCurrentlyObserving(): boolean {
    return this.isObserving && !this.isDestroyed
  }

  /**
   * Destroy and cleanup all resources
   */
  public destroy(): void {
    if (this.isDestroyed) return

    this.log('Destroying observer...')

    this.isDestroyed = true
    this.stopObserving()

    // Clear all timers
    this.clearInactivityTimer()
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    if (this.electronHeartbeat) {
      clearInterval(this.electronHeartbeat)
      this.electronHeartbeat = null
    }

    // Clean up Electron listeners
    if (this.ipcRenderer) {
      const channel = this.config.electronIpcChannel
      this.ipcRenderer.removeAllListeners(`${channel}-app-focus`)
      this.ipcRenderer.removeAllListeners(`${channel}-app-blur`)
    }

    // Complete observables
    this.activitySubject.complete()

    // Clear references
    this.eventListeners.clear()
    this.eventBuffer = []
    this.subscriptions = []
    this.ipcRenderer = null

    this.log('Observer destroyed and all resources cleaned up')
  }

  /**
   * Initialize core components only
   */
  private initializeCore(): void {
    // Basic window state
    if (typeof document !== 'undefined') {
      this.windowVisible = !document.hidden
      this.windowFocused = document.hasFocus()
    }

    // Auto-detect Electron
    if (this.config.enableElectronListener || this.detectElectron()) {
      this.config.enableElectronListener = true
      this.initializeElectronMinimal()
    }
  }

  /**
   * Minimal Electron detection and setup
   */
  private detectElectron(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!(window as any).process?.versions?.electron
    )
  }

  /**
   * Minimal Electron initialization
   */
  private initializeElectronMinimal(): void {
    try {
      this.ipcRenderer = (window as any).electronAPI?.ipcRenderer
      if (this.ipcRenderer) {
        this.electronConnected = true
        this.setupElectronListenersMinimal()
        this.log('Minimal Electron IPC initialized')
      }
    } catch (error) {
      this.log('Electron initialization failed, continuing in web mode')
    }
  }

  /**
   * Setup minimal Electron listeners
   */
  private setupElectronListenersMinimal(): void {
    if (!this.ipcRenderer) return

    const channel = this.config.electronIpcChannel

    // Only essential events
    this.ipcRenderer.on(`${channel}-app-focus`, () => {
      this.electronAppFocused = true
      this.handleActivity('electron_focus')
    })

    this.ipcRenderer.on(`${channel}-app-blur`, () => {
      this.electronAppFocused = false
      this.updateStatus('electron_blur', false)
    })

    // Start minimal heartbeat
    this.startElectronHeartbeat()
  }

  /**
   * Minimal heartbeat for Electron
   */
  private startElectronHeartbeat(): void {
    if (!this.ipcRenderer) return

    this.electronHeartbeat = window.setInterval(() => {
      if (this.isDestroyed) return

      try {
        this.ipcRenderer.send(`${this.config.electronIpcChannel}-ping`)
      } catch {
        this.electronConnected = false
      }
    }, 30000)
  }

  /**
   * Setup optimized event listeners
   */
  private setupOptimizedEventListeners(): void {
    if (typeof document === 'undefined') return

    // Combine multiple events into single handlers for performance
    if (this.config.trackUserInteractions) {
      this.setupUserInteractionHandler()
    }

    if (this.config.trackWindowStates) {
      this.setupWindowStateHandlers()
    }

    if (this.config.enableScreenLockDetection) {
      this.setupScreenLockDetection()
    }
  }

  /**
   * Optimized user interaction handler
   */
  private setupUserInteractionHandler(): void {
    // Single throttled handler for all interaction events
    let lastEventTime = 0

    const throttledHandler = () => {
      const now = Date.now()
      if (now - lastEventTime < this.config.throttleTime) return

      lastEventTime = now
      this.handleActivity('user_interaction')
    }

    // Add single listener for multiple events (more efficient)
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']

    events.forEach((eventType) => {
      const listener = throttledHandler
      this.eventListeners.set(eventType, listener)
      document.addEventListener(eventType, listener, {
        passive: this.config.usePassiveListeners,
        capture: false
      })
    })

    this.log(`Setup ${events.length} interaction listeners with throttling`)
  }

  /**
   * Optimized window state handlers
   */
  private setupWindowStateHandlers(): void {
    // Window focus/blur
    const focusHandler = () => {
      this.windowFocused = true
      this.handleActivity('window_focus')
    }

    const blurHandler = () => {
      this.windowFocused = false
      this.updateStatus('window_blur', false)
    }

    // Visibility change
    const visibilityHandler = () => {
      const wasVisible = this.windowVisible
      this.windowVisible = !document.hidden

      if (this.windowVisible !== wasVisible) {
        if (this.windowVisible) {
          this.handleActivity('window_visible')
        } else {
          this.updateStatus('window_hidden', false)
        }
      }
    }

    this.eventListeners.set('focus', focusHandler)
    this.eventListeners.set('blur', blurHandler)
    this.eventListeners.set('visibilitychange', visibilityHandler)

    window.addEventListener('focus', focusHandler, { passive: true })
    window.addEventListener('blur', blurHandler, { passive: true })
    document.addEventListener('visibilitychange', visibilityHandler, {
      passive: true
    })
  }

  /**
   * Lightweight screen lock detection
   */
  private setupScreenLockDetection(): void {
    let lastVisibilityChange = Date.now()

    const advancedVisibilityHandler = () => {
      const now = Date.now()
      const timeDiff = now - lastVisibilityChange
      lastVisibilityChange = now

      // Simple heuristic: if page was hidden for > 30 seconds, might be screen lock
      if (document.hidden && timeDiff > 30000) {
        this.screenLocked = true
        this.updateStatus('screen_lock', false)
      } else if (!document.hidden && this.screenLocked) {
        this.screenLocked = false
        this.handleActivity('screen_unlock')
      }
    }

    document.addEventListener('visibilitychange', advancedVisibilityHandler, {
      passive: true
    })
    this.eventListeners.set('visibilitychange-lock', advancedVisibilityHandler)
  }

  /**
   * Handle user activity efficiently
   */
  private handleActivity(reason: ActivityReason): void {
    if (this.isDestroyed) return

    const now = Date.now()
    this.lastActivityTime = now

    // Restart inactivity timer efficiently
    this.restartInactivityTimer()

    // Update status (with throttling to prevent excessive updates)
    if (now - this.lastStatusUpdate > 100) {
      // Max 10 updates per second
      this.updateStatus(reason, true)
      this.lastStatusUpdate = now
    }

    // Track performance
    this.performanceMetrics.eventCount++
  }

  /**
   * Efficient status update
   */
  private updateStatus(reason: ActivityReason, isActive: boolean): void {
    if (this.isDestroyed) return

    // Calculate actual active status based on current state
    const actuallyActive = this.calculateActiveStatus(isActive)

    // Only update if status actually changed or it's an important event
    const currentStatus = this.activitySubject.value
    if (
      currentStatus.isActive !== actuallyActive ||
      this.isImportantEvent(reason)
    ) {
      const status = this.createLightweightStatus(reason, actuallyActive)
      this.activitySubject.next(status)
    }
  }

  /**
   * Determine if event is important enough to always emit
   */
  private isImportantEvent(reason: ActivityReason): boolean {
    return [
      'screen_lock',
      'screen_unlock',
      'electron_focus',
      'electron_blur'
    ].includes(reason)
  }

  /**
   * Efficient active status calculation
   */
  private calculateActiveStatus(baseActive: boolean): boolean {
    if (this.screenLocked) return false

    if (this.config.trackWindowStates) {
      if (!this.windowVisible || !this.windowFocused) {
        const inactiveTime = Date.now() - this.lastActivityTime
        if (inactiveTime > 30000) return false // 30s grace period
      }
    }

    if (this.electronConnected && !this.electronAppFocused) {
      const inactiveTime = Date.now() - this.lastActivityTime
      if (inactiveTime > 30000) return false
    }

    return baseActive
  }

  /**
   * Create lightweight status object
   */
  private createLightweightStatus(
    reason: ActivityReason,
    isActive: boolean
  ): ActivityStatus {
    const status: ActivityStatus = {
      isActive,
      lastActivityTime: this.lastActivityTime,
      reason,
      timestamp: Date.now()
    }

    // Add optional details only if enabled
    if (this.config.enableDetailedStatus) {
      status.windowFocused = this.windowFocused
      status.windowVisible = this.windowVisible
      status.screenLocked = this.screenLocked
      status.electronConnected = this.electronConnected
      status.inactiveTimeMs = Date.now() - this.lastActivityTime
    }

    return status
  }

  /**
   * Efficient inactivity timer management
   */
  private startInactivityTimer(): void {
    this.clearInactivityTimer()
    this.inactivityTimer = window.setTimeout(() => {
      if (!this.isDestroyed) {
        this.updateStatus('inactivity_timeout', false)
      }
    }, this.config.inactivityTimeout)
  }

  private restartInactivityTimer(): void {
    this.startInactivityTimer()
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer)
      this.inactivityTimer = null
    }
  }

  /**
   * Periodic cleanup for memory management
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = window.setInterval(() => {
      this.performCleanup()
    }, this.config.cleanupInterval)
  }

  /**
   * Perform memory cleanup
   */
  private performCleanup(): void {
    if (this.isDestroyed) return

    // Clear event buffer
    if (this.eventBuffer.length > this.config.maxEventBuffer) {
      this.eventBuffer = this.eventBuffer.slice(-this.config.maxEventBuffer / 2)
    }

    // Update performance metrics
    this.performanceMetrics.memoryUsage =
      (performance as any).memory?.usedJSHeapSize || 0
    this.performanceMetrics.lastCleanup = Date.now()

    this.log('Cleanup performed, memory optimized')
  }

  /**
   * Clear all event listeners efficiently
   */
  private clearAllEventListeners(): void {
    this.eventListeners.forEach((listener, eventType) => {
      if (['focus', 'blur'].includes(eventType)) {
        window.removeEventListener(eventType, listener)
      } else {
        document.removeEventListener(eventType, listener)
      }
    })

    this.eventListeners.clear()

    // Clear subscriptions
    this.subscriptions.forEach((sub) => sub.unsubscribe())
    this.subscriptions = []
  }

  /**
   * Efficient logging
   */
  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[OptimizedActivityObserver]', ...args)
    }
  }
}

// Export optimized version
export { OptimizedUserActivityObserver as UserActivityObserver }
export type {
  OptimizedConfig as ActivityObserverConfig,
  ActivityReason,
  ActivityStatus
}

/**
 * Performance-optimized usage example:
 */
/*
// Minimal configuration for production
const observer = new UserActivityObserver({
  inactivityTimeout: 300000,        // 5 minutes
  throttleTime: 500,               // Increased throttling for performance
  trackUserInteractions: true,
  trackWindowStates: true,
  enableScreenLockDetection: false, // Disable if not needed
  enableElectronListener: false,    // Auto-detected
  usePassiveListeners: true,        // Better performance
  enableDetailedStatus: false,      // Minimal status object
  debug: false                      // Disable in production
});

// Start observing
observer.startObserving();

// Efficient subscription (only for active/inactive changes)
const subscription = observer.getActivityStatus$().pipe(
  map(status => status.isActive),
  distinctUntilChanged(),
  debounceTime(1000) // Debounce for performance
).subscribe(isActive => {
  // Handle activity change efficiently
  if (isActive) {
    // Resume operations
  } else {
    // Pause operations
  }
});

// Monitor performance
console.log('Performance:', observer.getPerformanceMetrics());

// Cleanup
// subscription.unsubscribe();
// observer.destroy();
*/
