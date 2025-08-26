import { EventBusService } from './eventBusService'

export class ServiceDiscovery {
  private activeServices: Set<string> = new Set()

  constructor(private eventBus: EventBusService) {
    this.eventBus.on('service_started', ({ service }) =>
      this.registerService(service)
    )
    this.eventBus.on('service_stopped', ({ service }) =>
      this.deregisterService(service)
    )
  }

  registerService(serviceName: string) {
    this.activeServices.add(serviceName)
    console.log(`Service ${serviceName} registered.`)
  }

  deregisterService(serviceName: string) {
    this.activeServices.delete(serviceName)
    console.log(`Service ${serviceName} deregistered.`)
  }

  listServices() {
    return Array.from(this.activeServices)
  }
}
