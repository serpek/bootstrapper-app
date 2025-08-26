import { inject, injectable } from 'tsyringe'

import { TYPES } from './di-container'
import type { ICacheService, IFileSystemConfig } from './interfaces'

@injectable()
export class CacheService implements ICacheService {
  private readonly cache: Map<
    string,
    { data: any; timestamp: number; size: number }
  >
  private readonly maxSize: number
  private currentSize: number

  constructor(@inject(TYPES.FileSystemConfig) config: IFileSystemConfig) {
    this.maxSize = config.cacheSize * 1024 * 1024
    this.currentSize = 0
    this.cache = new Map()
  }

  async get<T>(
    key: string,
    supplier?: () => Promise<T>
  ): Promise<T | undefined> {
    const item = this.cache.get(key)

    if (item) {
      // LRU stratejisi için timestamp güncelle
      item.timestamp = Date.now()
      return item.data
    }

    if (supplier) {
      const data = await supplier()
      this.set(key, data)
      return data
    }

    return undefined
  }

  set(key: string, data: any, size?: number): void {
    const itemSize = size || this.estimateSize(data)

    // Yer aç
    this.makeSpaceFor(itemSize)

    if (this.currentSize + itemSize <= this.maxSize) {
      this.cache.set(key, {
        data,
        timestamp: Date.now(),
        size: itemSize
      })
      this.currentSize += itemSize
    }
  }

  delete(key: string): void {
    const item = this.cache.get(key)
    if (item) {
      this.currentSize -= item.size
      this.cache.delete(key)
    }
  }

  clear(): void {
    this.cache.clear()
    this.currentSize = 0
  }

  getCurrentSize(): number {
    return this.currentSize
  }

  getMaxSize(): number {
    return this.maxSize
  }

  getItemCount(): number {
    return this.cache.size
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  private makeSpaceFor(requiredSpace: number): void {
    while (
      this.currentSize + requiredSpace > this.maxSize &&
      this.cache.size > 0
    ) {
      let oldestKey: string | null = null
      let oldestTimestamp = Infinity

      for (const [key, item] of this.cache) {
        if (item.timestamp < oldestTimestamp) {
          oldestKey = key
          oldestTimestamp = item.timestamp
        }
      }

      if (oldestKey) {
        this.currentSize -= this.cache.get(oldestKey)!.size
        this.cache.delete(oldestKey)
      }
    }
  }

  private estimateSize(data: any): number {
    if (data instanceof Blob) return data.size
    if (typeof data === 'string') return data.length * 2 // UTF-16 tahmini
    if (typeof data === 'object') return JSON.stringify(data).length * 2
    return 100 // Varsayılan küçük boyut
  }
}
