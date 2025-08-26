import { Observable, Subscriber } from 'rxjs'

export class QueueEntry<T> {
  retries: number = 0
  status: 'pending' | 'processing' | 'completed' | 'failed' = 'pending'
  timeout: number

  constructor(
    public data: T,
    timeout: number = 5000
  ) {
    this.timeout = timeout
  }
}

export class TaskQueue<T> {
  private queue: QueueEntry<T>[] = []
  private isProcessing = false
  private isPaused = false
  private observer$?: Subscriber<void>

  constructor(private maxRetries: number = 3) {}

  get observer() {
    return this.observer$
  }

  enqueue(data: T, timeout: number = 5000): void {
    const entry = new QueueEntry(data, timeout)
    this.queue.push(entry)
    this.processQueue()
  }

  start(): void {
    this.isPaused = false
    this.processQueue()
  }

  stop(): void {
    this.queue = []
    this.isProcessing = false
  }

  pause(): void {
    this.isPaused = true
  }

  resume(): void {
    this.isPaused = false
    this.processQueue()
  }

  getStatus(): { data: T; status: string; retries: number }[] {
    return this.queue.map((entry) => ({
      data: entry.data,
      status: entry.status,
      retries: entry.retries
    }))
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.isPaused) return
    this.isProcessing = true

    while (this.queue.length > 0) {
      const entry = this.queue.shift()!
      entry.status = 'processing'

      try {
        await this.executeTask(entry)
        entry.status = 'completed'
      } catch (error: any) {
        console.error(
          `Task failed: ${entry.data}, Retry: ${entry.retries}, Error: ${error?.message}`
        )
        this.handleFailedTask(entry)
      }
    }

    this.isProcessing = false
  }

  private executeTask(entry: QueueEntry<T>): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error('Task timeout')),
        entry.timeout
      )

      this.observeTask(entry).subscribe({
        next: () => {
          clearTimeout(timeoutId)
          resolve()
        },
        error: () => {
          clearTimeout(timeoutId)
          reject()
        }
      })
    })
  }

  private observeTask(entry: QueueEntry<T>): Observable<void> {
    console.log('observeTask ', entry)
    return new Observable<void>((observer) => {
      this.observer$ = observer
      setTimeout(() => {
        if (Math.random() < 0.3) {
          // Simulating a random failure
          observer.error(new Error('Random failure'))
        } else {
          observer.next()
          observer.complete()
        }
      }, 1000)
    })
  }

  private handleFailedTask(entry: QueueEntry<T>): void {
    entry.retries++
    entry.status = 'failed'
    if (entry.retries < this.maxRetries) {
      this.queue.push(entry)
    } else {
      console.warn(
        `Task permanently failed after ${this.maxRetries} retries: ${entry.data}`
      )
    }
  }
}

/*

// Example Usage
const taskQueue = new TaskQueue<string>(3)

taskQueue.enqueue('Task 1', 3000)
taskQueue.enqueue('Task 2', 2000)
taskQueue.enqueue('Task 3', 5000)
taskQueue.enqueue('Task 4', 1000) // Simulated shorter timeout

taskQueue.start()

setTimeout(() => {
  console.log('Queue Status:', taskQueue.getStatus())
  taskQueue.pause()

  setTimeout(() => {
    taskQueue.resume()
    console.log('Queue Resumed')
  }, 3000)
}, 4000)

setTimeout(() => {
  console.log('Final Queue Status:', taskQueue.getStatus())
}, 10000)
*/
