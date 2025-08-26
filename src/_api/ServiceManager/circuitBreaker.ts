type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export class CircuitBreaker {
  private state: State = 'CLOSED'
  private failureCount = 0
  private successCount = 0
  private nextAttempt = Date.now()

  constructor(
    private failureThreshold: number = 3,
    private successThreshold: number = 2,
    private timeout: number = 5000 // 5 saniye
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() > this.nextAttempt) {
        this.state = 'HALF_OPEN'
      } else {
        throw new Error('Circuit Breaker is OPEN')
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED'
        this.successCount = 0
        console.log('Circuit closed again')
      }
    } else {
      this.failureCount = 0
    }
  }

  private onFailure() {
    this.failureCount++
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN'
      this.nextAttempt = Date.now() + this.timeout
      console.warn('Circuit opened due to failures')
    }
  }
}
