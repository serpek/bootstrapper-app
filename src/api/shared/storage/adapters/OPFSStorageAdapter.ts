import { metadataDB } from '../db/MetadataDB'
import { IStorageAdapter } from '../interfaces/IStorageAdapter'
import { FileMetadata } from '../types/FileMetadata'
import { FileSystemError } from '../utils/ErrorHandler'

export class OPFSStorageAdapter implements IStorageAdapter {
  private root: FileSystemDirectoryHandle | null = null
  private MAX_FILE_SIZE = 100 * 1024 * 1024

  async init(): Promise<void> {
    this.root = await navigator.storage.getDirectory()
  }

  async writeFile(path: string, blob: Blob): Promise<void> {
    if (blob.size > this.MAX_FILE_SIZE) {
      throw new FileSystemError(
        'LIMIT_EXCEEDED',
        'File size exceeds 100MB limit'
      )
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

    if (blob.type.startsWith('image/') || blob.type.startsWith('video/')) {
      const thumbnail = await this.generateThumbnail(path)
      metadata.previewable = true
      metadata.thumbnailAvailable = !!thumbnail
      if (thumbnail) {
        await metadataDB.thumbnails.put({ name: path, blob: thumbnail })
      }
      if (blob.type.startsWith('video/')) {
        metadata.duration = (await this.extractVideoDuration(blob)) ?? undefined
      }
    }

    await metadataDB.metadata.put(metadata)
  }

  async readFile(path: string): Promise<Blob> {
    const handle = await this.getHandle(path)
    return await handle.getFile()
  }

  async deleteFile(path: string): Promise<void> {
    await this.root?.removeEntry(path)
    await metadataDB.metadata.delete(path)
    await metadataDB.thumbnails.delete(path)
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const blob = await this.readFile(oldPath)
    await this.writeFile(newPath, blob)

    const oldMetadata = await metadataDB.metadata.get(oldPath)
    if (oldMetadata) {
      await metadataDB.metadata.put({ ...oldMetadata, name: newPath })
    }

    const thumbnailEntry = await metadataDB.thumbnails.get(oldPath)
    if (thumbnailEntry) {
      await metadataDB.thumbnails.put({
        name: newPath,
        blob: thumbnailEntry.blob
      })
    }

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
    return await metadataDB.metadata.toArray()
  }

  async setCustomMetadata(
    path: string,
    metadata: Record<string, any>
  ): Promise<void> {
    const existing = await metadataDB.metadata.get(path)
    if (existing) {
      await metadataDB.metadata.put({ ...existing, customMetadata: metadata })
    }
  }

  async getCustomMetadata(path: string): Promise<Record<string, any> | null> {
    const meta = await metadataDB.metadata.get(path)
    return meta?.customMetadata ?? null
  }

  async getFileMetadata(path: string): Promise<FileMetadata> {
    const meta = await metadataDB.metadata.get(path)
    if (!meta) throw new FileSystemError('NOT_FOUND', 'File metadata not found')
    return meta
  }

  async generateThumbnail(path: string): Promise<Blob | null> {
    const blob = await this.readFile(path)
    const url = URL.createObjectURL(blob)

    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = url

    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
    })

    const width = image.width
    const height = image.height

    const scale = Math.min(64 / width, 64 / height)
    const w = width * scale
    const h = height * scale

    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(image, 0, 0, w, h)
    return await canvas.convertToBlob()
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
      video.onloadedmetadata = () => {
        resolve(video.duration)
      }
      video.onerror = () => resolve(null)
    })
  }
}
