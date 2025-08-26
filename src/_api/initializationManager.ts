import { container, injectable } from 'tsyringe'

import { DependencyRegistry } from './'

@injectable()
export class InitializationManager {
  private services: any[]

  constructor() {
    this.services = DependencyRegistry.getAllServices()
      .map((service) => container.resolve<any>(service))
      .filter((instance) => typeof instance.init === 'function')
  }

  public async initializeAll() {
    console.log('🔄 Tüm servisler başlatılıyor...')

    await Promise.all(this.services.map((service) => service.init()))

    console.log('✅ Tüm servisler başlatıldı!')
  }
}
