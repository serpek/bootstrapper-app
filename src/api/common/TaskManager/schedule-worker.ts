/// <reference lib="webworker" />
import { Cron } from 'croner'

import {
  WorkerBatchingConfig,
  WorkerInboundMessage,
  WorkerOutboundMessage
} from './task-types'

interface WorkerTask {
  taskId: string
  cron: Cron
}

interface BatchState {
  enabled: boolean
  flushIntervalMs: number
  maxBatchSize: number
  queue: Array<{ taskId: string; scheduledTime: number }>
  flushTimer: number | null
}

const tasks = new Map<string, WorkerTask>()
const batch: BatchState = {
  enabled: true,
  flushIntervalMs: 5,
  maxBatchSize: 100,
  queue: [],
  flushTimer: null
}

function post(msg: WorkerOutboundMessage) {
  ;(self as any).postMessage(msg)
}

function flushBatch() {
  if (!batch.enabled) return
  if (!batch.queue.length) return
  const entries = batch.queue.slice()
  batch.queue.length = 0
  batch.flushTimer && clearTimeout(batch.flushTimer)
  batch.flushTimer = null
  post({ type: 'tick-batch', entries })
}

function enqueueTick(taskId: string, scheduledTime: number) {
  if (!batch.enabled) {
    post({ type: 'tick', taskId, scheduledTime })
    return
  }
  batch.queue.push({ taskId, scheduledTime })
  if (batch.queue.length >= batch.maxBatchSize) {
    flushBatch()
    return
  }
  if (batch.flushTimer == null) {
    batch.flushTimer = setTimeout(
      flushBatch,
      batch.flushIntervalMs
    ) as unknown as number
  }
}

function addTask(msg: Extract<WorkerInboundMessage, { type: 'add' }>) {
  const timezone = msg.timezone === 'UTC' ? 'UTC' : undefined
  const cronInstance = new Cron(
    msg.cron,
    {
      timezone,
      protect: true,
      paused: msg.autoStart === false
    },
    (selfCron: Cron) => {
      const prev = selfCron.previousRun()
      enqueueTick(msg.taskId, prev ? prev.getTime() : Date.now())
    }
  )
  tasks.set(msg.taskId, { cron: cronInstance, taskId: msg.taskId })
}

function controlTask(
  msg: Extract<
    WorkerInboundMessage,
    { type: 'start' | 'pause' | 'resume' | 'remove' }
  >
) {
  const entry = tasks.get(msg.taskId)
  if (!entry) return
  switch (msg.type) {
    case 'pause':
      entry.cron.pause()
      break
    case 'resume':
    case 'start':
      entry.cron.resume()
      break
    case 'remove':
      entry.cron.stop()
      tasks.delete(msg.taskId)
      break
  }
}

function shutdownAll() {
  flushBatch()
  tasks.forEach((t) => t.cron.stop())
  tasks.clear()
  close()
}

function applyBatchConfig(cfg: WorkerBatchingConfig | undefined) {
  if (!cfg) return
  batch.enabled = cfg.enabled ?? batch.enabled
  batch.flushIntervalMs = cfg.flushIntervalMs ?? batch.flushIntervalMs
  batch.maxBatchSize = cfg.maxBatchSize ?? batch.maxBatchSize
}

self.onmessage = (e: MessageEvent<any>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'add':
        addTask(msg)
        break
      case 'start':
      case 'pause':
      case 'resume':
      case 'remove':
        controlTask(msg)
        break
      case 'shutdown':
        shutdownAll()
        break
      case 'batch-config':
        applyBatchConfig(msg.batching)
        break
    }
  } catch (err: any) {
    post({
      type: 'error',
      error: err?.message || String(err)
    })
  }
}
