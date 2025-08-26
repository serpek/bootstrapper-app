import { injectable } from 'tsyringe'

import { metadataDB } from '../db/MetadataDB'
import { FileSystemError } from '../utils/ErrorHandler'

@injectable()
export class MediaFileManager {
  private root: FileSystemDirectoryHandle | null = null

  async init(): Promise<void> {
    this.root = await navigator.storage.getDirectory()
  }

  async writeMedia(id: string, blob: Blob): Promise<void> {
    const handle = await this.getHandle(id, true)
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()

    const thumbnail = await this.generateThumbnail(blob)
    if (thumbnail) {
      await metadataDB.thumbnails.put({ name: id, blob: thumbnail })
    }
  }

  async readMedia(id: string): Promise<Blob> {
    const handle = await this.getHandle(id)
    return await handle.getFile()
  }

  async deleteMedia(id: string): Promise<void> {
    if (!this.root) return
    try {
      await this.root.removeEntry(id)
    } catch (_) {
      // ignore
    }
    await metadataDB.thumbnails.delete(id)
  }

  async getThumbnail(id: string): Promise<Blob | null> {
    const entry = await metadataDB.thumbnails.get(id)
    return entry?.blob ?? null
  }

  async clearCache(): Promise<void> {
    await metadataDB.thumbnails.clear()
  }

  async listMediaIds(): Promise<string[]> {
    if (!this.root)
      throw new FileSystemError('NOT_INITIALIZED', 'OPFS not initialized')
    const ids: string[] = []
    // @ts-ignore
    for await (const entry of this.root.values()) {
      if (entry.kind === 'file') {
        ids.push(entry.name)
      }
    }
    return ids
  }

  private async getHandle(
    id: string,
    create = false
  ): Promise<FileSystemFileHandle> {
    if (!this.root)
      throw new FileSystemError('NOT_INITIALIZED', 'OPFS not initialized')
    return await this.root.getFileHandle(id, { create })
  }

  private generateThumbnail(blob: Blob): Promise<Blob | null> {
    return new Promise((resolve) => {
      const media = document.createElement(
        blob.type.startsWith('image/') ? 'img' : 'video'
      )
      media.src = URL.createObjectURL(blob)
      media.crossOrigin = 'anonymous'

      const onLoaded = () => {
        const canvas = new OffscreenCanvas(64, 64)
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(media as any, 0, 0, 64, 64)
        canvas
          .convertToBlob()
          .then(resolve)
          .catch(() => resolve(null))
      }

      media.addEventListener(
        blob.type.startsWith('image/') ? 'load' : 'loadeddata',
        onLoaded
      )
      media.onerror = () => resolve(null)
    })
  }
}
