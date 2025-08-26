import { container } from 'tsyringe'

/**
 * Bağımlılıkları güvenli bir şekilde çözümlemek için merkezi bir yapı sağlar.
 * Servis kayıtlarını ve çözümlemeleri yönetir.
 * example:
 * DependencyResolver.register('MyService', MyServiceClass);
 * const myService = DependencyResolver.resolve<MyService>('MyService');
 */
export class DependencyResolver {
  static resolve<T>(serviceName: string): T {
    try {
      return container.resolve<T>(serviceName)
    } catch (error) {
      console.error(`Dependency resolution failed for ${serviceName}:`, error)
      throw error
    }
  }

  static register<T>(serviceName: string, service: new (...args: any[]) => T) {
    container.register(serviceName, { useClass: service })
  }
}
