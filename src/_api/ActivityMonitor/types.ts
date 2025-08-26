import { ILogObj } from 'tslog'

export enum LogLevel {
  TRACE = 10,
  DEBUG = 20,
  INFO = 30,
  WARN = 40,
  ERROR = 50,
  SILENT = 99
}

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
  | 'electron_heartbeat'
  | 'initialization'
  | 'leadership_gain'
  | 'leadership_loss'

export interface BaseActivityStatus {
  isActive: boolean
  lastActivityTime: number
  inactiveTimeMs: number

  windowVisible: boolean
  windowFocused: boolean
  pageVisible: boolean

  hasMouseActivity: boolean
  hasKeyboardActivity: boolean
  hasTouchActivity: boolean
  hasScrollActivity: boolean

  screenLocked: boolean
  systemIdle: boolean
  networkOnline: boolean

  platform: 'web' | 'electron'
  detectionMethods: string[]
  reason: ActivityReason
  reasonHistory: ActivityReason[]
  timestamp: number

  isLeaderTab: boolean
  tabId: string
  leaderTabId: string | null

  metrics: ActivityMetrics
}

export interface ActivityStatusElectron extends BaseActivityStatus {
  platform: 'electron'
  electronConnected: boolean
  electronAppFocused: boolean
  electronWindowMinimized: boolean
  electronSystemIdle: boolean
}

export interface ActivityStatusWeb extends BaseActivityStatus {
  platform: 'web'
  electronConnected: false
}

export type ActivityStatus = ActivityStatusWeb | ActivityStatusElectron

export interface ActivityMetrics {
  emissionCount: number
  userInteractionCount: number
  mouseEventCount: number
  keyboardEventCount: number
  touchEventCount: number
  scrollEventCount: number
  focusEventCount: number
  blurEventCount: number
  visibilityEventCount: number
  electronEventCount: number
  leadershipChangeCount: number
  inactivityTimeoutCount: number
  screenLockHeuristicCount: number
  systemIdleHeuristicCount: number
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

export interface ElectronIpcAdapter {
  on(
    channel: string,
    listener: (event: unknown, data: ElectronEvent) => void
  ): void

  removeListener(
    channel: string,
    listener: (event: unknown, data: ElectronEvent) => void
  ): void
}

export type InternalBroadcastMessage =
  | { kind: 'heartbeat'; tabId: string; ts: number; lastActivity: number }
  | { kind: 'claim'; tabId: string; ts: number; lastActivity: number }
  | { kind: 'leader-change'; tabId: string; newLeader: string; ts: number }
  | { kind: 'release'; tabId: string; ts: number }

export interface ActivityMonitorConfig {
  inactivityTimeout?: number
  systemIdleThreshold?: number
  screenLockCheckInterval?: number
  throttleTime?: number

  trackWindowStates?: boolean
  trackUserInteractions?: boolean
  trackSystemStates?: boolean
  trackNetworkStates?: boolean
  enableScreenLockDetection?: boolean
  enableElectronListener?: boolean

  electronIpcChannel?: string
  electronHeartbeatInterval?: number

  logLevel?: LogLevel
  statusLogAt?: 'trace' | 'debug'

  mouseContinuousQuietMs?: number
  scrollContinuousQuietMs?: number
  clickCooldownMs?: number
  enableLeadership?: boolean
  leadershipStrategy?: 'optimistic' | 'strict'
  leadershipHeartbeatInterval?: number
  leadershipStaleThreshold?: number
  screenLockHeuristicIdleMultiplier?: number
  reasonHistoryLimit?: number

  countWhileHidden?: boolean
  countWhileBlurred?: boolean
  minEmitIntervalMs?: number
  forceWindowVisibleTrue?: boolean
  allowInactiveWhileBackground?: boolean

  traceUseConsoleLog?: boolean // deprecated legacy flags (ignored by tslog)
  forceTraceVisible?: boolean

  debug?: boolean // deprecated
  detailedLogging?: boolean // deprecated
}

/**
 * Structured log object for tslog
 */
export interface ActivityMonitorLogObj extends ILogObj {
  reason?: string
  inactiveMs?: number
  leader?: boolean
  isActive?: boolean
}
