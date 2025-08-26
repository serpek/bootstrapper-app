import { EventBusService } from './eventBusService'

export class MicroserviceManager {
  private services: Map<string, any> = new Map()

  constructor(private eventBus: EventBusService) {}

  registerService(name: string, service: any) {
    this.services.set(name, service)
    console.log(`Microservice ${name} registered.`)
  }

  startService(name: string) {
    const service = this.services.get(name)
    if (service && typeof service.start === 'function') {
      service.start()
      this.eventBus.emit('service_started', { service: name })
      console.log(`Microservice ${name} started.`)
    }
  }

  stopService(name: string) {
    const service = this.services.get(name)
    if (service && typeof service.stop === 'function') {
      service.stop()
      this.eventBus.emit('service_stopped', { service: name })
      console.log(`Microservice ${name} stopped.`)
    }
  }
}
