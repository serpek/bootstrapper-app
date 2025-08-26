import { ILogObj, ISettingsParam, Logger } from 'tslog'

import { IServiceWrapper } from '@bipweb/core'

export type OverlapPolicy = 'parallel' | 'queue'

export interface WorkerBatchingConfig {
  enabled?: boolean
  flushIntervalMs?: number
  maxBatchSize?: number
}

export interface TaskManagerConfig {
  runHistoryLimit?: number
  manualTriggerRateLimitMs?: number
  defaultTimeoutMs?: number
  percentiles?: number[]
  maxSimulateMissedPerResume?: number
  useStreamingQuantiles?: boolean
  minimizeAllocations?: boolean
  resetKeepsSkippedCounts?: boolean
  workerFactory?: () => Worker
  useWorker?: boolean
  workerBatching?: WorkerBatchingConfig
  loggerOptions?: ISettingsParam<ILogObj>
  logger?: Logger<ILogObj>
  initialActive?: boolean
}

export interface ITaskManager extends IServiceWrapper {
  configure(config: TaskManagerConfig): void
}

export interface TaskConfig {
  cron: string
  timezone?: 'local' | 'UTC'
  name?: string
  overlapPolicy?: OverlapPolicy
  autoStart?: boolean
  allowManualTrigger?: boolean
  pauseOnIdle?: boolean
  timeoutMs?: number
}

export interface TaskRunContext {
  taskId: string
  runId: number
  scheduledTime: Date | null
  actualStartTime: Date
  abortSignal: AbortSignal
  triggerType: 'cron' | 'manual'
  overlapPolicy: OverlapPolicy
  timeoutMs?: number
  isAborted: () => boolean
}

// YENİ: callback tipi
export type TaskCallback = (ctx: TaskRunContext) => void | Promise<void>

export type TaskRunStatus =
  | 'success'
  | 'error'
  | 'skipped'
  | 'running'
  | 'timeout'

export interface RunHistoryEntry {
  runId: number
  status: TaskRunStatus
  triggerType: 'cron' | 'manual'
  scheduledTime: Date | null
  actualStartTime: Date | null
  endTime: Date | null
  durationMs: number | null
  driftMs: number | null
  error?: { name?: string; message?: string; stack?: string }
  skipReason?: string
  overlapPolicyUsed?: OverlapPolicy
  timestamp: Date
}

export interface TaskMetrics {
  taskId: string
  name: string
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  timeoutRuns: number
  skippedRuns: number
  manualRuns: number
  consecutiveFailures: number
  averageDurationMs: number | null
  maxDurationMs: number | null
  minDurationMs: number | null
  p95DurationMs: number | null
  p99DurationMs: number | null
  averageDriftMs: number | null
  maxDriftMs: number | null
  p95DriftMs: number | null
  p99DriftMs: number | null
  totalRunTimeMs: number
  lastRunStartedAt: Date | null
  lastRunFinishedAt: Date | null
  lastErrorMessage: string | null
  lastErrorAt: Date | null
  missedTickCount: number
  uptimeSinceFirstRun: Date | null
  averageIntervalMs: number | null
  dynamicPercentiles: Record<string, number | null>
}

export interface GlobalMetrics {
  totalTasks: number
  activeTasks: number
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  timeoutRuns: number
  skippedRuns: number
  manualRuns: number
  averageDurationMs: number | null
  averageDriftMs: number | null
  lastEventAt: Date | null
}

export type TaskEventType =
  | 'task-added'
  | 'task-removed'
  | 'task-start'
  | 'task-success'
  | 'task-error'
  | 'task-timeout'
  | 'task-skip'
  | 'task-complete'
  | 'task-paused'
  | 'task-resumed'
  | 'task-manual-trigger'
  | 'overlap-queued'
  | 'overlap-parallel'
  | 'activity-state-changed'
  | 'missed-tick-simulated'

export interface TaskEventPayload {
  eventType: TaskEventType
  taskId: string
  taskName: string
  timestamp: Date
  runId?: number
  scheduledTime?: Date | null
  actualStartTime?: Date | null
  durationMs?: number | null
  driftMs?: number | null
  error?: { name?: string; message?: string; stack?: string }
  skipReason?: string
  triggerType?: 'cron' | 'manual'
  overlapPolicy?: OverlapPolicy
  timeoutMs?: number
  activeConcurrentRuns?: number
}

export interface ManualTriggerResult {
  ok: boolean
  reason?: 'rate-limit' | 'disabled'
}

export interface WorkerMessageAdd {
  type: 'add'
  taskId: string
  cron: string
  timezone?: 'local' | 'UTC'
  autoStart?: boolean
}

export interface WorkerMessageControl {
  type: 'start' | 'pause' | 'resume' | 'remove'
  taskId: string
}

export interface WorkerMessageShutdown {
  type: 'shutdown'
}

export type WorkerOutboundMessage =
  | { type: 'tick'; taskId: string; scheduledTime: number }
  | {
      type: 'tick-batch'
      entries: Array<{ taskId: string; scheduledTime: number }>
    }
  | { type: 'log'; level: string; message: string; taskId?: string }
  | { type: 'error'; taskId?: string; error: string }

export type WorkerInboundMessage =
  | WorkerMessageAdd
  | WorkerMessageControl
  | WorkerMessageShutdown
  | { type: 'batch-config'; batching: Required<WorkerBatchingConfig> }
