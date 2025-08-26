export class WorkerProxy {
  private worker: Worker

  constructor(workerPath: string | URL) {
    this.worker = new Worker(workerPath, { type: 'module' })
  }

  call<T = any>(action: string, data: Record<string, any> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      // const id = crypto.randomUUID()

      const onMessage = (event: MessageEvent) => {
        const { status, result, error } = event.data
        this.worker.removeEventListener('message', onMessage)

        if (status === 'success') resolve(result)
        else reject(new Error(error))
      }

      this.worker.addEventListener('message', onMessage)
      this.worker.postMessage({ action, ...data })
    })
  }
}
