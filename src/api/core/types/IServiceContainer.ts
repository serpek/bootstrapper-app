import type { DependencyContainer } from 'tsyringe'

export interface IServiceContainer {
  registerFactory<T extends object>(
    serviceName: string,
    factory: (dependencyContainer: DependencyContainer) => T
  ): void

  registerInstance<T extends object>(serviceName: string, instance: T): void

  registerDependency<T>(
    serviceName: string | symbol,
    clazz: new (...args: any[]) => T,
    config?: Record<string, any>
  ): void

  init(): Promise<void>

  get<T>(serviceName: string): T

  reset(): void
}
