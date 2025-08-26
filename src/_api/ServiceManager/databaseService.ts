import { inject, injectable } from 'tsyringe'

import { CacheService } from './cacheService'
import { IService } from './IService'
import { dependsOn } from './utils'

@injectable()
@dependsOn('CacheService')
export class DatabaseService implements IService {
  private isConnected = false

  constructor(@inject('CacheService') private cacheService: CacheService) {}

  async init() {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    this.isConnected = true
    console.log('Database connected')
  }

  query(sql: string) {
    if (!this.isConnected) throw new Error('DatabaseService not initialized')
    this.cacheService.set('lastQuery', sql)
    return `Executing: ${sql}`
  }
}
