import { Subject } from 'rxjs'

import { P2QuantileEstimator } from './quantiles'
import {
  ManualTriggerResult,
  OverlapPolicy,
  RunHistoryEntry,
  TaskCallback,
  TaskConfig,
  TaskEventPayload,
  TaskMetrics,
  TaskRunContext
} from './task-types'

/**
 * Ring buffer tabanlı history.
 */
class RunHistoryBuffer {
  private buffer: (RunHistoryEntry | null)[]
  private head = 0
  private count = 0

  constructor(private readonly capacity: number) {
    this.buffer = new Array(capacity).fill(null)
  }

  push(entry: RunHistoryEntry) {
    this.buffer[this.head] = entry
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  update(runId: number, updater: (old: RunHistoryEntry) => RunHistoryEntry) {
    for (let i = 0, idx = this.head; i < this.count; i++) {
      idx = (idx - 1 + this.capacity) % this.capacity
      const e = this.buffer[idx]
      if (e && e.runId === runId) {
        this.buffer[idx] = updater(e)
        return true
      }
    }
    return false
  }

  find(runId: number): RunHistoryEntry | undefined {
    for (let i = 0, idx = this.head; i < this.count; i++) {
      idx = (idx - 1 + this.capacity) % this.capacity
      const e = this.buffer[idx]
      if (e && e.runId === runId) return e
    }
    return undefined
  }

  toArray(): RunHistoryEntry[] {
    const out: RunHistoryEntry[] = []
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - this.count + i + this.capacity) % this.capacity
      const e = this.buffer[idx]
      if (e) out.push(e)
    }
    return out
  }
}

/**
 * Kuyruk (queue overlap) için hafif linked list.
 */
class PendingNode {
  fn: () => void
  next: PendingNode | null = null

  constructor(fn: () => void) {
    this.fn = fn
  }
}

class PendingQueue {
  private head: PendingNode | null = null
  private tail: PendingNode | null = null
  private _size = 0

  get size() {
    return this._size
  }

  enqueue(fn: () => void) {
    const n = new PendingNode(fn)
    if (!this.tail) {
      this.head = this.tail = n
    } else {
      this.tail.next = n
      this.tail = n
    }
    this._size++
  }

  dequeue(): (() => void) | undefined {
    if (!this.head) return
    const fn = this.head.fn
    this.head = this.head.next
    if (!this.head) this.tail = null
    this._size--
    return fn
  }

  clear() {
    this.head = this.tail = null
    this._size = 0
  }
}

interface ActiveRun {
  controller: AbortController
  timeoutHandle?: number
  scheduledTime: Date | null
  triggerType: 'cron' | 'manual'
  runId: number
  overlapPolicy: OverlapPolicy
  startTime: Date
}

/**
 * Task
 */
export class Task {
  readonly id: string
  readonly config: Required<Omit<TaskConfig, 'timeoutMs'>> & {
    timeoutMs?: number
  }

  private readonly callback: TaskCallback // any yerine TaskCallback
  private readonly subject = new Subject<TaskEventPayload>()
  private readonly emitGlobal: (event: TaskEventPayload) => void

  private runIdSeq = 0
  private activeConcurrentRuns = 0
  private queueBusy = false
  private queue = new PendingQueue()
  private activeRunIds = new Set<number>()
  private history: RunHistoryBuffer

  private metrics: TaskMetrics
  private lastFinishedRunStart: Date | null = null
  private removed = false
  private lastActiveRun: ActiveRun | null = null

  private readonly manualTriggerRateLimitMs: number
  private lastManualTriggerAt = 0

  private percentileFractions: number[]
  private percentileKeys: string[]
  private streamingEstimator: P2QuantileEstimator | null = null
  private useStreaming: boolean
  private resetKeepsSkipped: boolean
  private minimizeAllocations: boolean

  // GC azaltmak için tekrar kullanılabilir payload örneği (opsiyonel)
  private reusableEventPayload: TaskEventPayload | null = null

