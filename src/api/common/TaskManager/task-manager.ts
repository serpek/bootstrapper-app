import { Cron } from 'croner'
import { Subject } from 'rxjs'
import { inject, singleton } from 'tsyringe'

import { type ILogService, LogLevel } from '@bipweb/common'
import { dependsOn } from '@bipweb/core'

import { Task } from './task'
import {
  GlobalMetrics,
  ITaskManager,
  ManualTriggerResult,
  TaskCallback,
  TaskConfig,
  TaskEventPayload,
  TaskManagerConfig,
  TaskMetrics,
  WorkerInboundMessage,
  WorkerOutboundMessage
} from './task-types'

interface InlineScheduler {
  cron: Cron
  taskId: string
}

const DEFAULT_CFG: Required<
  Omit<TaskManagerConfig, 'logger' | 'loggerOptions' | 'workerFactory'>
> = {
  runHistoryLimit: 50,
  manualTriggerRateLimitMs: 100,
  percentiles: [0.95, 0.99],
  maxSimulateMissedPerResume: 1000,
  useStreamingQuantiles: false,
  minimizeAllocations: false,
  resetKeepsSkippedCounts: false,
  useWorker: true,
  workerBatching: {
    enabled: true,
    flushIntervalMs: 5,
    maxBatchSize: 100
  },
  initialActive: true,
  defaultTimeoutMs: 30_000
}

@dependsOn('LogService')
@singleton()
export class TaskManager implements ITaskManager {
  public isInitialized: boolean = false
  private readonly _name: string = 'TaskManager'
  private _logger: ILogService<any>
  // private logger!: Logger<ILogObj>
  private config!: typeof DEFAULT_CFG
  // private config: InternalConfig

  private tasks = new Map<string, Task>()
  private idSeq = 0
  private worker: Worker | null = null
  private activityState: 'active' | 'idle' = 'idle'
  private pauseTimestamps = new Map<string, Date>()
  private lastGlobalEventAt: Date | null = null
  private inlineSchedulers = new Map<string, InlineScheduler>()
  private globalSubject = new Subject<TaskEventPayload>()
  private globalCache: GlobalMetrics | null = null
  private dirtyGlobal = true
  private workerFactory?: (() => Worker) | undefined

  constructor(@inject('LogService') private logger: ILogService<any>) {
    this._logger = this.logger.create({
      name: this._name
    })
    this._logger.init(`${this._name} created...`)
  }

  init(): void {
    if (!this.isInitialized) {
      this.isInitialized = true
      this._logger.debug(`${this._name} initialized`)
      //await sleep(1000)
    }
  }

  public configure(config: TaskManagerConfig): void {
    this.config = { ...DEFAULT_CFG, ...config }

    // if (config.logger) {
    //   this.logger = config.logger
    // } else {
    //   this.logger = new Logger<ILogObj>({
    //     name: 'AuthManager',
    //     ...config.loggerOptions
    //   })
    // }
    this._logger.info('AuthManager configured')

    this.activityState = this.config.initialActive ? 'active' : 'idle'

    if (this.config.useWorker && typeof window !== 'undefined') {
      this.workerFactory = config.workerFactory
      this.worker = this.initWorker()
      this._logger.debug('Worker mode aktif')
    } else {
      if (!this.config.useWorker)
        this._logger.info('Worker devre dışı (inline cron).')
      if (typeof window === 'undefined')
        this._logger.info('SSR ortam – worker yok.')
    }

    // Başlangıç idle ise ilgili task'ları pause’a al
    if (this.activityState === 'idle') {
      // Tasklar henüz eklenmedi; addTask içinde autoStart davranışı devreye girer
      this._logger.info('Başlangıç durumu: idle')
    }

    this.getEvents$().subscribe((e) => {
      this.lastGlobalEventAt = e.timestamp
      this.dirtyGlobal = true
      this.logEvent(e)
    })
  }

