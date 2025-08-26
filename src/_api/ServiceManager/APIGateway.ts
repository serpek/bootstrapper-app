import { EventBusService } from './eventBusService'

export class APIGateway {
  constructor(private eventBus: EventBusService) {}

  handleRequest(serviceName: string, endpoint: string, payload: any) {
    console.log(`API Gateway forwarding request to ${serviceName}:${endpoint}`)
    this.eventBus.emit(`${serviceName}:${endpoint}`, payload)
  }
}