  constructor(
    id: string,
    config: TaskConfig,
    callback: TaskCallback,
    opts: {
      historyLimit: number
      manualTriggerRateLimitMs: number
      globalEmitter: (e: TaskEventPayload) => void
      percentiles?: number[]
      useStreamingQuantiles?: boolean
      resetKeepsSkippedCounts?: boolean
      minimizeAllocations?: boolean
    }
  ) {
    this.id = id
    this.callback = callback
    this.emitGlobal = opts.globalEmitter
    this.manualTriggerRateLimitMs = opts.manualTriggerRateLimitMs
    this.useStreaming = !!opts.useStreamingQuantiles
    this.resetKeepsSkipped = !!opts.resetKeepsSkippedCounts
    this.minimizeAllocations = !!opts.minimizeAllocations

    this.config = Object.freeze({
      cron: config.cron,
      timezone: config.timezone ?? 'local',
      name: config.name ?? id,
      overlapPolicy: config.overlapPolicy ?? 'parallel',
      autoStart: config.autoStart ?? true,
      allowManualTrigger: config.allowManualTrigger ?? true,
      pauseOnIdle: config.pauseOnIdle ?? true,
      timeoutMs: config.timeoutMs
    })

    this.history = new RunHistoryBuffer(opts.historyLimit)

    const rawPercentiles = (opts.percentiles ?? [0.95, 0.99])
      .filter((p) => p > 0 && p < 1)
      .sort((a, b) => a - b)
    this.percentileFractions = rawPercentiles
    this.percentileKeys = rawPercentiles.map((p) => `p${Math.round(p * 100)}`)
    if (this.useStreaming) {
      this.streamingEstimator = new P2QuantileEstimator(rawPercentiles)
    }

    this.metrics = {
      taskId: id,
      name: this.config.name,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      timeoutRuns: 0,
      skippedRuns: 0,
      manualRuns: 0,
      consecutiveFailures: 0,
      averageDurationMs: null,
      maxDurationMs: null,
      minDurationMs: null,
      p95DurationMs: null,
      p99DurationMs: null,
      averageDriftMs: null,
      maxDriftMs: null,
      p95DriftMs: null,
      p99DriftMs: null,
      totalRunTimeMs: 0,
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      missedTickCount: 0,
      uptimeSinceFirstRun: null,
      averageIntervalMs: null,
      dynamicPercentiles: this.percentileKeys.reduce<
        Record<string, number | null>
      >((acc, k) => {
        acc[k] = null
        return acc
      }, {})
    }
  }

  // Public API
  getEvents$() {
    return this.subject.asObservable()
  }

  getRunHistory(): RunHistoryEntry[] {
    return this.history.toArray()
  }

  getMetrics(opts?: { reset?: boolean }): TaskMetrics {
    const copy: TaskMetrics = {
      ...this.metrics,
      dynamicPercentiles: { ...this.metrics.dynamicPercentiles }
    }
    if (opts?.reset) this.resetMetrics()
    return copy
  }

  manualTrigger(): ManualTriggerResult {
    if (!this.config.allowManualTrigger)
      return { ok: false, reason: 'disabled' }
    const now = Date.now()
    if (now - this.lastManualTriggerAt < this.manualTriggerRateLimitMs) {
      this.recordSkip('manual', 'rate-limit')
      return { ok: false, reason: 'rate-limit' }
    }
    this.lastManualTriggerAt = now
    this.enqueueRun('manual', null)
    this.emitEvent({
      eventType: 'task-manual-trigger',
      taskId: this.id,
      taskName: this.metrics.name,
      timestamp: new Date(),
      activeConcurrentRuns: this.activeConcurrentRuns
    })
    return { ok: true }
  }

  handleScheduledTick(scheduledEpochMs: number) {
    if (this.removed) return
    this.enqueueRun('cron', new Date(scheduledEpochMs))
  }