  // ---- Public API ----
  getEvents$() {
    return this.globalSubject.asObservable()
  }

  addTask(_config: TaskConfig, callback: TaskCallback): Task {
    const id = this.nextId()
    const effectiveTimeout =
      _config.timeoutMs !== undefined
        ? _config.timeoutMs
        : this.config.defaultTimeoutMs

    const task = new Task(
      id,
      { ..._config, timeoutMs: effectiveTimeout },
      callback,
      {
        historyLimit: this.config.runHistoryLimit,
        manualTriggerRateLimitMs: this.config.manualTriggerRateLimitMs,
        globalEmitter: (e) => this.emitGlobal(e),
        percentiles: this.config.percentiles,
        useStreamingQuantiles: this.config.useStreamingQuantiles,
        resetKeepsSkippedCounts: this.config.resetKeepsSkippedCounts,
        minimizeAllocations: this.config.minimizeAllocations
      }
    )
    this.tasks.set(id, task)

    if (this.config.useWorker && this.worker) {
      this.worker.postMessage(<WorkerInboundMessage>{
        type: 'add',
        taskId: id,
        cron: _config.cron,
        timezone: _config.timezone,
        autoStart: _config.autoStart ?? true
      })
    } else {
      const timezone = _config.timezone === 'UTC' ? 'UTC' : undefined
      const cron = new Cron(
        _config.cron,
        {
          timezone,
          protect: true,
          paused: _config.autoStart === false || this.activityState === 'idle'
        },
        (selfCron: Cron) => {
          const prev = selfCron.previousRun()
          const scheduled = prev ? prev.getTime() : Date.now()
          task.handleScheduledTick(scheduled)
          if (this.logger.settings.minLevel === LogLevel.TRACE)
            this._logger.trace('inline-tick', { taskId: id, scheduled })
        }
      )
      this.inlineSchedulers.set(id, { cron, taskId: id })
    }

    this.emitGlobal({
      eventType: 'task-added',
      taskId: id,
      taskName: task.getMetrics().name,
      timestamp: new Date()
    })

    return task
  }

  removeTask(taskOrId: string | Task, forceCancel = true): boolean {
    const id = typeof taskOrId === 'string' ? taskOrId : taskOrId.id
    const task = this.tasks.get(id)
    if (!task) return false

    task.markRemoved(forceCancel)
    this.tasks.delete(id)

    if (this.config.useWorker && this.worker) {
      this.worker.postMessage({ type: 'remove', taskId: id })
    } else {
      const inline = this.inlineSchedulers.get(id)
      inline?.cron.stop()
      this.inlineSchedulers.delete(id)
    }
    this.pauseTimestamps.delete(id)

    this.emitGlobal({
      eventType: 'task-removed',
      taskId: id,
      taskName: task?.getMetrics().name ?? id,
      timestamp: new Date()
    })
    return true
  }

