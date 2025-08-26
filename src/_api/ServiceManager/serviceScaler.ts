import { MicroserviceManager } from './microserviceManager'

export class ServiceScaler {
  constructor(private microserviceManager: MicroserviceManager) {}

  scaleUp(serviceName: string, count: number) {
    for (let i = 0; i < count; i++) {
      const scaledServiceName = `${serviceName}_instance_${i}`
      const service = {
        start: () => console.log(`${scaledServiceName} started`),
        stop: () => console.log(`${scaledServiceName} stopped`)
      }
      this.microserviceManager.registerService(scaledServiceName, service)
      this.microserviceManager.startService(scaledServiceName)
    }
  }

  scaleDown(serviceName: string, count: number) {
    for (let i = 0; i < count; i++) {
      const scaledServiceName = `${serviceName}_instance_${i}`
      this.microserviceManager.stopService(scaledServiceName)
    }
  }
}
