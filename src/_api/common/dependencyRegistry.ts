import { container } from 'tsyringe'

export class DependencyRegistry {
  private static services = new Map<string, any>()

  public static register<T>(token: string, service: new (...args: any[]) => T) {
    this.services.set(token, service)
    container.register(token, { useClass: service })
  }

  public static registerInstance<T>(token: string, instance: T) {
    this.services.set(token, instance)
    container.registerInstance(token, instance)
  }

  public static resolve<T>(token: string): T {
    return container.resolve<T>(token)
  }

  public static getAllServices(): string[] {
    return Array.from(this.services.keys())
  }
}
