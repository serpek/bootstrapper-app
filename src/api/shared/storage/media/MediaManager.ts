import { OPFSStorageAdapter } from '../adapters/OPFSStorageAdapter'

import { MediaMetadata } from './types'

export class MediaManager {
  constructor(private storage: OPFSStorageAdapter) {}

  async saveMedia(file: File): Promise<MediaMetadata> {
    const id = crypto.randomUUID()
    const path = `media/${id}`
    await this.storage.writeFile(path, file)

    const metadata: MediaMetadata = {
      id,
      name: file.name,
      type: file.type,
      size: file.size,
      path,
      createdAt: Date.now()
    }

    if (file.type.startsWith('image/')) {
      const thumbnail = await this.storage.generateThumbnail(path)
      if (thumbnail) {
        const thumbPath = `media/thumbnails/${id}`
        await this.storage.writeFile(thumbPath, thumbnail)
        metadata.thumbnailPath = thumbPath
      }
    }

    return metadata
  }

  async getMediaBlob(meta: MediaMetadata): Promise<Blob> {
    return await this.storage.readFile(meta.path)
  }

  async deleteMedia(meta: MediaMetadata): Promise<void> {
    await this.storage.deleteFile(meta.path)
    if (meta.thumbnailPath) {
      await this.storage.deleteFile(meta.thumbnailPath)
    }
  }
}
