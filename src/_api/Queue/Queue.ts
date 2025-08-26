type QueueStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retrying'
type QueueState = 'idle' | 'running' | 'paused' | 'stopped'

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

class QueueEntry<T = any> {
  public readonly id: string
  public task: () => Promise<T>
  public timeout: number
  public status: QueueStatus = 'pending'
  public retryCount: number = 0
  public requeueCount: number = 0
  public error?: Error
  public result?: T

  constructor(task: () => Promise<T>, timeout: number) {
    this.id = Math.random().toString(36).substring(2, 9)
    this.task = task
    this.timeout = timeout
  }

  updateStatus(status: QueueStatus) {
    this.status = status
  }
}

interface QueueEvents<T> {
  add: (entry: QueueEntry<T>) => void
  process: (entry: QueueEntry<T>) => void
  success: (entry: QueueEntry<T>, result: T) => void
  error: (entry: QueueEntry<T>, error: Error) => void
  retry: (entry: QueueEntry<T>, attempt: number) => void
  requeue: (entry: QueueEntry<T>) => void
  status: (state: QueueState) => void
}

export class Queue<T = any> {
  private entries: QueueEntry<T>[] = []
  private state: QueueState = 'idle'
  // @ts-ignore
  private eventEmitter = new EventEmitter<QueueEvents<T>>()

  constructor() {
    this.eventEmitter.setMaxListeners(Infinity)
  }

  on<K extends keyof QueueEvents<T>>(
    event: K,
    listener: QueueEvents<T>[K]
  ): void {
    this.eventEmitter.on(event, listener)
  }

  off<K extends keyof QueueEvents<T>>(
    event: K,
    listener: QueueEvents<T>[K]
  ): void {
    this.eventEmitter.off(event, listener)
  }

  add(entry: QueueEntry<T>): void {
    this.entries.push(entry)
    this.eventEmitter.emit('add', entry)
    if (this.state === 'idle') this.start()
  }

  start(): void {
    if (this.state !== 'stopped') {
      this.state = 'running'
      this.eventEmitter.emit('status', this.state)
      this.processQueue()
    }
  }

  stop(): void {
    this.state = 'stopped'
    this.entries = []
    this.eventEmitter.emit('status', this.state)
  }

  pause(): void {
    if (this.state === 'running') {
      this.state = 'paused'
      this.eventEmitter.emit('status', this.state)
    }
  }

  resume(): void {
    if (this.state === 'paused') {
      this.state = 'running'
      this.eventEmitter.emit('status', this.state)
      this.processQueue()
    }
  }

  private async processQueue() {
    while (this.state === 'running' && this.entries.length > 0) {
      const entry = this.entries.shift()!
      await this.processEntry(entry)
    }

    if (this.entries.length === 0) {
      this.state = 'idle'
      this.eventEmitter.emit('status', this.state)
    }
  }

  private async processEntry(entry: QueueEntry<T>): Promise<void> {
    entry.updateStatus('processing')
    this.eventEmitter.emit('process', entry)

    let attempts = 0
    let success = false

    while (attempts < 3 && !success) {
      attempts++
      entry.retryCount = attempts
      entry.updateStatus('retrying')
      this.eventEmitter.emit('retry', entry, attempts)

      try {
        const result = await this.executeWithTimeout(entry)
        entry.result = result
        entry.updateStatus('completed')
        this.eventEmitter.emit('success', entry, result)
        success = true
      } catch (error) {
        entry.error = error as Error

        if (error instanceof TimeoutError) {
          if (attempts === 3) {
            entry.updateStatus('failed')
            this.requeueEntry(entry)
          }
        } else {
          entry.updateStatus('failed')
          this.eventEmitter.emit('error', entry, entry.error)
          break
        }
      }
    }
  }

  private async executeWithTimeout(entry: QueueEntry<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new TimeoutError(`Task timed out after ${entry.timeout}ms`))
      }, entry.timeout)

      entry
        .task()
        .then((result) => {
          resolve(result)
        })
        .catch((error) => {
          reject(error)
        })
        .finally(() => {
          clearTimeout(timeout)
        })
    })
  }

  private requeueEntry(entry: QueueEntry<T>) {
    entry.requeueCount++
    entry.retryCount = 0
    entry.updateStatus('pending')
    this.entries.push(entry)
    ;(this.eventEmitter.emit as any)('requeue', entry)
  }
}

// Generic EventEmitter implementation with proper typing
class EventEmitter<T extends Record<string, (...args: any[]) => void>> {
  private listeners: {
    [K in keyof T]?: T[K][]
  } = {}

  on<K extends keyof T>(event: K, listener: T[K]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event]!.push(listener)
  }

  off<K extends keyof T>(event: K, listener: T[K]): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event]!.filter(
        (l) => l !== listener
      )
    }
  }

  emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): void {
    const listeners = this.listeners[event]
    if (listeners) {
      for (const listener of listeners) {
        listener(...args)
      }
    }
  }

  setMaxListeners(n: number) {
    // Implementation omitted for brevity
    console.log('setMaxListeners', n)
  }
}

/*
// Create queue instance
const queue = new Queue<string>()

// Subscribe to events
queue.on('add', (entry) => {
  console.log(`New entry added: ${entry.id}`)
})

queue.on('success', (entry, result) => {
  console.log(`Entry ${entry.id} completed with result: ${result}`)
})

// Create a sample entry
const entry = new QueueEntry(
  () =>
    new Promise<string>((resolve) =>
      setTimeout(() => resolve('Task result'), 500)
    ),
  1000 // Timeout after 1 second
)

// Add entry to queue
queue.add(entry)

// Start processing
queue.start()
*/

// Control queue state
// queue.pause();
// queue.resume();
// queue.stop();
