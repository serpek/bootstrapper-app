export class AdvancedLoadBalancer {
  private services: string[] = []
  private index = 0

  addService(serviceName: string) {
    this.services.push(serviceName)
    console.log(`Service ${serviceName} added to LoadBalancer`)
  }

  removeService(serviceName: string) {
    this.services = this.services.filter((s) => s !== serviceName)
    console.log(`Service ${serviceName} removed from LoadBalancer`)
  }

  getNextService(): string | null {
    if (this.services.length === 0) return null

    const service = this.services[this.index]
    this.index = (this.index + 1) % this.services.length
    return service
  }

  listServices() {
    return this.services
  }
}
