import { BehaviorSubject, Observable } from 'rxjs'
import { container, type DependencyContainer, Lifecycle } from 'tsyringe'

import { ServiceContainerError } from './serviceContainerError'
import type { IServiceContainer, IServiceWrapper } from './types'
import { DependencyGraph } from './utils'

export class ServiceContainer implements IServiceContainer {
  private isInitialized = false
  private isLoading = false
  private dependencyGraph = new DependencyGraph()
  private configMap = new Map<string | symbol, any>()

  private loadingSubject = new BehaviorSubject<boolean | null>(null)
  public loading$: Observable<boolean | null> =
    this.loadingSubject.asObservable()

  private errorSubject = new BehaviorSubject<Error | null>(null)
  public error$: Observable<Error | null> = this.errorSubject.asObservable()

  private readySubject = new BehaviorSubject<boolean | null>(null)
  public ready$: Observable<boolean | null> = this.readySubject.asObservable()
  private resolvedServices = new Map<string | symbol, any>()

  constructor() {}

  registerFactory<T extends object>(
    serviceName: string,
    factory: (dependencyContainer: DependencyContainer) => T
  ) {
    this.configMap.set(serviceName, {})
    container.register(serviceName, {
      useFactory: factory
    })
  }

  registerInstance<T extends object>(serviceName: string, instance: T) {
    this.configMap.set(serviceName, {})
    container.register<T>(serviceName, { useValue: instance })
    const ctor = (instance as { constructor: new (...args: any[]) => any })
      .constructor

    const dependencies = Reflect.getMetadata('dependencies', ctor) || []
    dependencies.forEach((dep: string) =>
      this.dependencyGraph.addInitDependency(serviceName, dep)
    )
  }

  registerDependency<T>(
    serviceName: string | symbol,
    clazz: new (...args: any[]) => T,
    config?: Record<string, any>
  ) {
    this.configMap.set(serviceName, config || {})
    container.register<T>(
      serviceName,
      { useClass: clazz },
      { lifecycle: Lifecycle.Singleton }
    )

    const dependencies = Reflect.getMetadata('dependencies', clazz) || []
    dependencies.forEach((dep: string) =>
      this.dependencyGraph.addInitDependency(serviceName, dep)
    )
  }

  async init() {
    if (this.isLoading || this.isInitialized) return

    this.isLoading = true
    this.loadingSubject.next(true)

    try {
      const initOrder = this.dependencyGraph.getInitOrder()
      //console.groupCollapsed('init')
      //logService.info('service container init order:', initOrder)

      for (const serviceName of initOrder) {
        const config = this.configMap.get(serviceName)
        const instance = container.resolve<IServiceWrapper>(serviceName)

        if (instance?.configure) {
          instance.configure(config)
        }
        if (typeof instance.init === 'function') {
          await instance.init()
        }

        this.resolvedServices.set(serviceName, instance)
      }

      //console.groupEnd()
      this.isInitialized = true
      this.readySubject.next(true)
    } catch (error: any) {
      this.errorSubject.next(
        new ServiceContainerError(
          'Service container initialization failed ',
          error
        )
      )
    } finally {
      this.isLoading = false
      this.loadingSubject.next(false)
    }
  }

  get<T>(serviceName: string): T {
    if (!this.isInitialized) {
      throw new ServiceContainerError(
        `Service container not initialized. Cannot access ${serviceName}`
      )
    }

    if (!this.resolvedServices.has(serviceName)) {
      this.resolvedServices.set(serviceName, container.resolve<T>(serviceName))
    }

    return this.resolvedServices.get(serviceName) as T
  }

  /**
   * ServiceContainer'ı sıfırlar ve yeniden kullanılabilir hale getirir.
   */
  reset() {
    this.isInitialized = false
    this.isLoading = false
    this.dependencyGraph = new DependencyGraph()
    this.configMap.clear()
    this.loadingSubject.next(null)
    this.errorSubject.next(null)
    this.readySubject.next(null)
    container.reset()
  }
}
