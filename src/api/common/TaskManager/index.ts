export * from './task-manager'
export * from './task-types'
/*
const manager = new TaskManager({
  runHistoryLimit: 50,
  defaultTimeoutMs: 10_000,
  percentiles: [0.9, 0.95, 0.99]
})

// Event örneği
manager.getEvents$().subscribe((e) => {
  if (e.eventType === 'task-error') {
    console.error('[EVENT][ERROR]', e)
  }
})

// Görev ekleme
const taskA = manager.addTask(
  {
    cron: '*!/5 * * * * *',
    name: 'SampleTaskA',
    overlapPolicy: 'queue',
    allowManualTrigger: true,
    pauseOnIdle: true
  },
  async (ctx) => {
    if (ctx.abortSignal.aborted) return
    await new Promise((res) => setTimeout(res, 300))
  }
)

// Manuel tetik
const manual = manager.triggerNow(taskA)
console.log('Manual trigger result:', manual)

// Aktivite durumları
setTimeout(() => manager.setActivityState(false), 12_000)
setTimeout(() => manager.setActivityState(true), 20_000)

// Metrikler
setInterval(() => {
  console.log('TaskA metrics', manager.getMetrics(taskA.id))
  console.log('Global metrics', manager.getMetrics())
}, 10_000)

// Kapatma
setTimeout(() => {
  manager.shutdown()
  console.log('Shutdown complete')
}, 60_000)*/
