import { Type } from 'arktype'
import { singleton } from 'tsyringe'

import 'reflect-metadata'

import { CryptoUtils, type IService } from '../common'

import { AlaSqlDB } from './alaSqlDB'
import { IndexedDB } from './indexedDB'

@singleton()
export class DatabaseSyncFactory<T extends { id: string }> implements IService {
  private indexedDb: IndexedDB
  // private memoryDb: MemoryDB<T>
  private alaDb: AlaSqlDB<T>
  private readonly schema: Type<T>

  constructor(dbName: string, schema: Type<T>) {
    this.indexedDb = new IndexedDB(`${dbName}_indexed`)
    // this.memoryDb = new MemoryDB<T>(`${dbName}_memory`)
    this.alaDb = new AlaSqlDB<T>(dbName)
    this.schema = schema
  }

  public async init() {
    console.log(
      `📌 DatabaseSyncFactory (${this.indexedDb.name}) başlatılıyor...`
    )

    const encryptedItems = await this.indexedDb.items.toArray()
    const decryptedItems = await Promise.all(
      encryptedItems.map(async (item) => ({
        ...(await CryptoUtils.decrypt<T>(item.data))
      }))
    )

    for (const item of decryptedItems) {
      await this.alaDb.put(item)
    }

    // await this.memoryDb.items.bulkPut(decryptedItems)

    console.log(
      `✅ ${this.indexedDb.name} başlatıldı! (Veriler IndexedDB'den alındı)`
    )
  }

  public async addItem(item: T) {
    this.validate(item)

    console.log(`➕ Kayıt ekleniyor: ${JSON.stringify(item)}`)

    await this.alaDb.put(item)
    // await this.memoryDb.items.put(item)

    const encryptedData = await CryptoUtils.encrypt<T>(item)
    await this.indexedDb.items.put({ id: item.id, data: encryptedData })

    console.log('✅ Kayıt eklendi!')
  }

  public async updateItem(item: T) {
    this.validate(item)

    console.log(`📝 Kayıt güncelleniyor: ${JSON.stringify(item)}`)

    await this.alaDb.put(item)
    // await this.memoryDb.items.put(item)

    const encryptedData = await CryptoUtils.encrypt<T>(item)
    await this.indexedDb.items.put({ id: item.id, data: encryptedData })

    console.log('✅ Kayıt güncellendi!')
  }

  public async deleteItem(id: string) {
    console.log(`🗑️ Kayıt siliniyor: ${id}`)

    await this.alaDb.delete(id)

    // await this.memoryDb.items.delete(id)

    await this.indexedDb.items.delete(id)

    console.log('✅ Kayıt silindi!')
  }

  public async getAllItems(): Promise<T[]> {
    // return await this.memoryDb.items.toArray()
    return await this.alaDb.getAll()
  }

  private validate(item: T) {
    // @ts-ignore
    const result = this.schema(item)
    if (!result) {
      throw new Error(`❌ Geçersiz veri: ${JSON.stringify(item)}`)
    }
  }
}

@singleton()
export class CacheManager implements IService {
  constructor() {}

  public async init() {
    console.log('📌 CacheManager başlatılıyor...')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    console.log('✅ CacheManager başlatıldı!')
  }
}

@singleton()
export class NotificationService implements IService {
  constructor() {}

  public async init() {
    console.log('📌 NotificationService başlatılıyor...')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    console.log('✅ NotificationService başlatıldı!')
  }
}
