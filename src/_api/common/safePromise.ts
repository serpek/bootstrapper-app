export class SafePromise<T> extends Promise<T> {
  constructor(
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: any) => void
    ) => void,
    timeout = 5000,
    timeoutMessage = 'Operation timed out'
  ) {
    super((resolve, reject) => {
      let timeoutId: number | null = null

      const resolveFn = (value: T | PromiseLike<T>) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        resolve(value)
      }

      const rejectFn = (reason?: any) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        reject(reason)
      }

      try {
        executor(resolveFn, rejectFn)
      } catch (error) {
        rejectFn(error)
      }

      if (timeout > 0) {
        timeoutId = window.setTimeout(() => {
          rejectFn(new Error(timeoutMessage))
        }, timeout)
      }
    })
  }

  static timeout<T>(
    promise: Promise<T>,
    timeout: number,
    timeoutMessage?: string
  ): Promise<T> {
    return new SafePromise<T>(
      (resolve, reject) => {
        promise.then(resolve).catch(reject)
      },
      timeout,
      timeoutMessage
    )
  }
}
