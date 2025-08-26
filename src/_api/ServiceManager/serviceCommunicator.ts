import { EventBusService } from './eventBusService'

export class ServiceCommunicator {
  constructor(private eventBus: EventBusService) {}

  sendMessage(toService: string, payload: any) {
    this.eventBus.emit(`message_to_${toService}`, payload)
  }

  listenForMessages(serviceName: string, callback: (payload: any) => void) {
    this.eventBus.on(`message_to_${serviceName}`, callback)
  }
}
