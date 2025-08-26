import { ServiceContainer } from '@bipweb/core'

export class BusinessModule {
  private container: ServiceContainer

  constructor(container: ServiceContainer) {
    this.container = container
  }

  public register(): void {
    this.container.registerInstance('Bussiness', {})
  }
}
