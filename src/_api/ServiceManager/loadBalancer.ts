export class LoadBalancer {
  private services: string[] = []
  private index = 0

  registerService(serviceName: string) {
    this.services.push(serviceName)
  }

  deregisterService(serviceName: string) {
    this.services = this.services.filter((s) => s !== serviceName)
  }

  getNextService() {
    if (this.services.length === 0) return null

    const service = this.services[this.index]
    this.index = (this.index + 1) % this.services.length
    return service
  }
}