  simulateMissedTick(scheduled: Date) {
    this.metrics.missedTickCount++
    const runId = ++this.runIdSeq
    this.history.push({
      runId,
      status: 'skipped',
      triggerType: 'cron',
      scheduledTime: scheduled,
      actualStartTime: null,
      endTime: null,
      durationMs: null,
      driftMs: null,
      timestamp: new Date(),
      skipReason: 'idle',
      overlapPolicyUsed: this.config.overlapPolicy
    })
    this.metrics.skippedRuns++
    this.emitEvent({
      eventType: 'missed-tick-simulated',
      taskId: this.id,
      taskName: this.metrics.name,
      timestamp: new Date(),
      runId,
      scheduledTime: scheduled,
      skipReason: 'idle',
      activeConcurrentRuns: this.activeConcurrentRuns
    })
  }

  markRemoved(forceAbort: boolean) {
    this.removed = true
    if (forceAbort && this.lastActiveRun) {
      this.lastActiveRun.controller.abort()
    }
    this.queue.clear()
  }

  isRemoved() {
    return this.removed
  }

  // Internal
  private emitEvent(ev: TaskEventPayload) {
    if (this.minimizeAllocations) {
      // Basit object pool: tek reuse edilebilir referans
      this.reusableEventPayload = { ...ev }
      this.subject.next(this.reusableEventPayload)
      this.emitGlobal(this.reusableEventPayload)
    } else {
      this.subject.next(ev)
      this.emitGlobal(ev)
    }
  }

  private enqueueRun(
    triggerType: 'cron' | 'manual',
    scheduledTime: Date | null
  ) {
    const policy = this.config.overlapPolicy
    if (policy === 'parallel') {
      this.startRun(triggerType, scheduledTime, policy)
      this.emitEvent({
        eventType: 'overlap-parallel',
        taskId: this.id,
        taskName: this.metrics.name,
        timestamp: new Date(),
        activeConcurrentRuns: this.activeConcurrentRuns
      })
      return
    }
    if (this.queueBusy) {
      this.queue.enqueue(() =>
        this.startRun(triggerType, scheduledTime, policy)
      )
      this.emitEvent({
        eventType: 'overlap-queued',
        taskId: this.id,
        taskName: this.metrics.name,
        timestamp: new Date(),
        activeConcurrentRuns: this.activeConcurrentRuns
      })
    } else {
      this.startRun(triggerType, scheduledTime, policy)
    }
  }

