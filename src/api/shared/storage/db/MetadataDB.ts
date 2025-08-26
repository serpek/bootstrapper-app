import Dexie, { Table } from 'dexie'

import { Message } from '../models/Message'
import { FileMetadata } from '../types/FileMetadata'

export interface ThumbnailRecord {
  name: string // mediaId
  blob: Blob
}

export interface CacheRecord {
  key: string
  value: any
  expiresAt?: number
}

export class MetadataDB extends Dexie {
  public metadata!: Table<FileMetadata, string>
  public thumbnails!: Table<ThumbnailRecord, string>
  public messages!: Table<Message, string>
  public cache!: Table<CacheRecord, string>

  constructor() {
    super('MetadataDB')
    this.version(3).stores({
      metadata: '&name, size, type, lastModified',
      thumbnails: '&name',
      messages: '&id, sender, receiver, timestamp, type',
      cache: '&key, expiresAt'
    })
  }

  async clearAll(): Promise<void> {
    await this.transaction(
      'rw',
      this.metadata,
      this.thumbnails,
      this.messages,
      this.cache,
      async () => {
        await this.metadata.clear()
        await this.thumbnails.clear()
        await this.messages.clear()
        await this.cache.clear()
      }
    )
  }

  async deleteMessageWithMedia(id: string): Promise<void> {
    const msg = await this.messages.get(id)
    if (msg?.mediaPath) {
      await this.metadata.delete(msg.mediaPath)
      await this.thumbnails.delete(msg.mediaPath)
    }
    await this.messages.delete(id)
  }
}

export const metadataDB = new MetadataDB()
