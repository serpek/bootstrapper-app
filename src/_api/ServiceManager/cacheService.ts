import { inject, injectable } from 'tsyringe'

import { ConfigServiceImpl } from '../Config'

import { dependsOn } from './utils'

export interface CacheOptions {
  ttl?: number // milisaniye cinsinden
  persist?: boolean // Kalıcı cache kullanımı
}

type CacheItem = {
  value: any
  expiry: number | null
}

@injectable()
@dependsOn('ConfigServiceImpl')
export class CacheService {
  private cache = new Map<string, CacheItem>()

  constructor(
    @inject('ConfigServiceImpl') private configService: ConfigServiceImpl
  ) {}

  async init() {
    console.log(
      'CacheService initialized with TTL:',
      this.configService.data.ttl
    )
  }

  set(key: string, value: any, options?: CacheOptions) {
    const expiry = options?.ttl ? Date.now() + options.ttl : null
    this.cache.set(key, { value, expiry })
  }

  get(key: string) {
    const item = this.cache.get(key)
    if (!item) return null

    if (item.expiry && Date.now() > item.expiry) {
      this.cache.delete(key)
      return null
    }
    return item.value
  }

  delete(key: string) {
    this.cache.delete(key)
  }

  invalidate() {
    this.cache.clear()
  }
}