  private startRun(
    triggerType: 'cron' | 'manual',
    scheduledTime: Date | null,
    overlapPolicy: OverlapPolicy
  ) {
    if (this.removed) return
    const runId = ++this.runIdSeq
    const start = new Date()
    const controller = new AbortController()
    const timeoutMs = this.config.timeoutMs

    const activeRun: ActiveRun = {
      controller,
      scheduledTime,
      triggerType,
      runId,
      overlapPolicy,
      startTime: start
    }
    this.lastActiveRun = activeRun
    this.activeRunIds.add(runId)

    const ctx: TaskRunContext = {
      taskId: this.id,
      runId,
      scheduledTime,
      actualStartTime: start,
      abortSignal: controller.signal,
      triggerType,
      overlapPolicy,
      timeoutMs,
      isAborted: () => controller.signal.aborted
    }

    const driftMs = scheduledTime
      ? start.getTime() - scheduledTime.getTime()
      : null

    this.history.push({
      runId,
      status: 'running',
      triggerType,
      scheduledTime,
      actualStartTime: start,
      endTime: null,
      durationMs: null,
      driftMs,
      timestamp: new Date(),
      overlapPolicyUsed: overlapPolicy
    })

    this.emitEvent({
      eventType: 'task-start',
      taskId: this.id,
      taskName: this.metrics.name,
      timestamp: new Date(),
      runId,
      scheduledTime,
      actualStartTime: start,
      driftMs,
      triggerType,
      overlapPolicy,
      activeConcurrentRuns: this.activeConcurrentRuns
    })

    if (overlapPolicy === 'queue') this.queueBusy = true
    else this.activeConcurrentRuns++

    if (timeoutMs && timeoutMs > 0) {
      activeRun.timeoutHandle = window.setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort()
          this.finishRun(runId, 'timeout', {
            scheduledTime,
            actualStartTime: start,
            driftMs,
            triggerType,
            overlapPolicy,
            error: { name: 'TimeoutError', message: 'Timeout' }
          })
          this.emitEvent({
            eventType: 'task-timeout',
            taskId: this.id,
            taskName: this.metrics.name,
            timestamp: new Date(),
            runId,
            scheduledTime,
            actualStartTime: start,
            driftMs,
            triggerType,
            overlapPolicy,
            timeoutMs,
            activeConcurrentRuns: this.activeConcurrentRuns
          })
        }
      }, timeoutMs)
    }

    let result: void | Promise<void>
    try {
      result = this.callback(ctx)
    } catch (err) {
      this.finishRun(runId, 'error', {
        scheduledTime,
        actualStartTime: start,
        driftMs,
        triggerType,
        overlapPolicy,
        error: this.serializeError(err)
      })
      return
    }

    if (result instanceof Promise) {
      result
        .then(() => {
          if (!controller.signal.aborted) {
            this.finishRun(runId, 'success', {
              scheduledTime,
              actualStartTime: start,
              driftMs,
              triggerType,
              overlapPolicy
            })
          }
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            this.finishRun(runId, 'error', {
              scheduledTime,
              actualStartTime: start,
              driftMs,
              triggerType,
              overlapPolicy,
              error: this.serializeError(err)
            })
          }
        })
    } else {
      if (!controller.signal.aborted) {
        this.finishRun(runId, 'success', {
          scheduledTime,
          actualStartTime: start,
          driftMs,
          triggerType,
          overlapPolicy
        })
      }
    }
  }

  private finishRun(
    runId: number,
    status: 'success' | 'error' | 'timeout',
    meta: {
      scheduledTime: Date | null
      actualStartTime: Date
      driftMs: number | null
      triggerType: 'cron' | 'manual'
      overlapPolicy: OverlapPolicy
      error?: { name?: string; message?: string; stack?: string }
    }
  ) {
    if (!this.activeRunIds.has(runId)) return
    this.activeRunIds.delete(runId)

    const end = new Date()
    const updated = this.history.update(runId, (old) => {
      const durationMs = old.actualStartTime
        ? end.getTime() - old.actualStartTime.getTime()
        : null
      return {
        ...old,
        status,
        endTime: end,
        durationMs,
        error: meta.error
      }
    })
    if (!updated) return

    // Update metrics
    this.updateMetricsOnFinish(runId)

    if (status === 'success') {
      this.emitEvent({
        eventType: 'task-success',
        taskId: this.id,
        taskName: this.metrics.name,
        timestamp: new Date(),
        runId,
        scheduledTime: meta.scheduledTime,
        actualStartTime: meta.actualStartTime,
        durationMs: this.history.find(runId)?.durationMs ?? null,
        driftMs: meta.driftMs,
        triggerType: meta.triggerType,
        overlapPolicy: meta.overlapPolicy,
        activeConcurrentRuns: this.activeConcurrentRuns
      })
    } else if (status === 'error') {
      this.emitEvent({
        eventType: 'task-error',
        taskId: this.id,
        taskName: this.metrics.name,
        timestamp: new Date(),
        runId,
        scheduledTime: meta.scheduledTime,
        actualStartTime: meta.actualStartTime,
        durationMs: this.history.find(runId)?.durationMs ?? null,
        driftMs: meta.driftMs,
        error: meta.error,
        triggerType: meta.triggerType,
        overlapPolicy: meta.overlapPolicy,
        activeConcurrentRuns: this.activeConcurrentRuns
      })
    }

    this.emitEvent({
      eventType: 'task-complete',
      taskId: this.id,
      taskName: this.metrics.name,
      timestamp: new Date(),
      runId,
      scheduledTime: meta.scheduledTime,
      actualStartTime: meta.actualStartTime,
      durationMs: this.history.find(runId)?.durationMs ?? null,
      driftMs: meta.driftMs,
      triggerType: meta.triggerType,
      overlapPolicy: meta.overlapPolicy,
      activeConcurrentRuns: this.activeConcurrentRuns
    })

    if (this.lastActiveRun?.runId === runId) {
      if (this.lastActiveRun.timeoutHandle)
        clearTimeout(this.lastActiveRun.timeoutHandle)
      this.lastActiveRun = null
    }

    if (this.config.overlapPolicy === 'queue') {
      const next = this.queue.dequeue()
      if (next) {
        next()
      } else {
        this.queueBusy = false
      }
    } else {
      this.activeConcurrentRuns = Math.max(0, this.activeConcurrentRuns - 1)
    }
  }

  private updateMetricsOnFinish(runId: number) {
    const entry = this.history.find(runId)
    if (!entry) return
    if (entry.status === 'skipped') {
      // skipped zaten kaydedildi
      return
    }
    this.metrics.totalRuns++
    // status counters
    if (entry.status === 'success') {
      this.metrics.successfulRuns++
      this.metrics.consecutiveFailures = 0
    } else if (entry.status === 'error') {
      this.metrics.failedRuns++
      this.metrics.consecutiveFailures++
    } else if (entry.status === 'timeout') {
      this.metrics.timeoutRuns++
      this.metrics.consecutiveFailures++
    }

    if (entry.triggerType === 'manual') this.metrics.manualRuns++

    const d = entry.durationMs
    if (d != null) {
      if (this.metrics.averageDurationMs == null) {
        this.metrics.averageDurationMs = d
      } else {
        this.metrics.averageDurationMs =
          (this.metrics.averageDurationMs * (this.metrics.totalRuns - 1) + d) /
          this.metrics.totalRuns
      }
      this.metrics.maxDurationMs =
        this.metrics.maxDurationMs == null
          ? d
          : Math.max(this.metrics.maxDurationMs, d)
      this.metrics.minDurationMs =
        this.metrics.minDurationMs == null
          ? d
          : Math.min(this.metrics.minDurationMs, d)
      this.metrics.totalRunTimeMs += d
    }

    const drift = entry.driftMs
    if (drift != null) {
      if (this.metrics.averageDriftMs == null) {
        this.metrics.averageDriftMs = drift
      } else {
        this.metrics.averageDriftMs =
          (this.metrics.averageDriftMs * (this.metrics.totalRuns - 1) + drift) /
          this.metrics.totalRuns
      }
      this.metrics.maxDriftMs =
        this.metrics.maxDriftMs == null
          ? drift
          : Math.max(this.metrics.maxDriftMs, drift)
    }

    if (entry.actualStartTime && this.lastFinishedRunStart) {
      const interval =
        entry.actualStartTime.getTime() - this.lastFinishedRunStart.getTime()
      if (interval > 0) {
        const n = this.metrics.totalRuns - 1
        this.metrics.averageIntervalMs =
          this.metrics.averageIntervalMs == null
            ? interval
            : (this.metrics.averageIntervalMs * (n - 1) + interval) / n
      }
    }
    if (!this.metrics.uptimeSinceFirstRun && entry.actualStartTime) {
      this.metrics.uptimeSinceFirstRun = entry.actualStartTime
    }
    this.metrics.lastRunStartedAt = entry.actualStartTime
    this.metrics.lastRunFinishedAt = entry.endTime
    if (entry.status === 'error') {
      this.metrics.lastErrorMessage = entry.error?.message ?? null
      this.metrics.lastErrorAt = entry.endTime
    } else if (entry.status === 'timeout') {
      this.metrics.lastErrorMessage = 'Timeout'
      this.metrics.lastErrorAt = entry.endTime
    }
    this.lastFinishedRunStart = entry.actualStartTime

    // Percentiles
    if (this.useStreaming && this.streamingEstimator && d != null) {
      this.streamingEstimator.addSample(d)
      const estimates = this.streamingEstimator.estimates()
      for (const k of Object.keys(estimates)) {
        this.metrics.dynamicPercentiles[k] = estimates[k]
      }
      // Legacy fields p95/p99 (kullanılıyorsa)
      this.metrics.p95DurationMs =
        this.metrics.dynamicPercentiles['p95'] ?? this.metrics.p95DurationMs
      this.metrics.p99DurationMs =
        this.metrics.dynamicPercentiles['p99'] ?? this.metrics.p99DurationMs
      // drift percentilleri streaming’e alınmadı (isteğe bağlı)
    } else {
      this.recalculatePercentilesFromHistory()
    }
  }

  private recalculatePercentilesFromHistory() {
    // History küçük olduğu varsayımıyla O(n log n) sorting
    const durations: number[] = []
    const drifts: number[] = []
    for (const r of this.history.toArray()) {
      if (r.status === 'skipped') continue
      if (r.durationMs != null) durations.push(r.durationMs)
      if (r.driftMs != null) drifts.push(r.driftMs)
    }
    const compute = (arr: number[], p: number) => {
      if (!arr.length) return null
      const sorted = [...arr].sort((a, b) => a - b)
      const idx = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(p * sorted.length) - 1)
      )
      return sorted[idx]
    }
    this.metrics.p95DurationMs = compute(durations, 0.95)
    this.metrics.p99DurationMs = compute(durations, 0.99)
    this.metrics.p95DriftMs = compute(drifts, 0.95)
    this.metrics.p99DriftMs = compute(drifts, 0.99)
    this.percentileFractions.forEach((frac, i) => {
      const key = this.percentileKeys[i]
      this.metrics.dynamicPercentiles[key] = compute(durations, frac)
    })
  }

  private recordSkip(triggerType: 'cron' | 'manual', reason: string) {
    const runId = ++this.runIdSeq
    const now = new Date()
    this.history.push({
      runId,
      status: 'skipped',
      triggerType,
      scheduledTime: triggerType === 'cron' ? now : null,
      actualStartTime: null,
      endTime: null,
      durationMs: null,
      driftMs: null,
      timestamp: now,
      skipReason: reason,
      overlapPolicyUsed: this.config.overlapPolicy
    })
    this.metrics.skippedRuns++
    this.emitEvent({
      eventType: 'task-skip',
      taskId: this.id,
      taskName: this.metrics.name,
      timestamp: now,
      runId,
      skipReason: reason,
      triggerType,
      activeConcurrentRuns: this.activeConcurrentRuns
    })
  }

  private resetMetrics() {
    const { taskId, name, uptimeSinceFirstRun, skippedRuns } = this.metrics
    const skippedPreserve = this.resetKeepsSkipped ? skippedRuns : 0
    this.metrics = {
      taskId,
      name,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      timeoutRuns: 0,
      skippedRuns: skippedPreserve,
      manualRuns: 0,
      consecutiveFailures: 0,
      averageDurationMs: null,
      maxDurationMs: null,
      minDurationMs: null,
      p95DurationMs: null,
      p99DurationMs: null,
      averageDriftMs: null,
      maxDriftMs: null,
      p95DriftMs: null,
      p99DriftMs: null,
      totalRunTimeMs: 0,
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      missedTickCount: 0,
      uptimeSinceFirstRun,
      averageIntervalMs: null,
      dynamicPercentiles: this.percentileKeys.reduce<
        Record<string, number | null>
      >((acc, k) => {
        acc[k] = null
        return acc
      }, {})
    }
    if (this.streamingEstimator) this.streamingEstimator.reset()
  }

  private serializeError(err: unknown) {
    if (err instanceof Error) {
      return { name: err.name, message: err.message, stack: err.stack }
    }
    return { message: String(err) }
  }
}
