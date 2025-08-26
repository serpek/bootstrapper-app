import {
  DefaultStorageAdapterConfig,
  StorageAdapterConfig
} from '../config/StorageConfig'
import { metadataDB } from '../db/MetadataDB'
import { IStorageAdapter } from '../interfaces/IStorageAdapter'
import { FileMetadata } from '../types/FileMetadata'
import { FileSystemError } from '../utils/ErrorHandler'
import { MemoryCache } from '../utils/MemoryCache'
import { WorkerProxy } from '../utils/WorkerProxy'

export class ConfigurableOPFSStorageAdapter implements IStorageAdapter {
  private workerProxy?: WorkerProxy
  private root: FileSystemDirectoryHandle | null = null
  private config: StorageAdapterConfig
  private blobCache: MemoryCache<Blob>
  private metaCache: MemoryCache<FileMetadata>

  constructor(config?: StorageAdapterConfig) {
    this.config = { ...DefaultStorageAdapterConfig, ...config }
    this.blobCache = new MemoryCache()
    this.metaCache = new MemoryCache()
    if (this.config.useWorker) {
      this.workerProxy = new WorkerProxy(
        new URL('../workers/opfs.worker', import.meta.url)
      )
    }
  }

  async init(): Promise<void> {
    this.root = await navigator.storage.getDirectory()
  }

  async writeFile(path: string, blob: Blob): Promise<void> {
    if (this.workerProxy) {
      await this.workerProxy.call('writeFile', { path, data: { blob } })
      return
    }

    if (blob.size > this.config.maxFileSize!) {
      throw new FileSystemError('LIMIT_EXCEEDED', 'File size exceeds limit')
    }

    const handle = await this.getHandle(path, true)
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()

    const metadata: FileMetadata = {
      name: path,
      size: blob.size,
      type: blob.type,
      lastModified: Date.now(),
      previewable: false,
      thumbnailAvailable: false
    }

    // metadata işlemleri
    if (blob.type.startsWith('image/') || blob.type.startsWith('video/')) {
      metadata.previewable = true
      const thumbnail = await this.generateThumbnail(path)
      metadata.thumbnailAvailable = !!thumbnail
      if (thumbnail)
        await metadataDB.thumbnails.put({ name: path, blob: thumbnail })

      if (blob.type.startsWith('video/')) {
        metadata.duration = (await this.extractVideoDuration(blob)) ?? undefined
      }
    }

    await metadataDB.metadata.put(metadata)

    if (this.config.enableCache) {
      this.metaCache.set(path, metadata)
      this.blobCache.set(path, blob)
    }
  }

  async readFile(path: string): Promise<Blob> {
    if (this.workerProxy) {
      return await this.workerProxy.call<Blob>('readFile', { path })
    }

    if (this.config.enableCache) {
      const cached = this.blobCache.get(path)
      if (cached) return cached
    }

    const handle = await this.getHandle(path)
    const file = await handle.getFile()

    if (this.config.enableCache) this.blobCache.set(path, file)
    return file
  }

  async deleteFile(path: string): Promise<void> {
    if (this.workerProxy) {
      await this.workerProxy.call('deleteFile', { path })
      return
    }
    await this.root?.removeEntry(path)
    await metadataDB.metadata.delete(path)
    await metadataDB.thumbnails.delete(path)

    if (this.config.enableCache) {
      this.metaCache.delete(path)
      this.blobCache.delete(path)
    }
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const blob = await this.readFile(oldPath)
    await this.writeFile(newPath, blob)
    await this.deleteFile(oldPath)
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await this.getHandle(path)
      return true
    } catch {
      return false
    }
  }

  async listFiles(): Promise<FileMetadata[]> {
    if (this.config.enableCache) {
      return [...this.metaCache['cache'].values()]
    }
    return await metadataDB.metadata.toArray()
  }

  async setCustomMetadata(
    path: string,
    metadata: Record<string, any>
  ): Promise<void> {
    const existing = await this.getFileMetadata(path)
    const updated = { ...existing, customMetadata: metadata }
    await metadataDB.metadata.put(updated)
    if (this.config.enableCache) this.metaCache.set(path, updated)
  }

  async getCustomMetadata(path: string): Promise<Record<string, any> | null> {
    const meta = await this.getFileMetadata(path)
    return meta.customMetadata ?? null
  }

  async getFileMetadata(path: string): Promise<FileMetadata> {
    if (this.config.enableCache) {
      const cached = this.metaCache.get(path)
      if (cached) return cached
    }
    const meta = await metadataDB.metadata.get(path)
    if (!meta) throw new FileSystemError('NOT_FOUND', 'File metadata not found')
    if (this.config.enableCache) this.metaCache.set(path, meta)
    return meta
  }

  async generateThumbnail(path: string): Promise<Blob | null> {
    const blob = await this.readFile(path)
    if (!blob.type.startsWith('image/') && !blob.type.startsWith('video/'))
      return null

    return new Promise((resolve) => {
      const media = document.createElement(
        blob.type.startsWith('image/') ? 'img' : 'video'
      )
      media.src = URL.createObjectURL(blob)
      media.crossOrigin = 'anonymous'
      media.onloadeddata = async () => {
        const canvas = new OffscreenCanvas(64, 64)
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(media, 0, 0, 64, 64)
        const thumbnail = await canvas.convertToBlob()
        resolve(thumbnail)
      }
      media.onerror = () => resolve(null)
    })
  }

  async getThumbnail(path: string): Promise<Blob | null> {
    const entry = await metadataDB.thumbnails.get(path)
    return entry?.blob ?? null
  }

  private async getHandle(
    path: string,
    create = false
  ): Promise<FileSystemFileHandle> {
    if (!this.root)
      throw new FileSystemError('NOT_INITIALIZED', 'Storage not initialized')
    return await this.root.getFileHandle(path, { create })
  }

  private extractVideoDuration(blob: Blob): Promise<number | null> {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.src = URL.createObjectURL(blob)
      video.onloadedmetadata = () => resolve(video.duration)
      video.onerror = () => resolve(null)
    })
  }
}
