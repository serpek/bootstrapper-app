import { injectable } from 'tsyringe'

@injectable()
export class HealthCheckService {
  private status: Map<string, boolean> = new Map()

  registerService(serviceName: string) {
    this.status.set(serviceName, true)
    console.log(`${serviceName} is healthy`)
  }

  markServiceUnhealthy(serviceName: string) {
    this.status.set(serviceName, false)
    console.warn(`${serviceName} is unhealthy`)
  }

  isServiceHealthy(serviceName: string): boolean {
    return this.status.get(serviceName) ?? false
  }

  getAllStatuses() {
    return Array.from(this.status.entries()).map(([service, healthy]) => ({
      service,
      healthy
    }))
  }
}
