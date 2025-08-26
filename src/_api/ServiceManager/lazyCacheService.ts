import { inject, injectable } from 'tsyringe'

import { ConfigServiceImpl } from '../Config'

import { IService } from './IService'
import { dependsOn } from './utils'

@injectable()
@dependsOn('ConfigServiceImpl')
export class LazyCacheService implements IService {
  private initialized = false
  private cache = new Map<string, any>()

  constructor(
    @inject('ConfigServiceImpl') private configService: ConfigServiceImpl
  ) {}

  async init() {
    if (!this.initialized) {
      console.log('LazyCacheService is initializing...')
      await new Promise((resolve) => setTimeout(resolve, 500)) // Simülasyon
      this.initialized = true
      console.log(
        'LazyCacheService initialized with TTL:',
        this.configService.data.ttl
      )
    }
  }

  async get(key: string) {
    if (!this.initialized) {
      await this.init()
    }
    return this.cache.get(key)
  }

  async set(key: string, value: any) {
    if (!this.initialized) {
      await this.init()
    }
    this.cache.set(key, value)
  }
}
