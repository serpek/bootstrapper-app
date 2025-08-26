import 'reflect-metadata'

import { Subscription } from 'rxjs'

import { BusinessModule } from '@bipweb/business'
import { CommonModule } from '@bipweb/common'
import { DataModule } from '@bipweb/data'

import { ServiceContainer } from './serviceContainer'

export class Bootstrapper {
  worker: Worker
  private readonly container: ServiceContainer
  private subscription: Subscription
  private modules: { register: () => void }[]

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module'
    })
    this.container = new ServiceContainer()
    this.subscription = new Subscription()
    this.modules = [
      new CommonModule(this.container),
      new DataModule(this.container),
      new BusinessModule(this.container)
    ]
  }

  public async initialize(): Promise<ServiceContainer> {
    this.subscription = new Subscription()
    this.subscription.add(
      this.container.loading$.subscribe((loading) => {
        if (loading !== null)
          console.debug(loading ? 'Container Loading...' : 'Container Loaded.')
      })
    )
    this.subscription.add(
      this.container.ready$.subscribe((value) => {
        if (value !== null) console.debug('Container is Ready!')
      })
    )
    this.subscription.add(
      this.container.error$.subscribe((err) => {
        if (err) console.error('Container Error:', err)
      })
    )

    // await MigrationManager.applyInitialMigration()

    this.registerServices()
    await this.container.init()

    return this.container
  }

  public getContainer(): ServiceContainer {
    return this.container
  }

  public async cleanup(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe()
      this.subscription = new Subscription()
    }
    this.container.reset()
  }

  public async restart(): Promise<ServiceContainer> {
    await this.cleanup()
    return this.initialize()
  }

  private registerServices(): void {
    this.modules.forEach((module) => module.register())
  }
}
