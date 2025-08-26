import { inject, injectable } from 'tsyringe'

import { CircuitBreaker } from './circuitBreaker'
import { EventBusService } from './eventBusService'
import { IService } from './IService'
import { dependsOn, retry } from './utils'

@injectable()
@dependsOn('EventBusService')
export class NotificationService implements IService {
  private circuitBreaker = new CircuitBreaker(3, 2, 5000) // 3 hata sonrası açılır

  constructor(@inject('EventBusService') private eventBus: EventBusService) {}

  async init() {
    console.log('NotificationService initialized')
    this.eventBus.on('user_registered', (payload) => {
      console.log(`Sending welcome email to ${payload.email}`)
    })
  }

  async sendNotification(eventType: string, payload: any) {
    this.eventBus.emit(eventType, payload)

    try {
      await this.circuitBreaker.call(() =>
        retry(() => this.simulateSend(payload), 3, 1000)
      )
      this.eventBus.emit(eventType, payload)
      console.log(`Notification sent to ${payload.email}`)
    } catch (error) {
      console.error('Failed to send notification:', error)
    }
  }

  // Simüle edilmiş API çağrısı
  private async simulateSend(payload: any) {
    if (Math.random() > 0.7) {
      throw new Error('Random failure')
    }
    return `Email sent to ${payload.email}`
  }
}