  listTasks(): Task[] {
    return [...this.tasks.values()]
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  triggerNow(taskOrId: string | Task): ManualTriggerResult {
    const id = typeof taskOrId === 'string' ? taskOrId : taskOrId.id
    const task = this.tasks.get(id)
    if (!task) return { ok: false, reason: 'disabled' }
    return task.manualTrigger()
  }

  startAll() {
    this.tasks.forEach((t) => {
      if (t.config.pauseOnIdle) {
        if (this.config.useWorker && this.worker) {
          this.worker.postMessage({ type: 'resume', taskId: t.id })
        } else {
          this.inlineSchedulers.get(t.id)?.cron.resume()
        }
        this.emitGlobal({
          eventType: 'task-resumed',
          taskId: t.id,
          taskName: t.getMetrics().name,
          timestamp: new Date()
        })
        this.pauseTimestamps.delete(t.id)
      }
    })
  }

  pauseAll() {
    this.tasks.forEach((t) => {
      if (this.config.useWorker && this.worker) {
        this.worker.postMessage({ type: 'pause', taskId: t.id })
      } else {
        this.inlineSchedulers.get(t.id)?.cron.pause()
      }
      this.pauseTimestamps.set(t.id, new Date())
      this.emitGlobal({
        eventType: 'task-paused',
        taskId: t.id,
        taskName: t.getMetrics().name,
        timestamp: new Date()
      })
    })
  }

  resumeAll() {
    this.startAll()
  }

  setActivityState(isActive: boolean) {
    const target: 'active' | 'idle' = isActive ? 'active' : 'idle'
    if (this.activityState === target) return
    const prev = this.activityState
    this.activityState = target

    if (target === 'idle') {
      this.tasks.forEach((task) => {
        if (task.config.pauseOnIdle) {
          if (this.config.useWorker && this.worker) {
            this.worker.postMessage({ type: 'pause', taskId: task.id })
          } else {
            this.inlineSchedulers.get(task.id)?.cron.pause()
          }
          this.pauseTimestamps.set(task.id, new Date())
          this.emitGlobal({
            eventType: 'task-paused',
            taskId: task.id,
            taskName: task.getMetrics().name,
            timestamp: new Date()
          })
        }
      })
    } else {
      const now = new Date()
      this.tasks.forEach((task) => {
        if (task.config.pauseOnIdle) {
          const pausedAt = this.pauseTimestamps.get(task.id)
          if (pausedAt) {
            this.simulateMissedForTask(task, pausedAt, now)
            this.pauseTimestamps.delete(task.id)
          }
          if (this.config.useWorker && this.worker) {
            this.worker.postMessage({ type: 'resume', taskId: task.id })
          } else {
            this.inlineSchedulers.get(task.id)?.cron.resume()
          }
          this.emitGlobal({
            eventType: 'task-resumed',
            taskId: task.id,
            taskName: task.getMetrics().name,
            timestamp: now
          })
        }
      })
    }

    this.emitGlobal({
      eventType: 'activity-state-changed',
      taskId: 'GLOBAL',
      taskName: 'GLOBAL',
      timestamp: new Date()
    })

    this._logger.debug(
      `Activity state changed ${prev} -> ${this.activityState}`
    )
  }

  getMetrics(
    taskOrId?: string | Task,
    opts?: { reset?: boolean }
  ): TaskMetrics | GlobalMetrics {
    if (!taskOrId) {
      if (this.dirtyGlobal || !this.globalCache) {
        this.globalCache = this.computeGlobalMetrics()
        this.dirtyGlobal = false
      }
      return this.globalCache
    }
    const id = typeof taskOrId === 'string' ? taskOrId : taskOrId.id
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    return task.getMetrics(opts)
  }

  resetAllTaskMetrics() {
    this.tasks.forEach((t) => t.getMetrics({ reset: true }))
  }

  shutdown() {
    if (this.worker) {
      this.worker.postMessage({ type: 'shutdown' })
      this.worker.terminate()
    }
    this.worker = null
    this.inlineSchedulers.forEach((s) => s.cron.stop())
    this.inlineSchedulers.clear()
    this.tasks.clear()
    this.pauseTimestamps.clear()
    this._logger.info('Shutdown tamamlandı.')
  }

  // ---- Worker Handling ----
  private initWorker(): Worker | null {
    if (this.workerFactory) {
      try {
        const w = this.workerFactory()
        this.bindWorker(w)
        this.postBatchingConfig(w)
        return w
      } catch (err) {
        this._logger.error('custom workerFactory hata:', err)
        return null
      }
    }
    try {
      const w = new Worker(new URL('./schedule-worker.ts', import.meta.url), {
        type: 'module'
      })
      this.bindWorker(w)
      this.postBatchingConfig(w)
      return w
    } catch (err) {
      this._logger.warn('Worker init hatası:', err)
      return null
    }
  }

  private postBatchingConfig(w: Worker) {
    if (!this.config.workerBatching.enabled) {
      this._logger.debug('Worker batching devre dışı.')
      return
    }
    w.postMessage({
      type: 'batch-config',
      batching: this.config.workerBatching
    })
    this._logger.debug('Batch config gönderildi', this.config.workerBatching)
  }

  private bindWorker(worker: Worker) {
    worker.onmessage = (evt: MessageEvent<WorkerOutboundMessage>) =>
      this.handleWorkerMessage(evt.data)
  }

  // ---- Events / Logging ----
  private logEvent(e: TaskEventPayload) {
    const lvl = this.logger.settings.minLevel
    if (lvl === LogLevel.SILENT) return

    const type = e.eventType

    const errorEvents = ['task-error', 'task-timeout']
    const warnExtra = ['missed-tick-simulated', 'task-removed']
    const infoSet = [
      'task-added',
      'task-start',
      'task-success',
      'task-complete',
      'task-paused',
      'task-resumed',
      'task-manual-trigger',
      'activity-state-changed',
      'task-skip'
    ]
    const overlapSet = ['overlap-queued', 'overlap-parallel']

    const baseMsg = () =>
      `${type} task=${e.taskId}${e.runId !== undefined ? ' run=' + e.runId : ''}${e.durationMs != null ? ' dur=' + e.durationMs + 'ms' : ''}`

    if (errorEvents.includes(type)) {
      this._logger.error(baseMsg(), e.error?.message)
      if (lvl === LogLevel.TRACE) this._logger.trace('payload', this.compact(e))
      return
    }
    if (lvl === LogLevel.ERROR) return

    if (warnExtra.includes(type)) {
      this._logger.warn(baseMsg())
      if (lvl === LogLevel.TRACE) this._logger.trace('payload', this.compact(e))
      return
    }
    if (lvl === LogLevel.WARN) return

    if (infoSet.includes(type)) {
      this._logger.info(baseMsg())
      if (lvl === LogLevel.TRACE) this._logger.trace('payload', this.compact(e))
      return
    }
    if (lvl === LogLevel.INFO) return

    if (overlapSet.includes(type)) {
      this._logger.debug(baseMsg())
      if (lvl === LogLevel.TRACE) this._logger.trace('payload', this.compact(e))
      return
    }
    if (lvl === LogLevel.DEBUG) {
      this._logger.debug(baseMsg())
    } else if (lvl === LogLevel.TRACE) {
      this._logger.trace(baseMsg(), this.compact(e))
    }
  }

  private compact(e: any) {
    return JSON.parse(JSON.stringify(e))
  }

  // ---- Internal helpers ----
  private nextId(): string {
    this.idSeq += 1
    return `t${this.idSeq}`
  }

  private emitGlobal(event: TaskEventPayload) {
    this.globalSubject.next(event)
    this.dirtyGlobal = true
  }

  private handleWorkerMessage(msg: WorkerOutboundMessage) {
    switch (msg.type) {
      case 'tick': {
        const task = this.tasks.get(msg.taskId)
        if (task) {
          task.handleScheduledTick(msg.scheduledTime)
          if (this.logger.settings.minLevel === LogLevel.TRACE)
            this._logger.trace('worker-tick', {
              taskId: msg.taskId,
              scheduled: msg.scheduledTime
            })
        }
        break
      }
      case 'tick-batch': {
        if (this.logger.settings.minLevel === LogLevel.TRACE)
          this._logger.trace(`worker-tick-batch size=${msg.entries.length}`)
        for (const entry of msg.entries) {
          const task = this.tasks.get(entry.taskId)
          if (task) task.handleScheduledTick(entry.scheduledTime)
        }
        break
      }
      case 'log':
        if (this.logger.settings.minLevel === LogLevel.TRACE)
          this._logger.trace('[worker-log]', msg.level, msg.message)
        break
      case 'error':
        this._logger.error('[worker-error]', msg.error)
        break
    }
  }

  private simulateMissedForTask(task: Task, pausedAt: Date, resumedAt: Date) {
    const cfg = (task as any).config as Required<
      Omit<TaskConfig, 'timeoutMs'>
    > & { timeoutMs?: number }
    const expr = cfg.cron
    const tz = cfg.timezone === 'UTC' ? 'UTC' : undefined

    const secondPattern = /^(\*\/(\d+)|\d+)\s+\*\s+\*\s+\*\s+\*\s+\*$/
    if (secondPattern.test(expr)) {
      const firstField = expr.split(/\s+/)[0]
      let interval = 1
      if (firstField.includes('/'))
        interval = parseInt(firstField.split('/')[1], 10) || 1
      if (interval > 0) {
        const deltaSec = Math.floor(
          (resumedAt.getTime() - pausedAt.getTime()) / 1000
        )
        const missed = Math.min(
          Math.floor(deltaSec / interval),
          this.config.maxSimulateMissedPerResume
        )
        if (missed > 0) {
          for (let i = missed; i >= 1; i--) {
            const ts = new Date(resumedAt.getTime() - i * interval * 1000)
            if (ts > pausedAt) task.simulateMissedTick(ts)
          }
          if (this.logger.settings.minLevel === LogLevel.TRACE)
            this._logger.trace('missed-heuristic', {
              taskId: task.id,
              missed,
              interval
            })
          return
        }
      }
    }

    let cursor = new Date(pausedAt.getTime() - 1000)
    let simulated = 0
    const max = this.config.maxSimulateMissedPerResume
    while (simulated < max) {
      const temp = new Cron(expr, {
        timezone: tz,
        startAt: cursor,
        maxRuns: 1,
        paused: true,
        protect: true
      })
      const next = temp.nextRun()
      if (!next || next >= resumedAt) break
      task.simulateMissedTick(next)
      cursor = new Date(next.getTime() + 1000)
      simulated++
    }
    if (simulated === max) {
      this._logger.warn(
        `Missed tick simulation limit (${max}) reached for task ${task.getMetrics().taskId}`
      )
    } else if (this.logger.settings.minLevel === LogLevel.TRACE) {
      this._logger.trace('missed-fallback', { taskId: task.id, simulated })
    }
  }

  private computeGlobalMetrics(): GlobalMetrics {
    const all = [...this.tasks.values()].map((t) => t.getMetrics())
    if (!all.length) {
      return {
        totalTasks: 0,
        activeTasks: 0,
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        timeoutRuns: 0,
        skippedRuns: 0,
        manualRuns: 0,
        averageDurationMs: null,
        averageDriftMs: null,
        lastEventAt: this.lastGlobalEventAt
      }
    }
    let totalRuns = 0,
      successful = 0,
      failed = 0,
      timeout = 0,
      skipped = 0,
      manual = 0
    let durationWeighted = 0,
      durationWeight = 0
    let driftWeighted = 0,
      driftWeight = 0

    for (const m of all) {
      totalRuns += m.totalRuns
      successful += m.successfulRuns
      failed += m.failedRuns
      timeout += m.timeoutRuns
      skipped += m.skippedRuns
      manual += m.manualRuns
      if (m.averageDurationMs != null && m.totalRuns > 0) {
        durationWeighted += m.averageDurationMs * m.totalRuns
        durationWeight += m.totalRuns
      }
      if (m.averageDriftMs != null && m.totalRuns > 0) {
        driftWeighted += m.averageDriftMs * m.totalRuns
        driftWeight += m.totalRuns
      }
    }

    return {
      totalTasks: all.length,
      activeTasks: all.length,
      totalRuns,
      successfulRuns: successful,
      failedRuns: failed,
      timeoutRuns: timeout,
      skippedRuns: skipped,
      manualRuns: manual,
      averageDurationMs: durationWeight
        ? durationWeighted / durationWeight
        : null,
      averageDriftMs: driftWeight ? driftWeighted / driftWeight : null,
      lastEventAt: this.lastGlobalEventAt
    }
  }
}
