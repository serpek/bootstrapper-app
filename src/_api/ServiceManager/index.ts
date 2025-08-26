import { BehaviorSubject, Observable } from 'rxjs'
import { container, injectable, Lifecycle } from 'tsyringe'

import 'reflect-metadata'

import { ConfigServiceImpl } from '../Config'
import { LogServiceImpl } from '../Logger'

import { AdvancedLoadBalancer } from './advancedLoadBalancer'
import { APIGateway } from './APIGateway'
import { AuthService } from './authService'
import { CacheService } from './cacheService'
import { DatabaseService } from './databaseService'
import { DependencyGraph } from './dependencyGraph'
import { EventBusService } from './eventBusService'
import { HealthCheckService } from './healthCheckService'
import { LazyCacheService } from './lazyCacheService'
import { LoadBalancer } from './loadBalancer'
import { MicroserviceManager } from './microserviceManager'
import { NotificationService } from './notificationService'
import { ServiceCommunicator } from './serviceCommunicator'
import { ServiceDiscovery } from './serviceDiscovery'
import { ServiceScaler } from './serviceScaler'
import { UserService } from './userService'

export class APIError extends Error {
  constructor(
    message: string,
    public context?: any
  ) {
    super(message)
    this.name = 'APIError'
  }
}

@injectable()
export class API {
  private isInitialized = false
  private isLoading = false
  private dependencyGraph = new DependencyGraph()
  private configMap = new Map<string, any>()

  private loadingSubject = new BehaviorSubject<boolean>(false)
  public loading$: Observable<boolean> = this.loadingSubject.asObservable()

  private errorSubject = new BehaviorSubject<Error | null>(null)
  public error$: Observable<Error | null> = this.errorSubject.asObservable()

  private readySubject = new BehaviorSubject<boolean>(false)
  public ready$: Observable<boolean> = this.readySubject.asObservable()

  constructor() {}

  registerDependency<T>(
    serviceName: string,
    clazz: new (...args: any[]) => T,
    config?: Record<string, any>
  ) {
    this.configMap.set(serviceName, config || {})
    container.register<T>(
      serviceName,
      { useClass: clazz },
      { lifecycle: Lifecycle.Singleton }
    )

    // @dependsOn decorator'ını oku
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

      for (const serviceName of initOrder) {
        const config = this.configMap.get(serviceName)
        const instance = container.resolve<any>(serviceName)

        if (instance?.configure) {
          instance.configure(config)
        }

        if (typeof instance.init === 'function') {
          await instance.init()
        }
      }

      this.isInitialized = true
      this.readySubject.next(true)
    } catch (error: any) {
      this.errorSubject.next(
        new APIError('API initialization failed', { error })
      )
    } finally {
      this.isLoading = false
      this.loadingSubject.next(false)
    }
  }

  get<T>(serviceName: string): T {
    if (!this.isInitialized) {
      throw new APIError(`API not initialized. Cannot access ${serviceName}`)
    }

    return container.resolve<T>(serviceName)
  }
}

export async function main() {
  const api = new API()

  api.registerDependency('ConfigServiceImpl', ConfigServiceImpl, {
    env: 'production',
    ttl: 5000
  })
  api.registerDependency('CacheService', CacheService)
  api.registerDependency('LogServiceImpl', LogServiceImpl<any>)
  api.registerDependency('DatabaseService', DatabaseService)
  api.registerDependency('AuthService', AuthService)
  api.registerDependency('UserService', UserService)
  api.registerDependency('EventBusService', EventBusService)
  api.registerDependency('NotificationService', NotificationService)
  api.registerDependency('LazyCacheService', LazyCacheService)

  api.loading$.subscribe((loading) =>
    console.log(loading ? 'API Loading...' : 'API Loaded.')
  )
  api.ready$.subscribe(() => console.log('API is Ready!'))
  api.error$.subscribe((err) => console.error('API Error:', err?.message))

  // API'yi başlatıyoruz (init gerektiren tüm bağımlılıkları başlatır)
  await api.init()

  // Artık tüm bağımlılıklar hazır
  const db = api.get<DatabaseService>('DatabaseService')
  const logger = api.get<LogServiceImpl<any>>('LogServiceImpl')
  const cache = api.get<CacheService>('CacheService')
  const config = api.get<ConfigServiceImpl>('ConfigServiceImpl')
  const eventBus = api.get<EventBusService>('EventBusService')

  const lazy_cache = api.get<LazyCacheService>('LazyCacheService')

  const auth = api.get<AuthService>('AuthService')
  const notification = api.get<NotificationService>('NotificationService')

  if (auth.login('admin', '1234')) {
    notification.sendNotification('user_registered', {
      email: 'user@example.com'
    })
  }
  // İlk çağrıda init gerçekleşir
  await lazy_cache.set('key1', 'value1') // ⏰ init() burada çağrılır
  const value = await lazy_cache.get('key1')
  console.log('Cache Value:', value) // Output: "Cache Value: value1"

  const apiGateway = new APIGateway(eventBus)
  apiGateway.handleRequest('NotificationService', 'sendEmail', {
    email: 'user@example.com'
  })

  // Service Discovery
  const serviceDiscovery = new ServiceDiscovery(eventBus)

  // Microservice Manager
  const microserviceManager = new MicroserviceManager(eventBus)

  // Load Balancer
  const loadBalancer = new LoadBalancer()

  // Service Scaler
  const serviceScaler = new ServiceScaler(microserviceManager)

  // Register and Scale Notification Service
  serviceScaler.scaleUp('NotificationService', 3)

  // API Gateway üzerinden çağrı yap
  for (let i = 0; i < 5; i++) {
    const service = loadBalancer.getNextService()
    if (service) {
      apiGateway.handleRequest(service, 'sendEmail', {
        email: `user${i}@example.com`
      })
    }
  }

  // List Active Services
  console.log('Active Services:', serviceDiscovery.listServices())

  console.log(db.query('SELECT * FROM users'))
  logger.info('This is a log message')
  console.log(cache.get('user123'))
  console.log(config.data.appName)

  const communicator = new ServiceCommunicator(eventBus)
  communicator.listenForMessages('NotificationService', (payload) => {
    console.log('NotificationService received:', payload)
  })
  communicator.sendMessage('NotificationService', {
    text: 'Hello from AuthService'
  })

  const advancedLoadBalancer = new AdvancedLoadBalancer()
  const healthChecker = new HealthCheckService()
  // Simulate Services
  healthChecker.registerService('AuthService')
  healthChecker.registerService('NotificationService')
  advancedLoadBalancer.addService('AuthService')
  advancedLoadBalancer.addService('NotificationService')

  // Send a message
  communicator.sendMessage('NotificationService', { text: 'User Registered!' })

  // List active services
  console.log('LoadBalancer Services:', advancedLoadBalancer.listServices())
  console.log('Health Status:', healthChecker.getAllStatuses())
}

// main().catch((err) => console.error(err))
