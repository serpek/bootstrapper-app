import { container } from 'tsyringe'

import { LazyProxy } from './utils'

export class DynamicServiceLoader {
  private loadedServices = new Map<string, any>()

  loadService<T extends { init?: () => Promise<void> | void }>(
    serviceName: string
  ): T {
    if (this.loadedServices.has(serviceName)) {
      return this.loadedServices.get(serviceName)
    }

    const service = container.resolve<T>(serviceName)
    const lazyService = LazyProxy<T>(service)
    this.loadedServices.set(serviceName, lazyService)
    return lazyService
  }
}
