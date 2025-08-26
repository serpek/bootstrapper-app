import { inject, injectable } from 'tsyringe'

import { TYPES } from './di-container'
import {
  type ICacheService,
  type IFileOperationsAdapter,
  type IFileSystemConfig,
  type IMediaProcessorService,
  type IMetadataService
} from './interfaces'
import { FileMetadata } from './types'

@injectable()
export class BrowserFileSystem {
  constructor(
    @inject(TYPES.FileOperations) private fileOps: IFileOperationsAdapter,
    @inject(TYPES.MetadataOperations) private metadataOps: IMetadataService,
    @inject(TYPES.MediaProcessor) private mediaProcessor: IMediaProcessorService,
    @inject(TYPES.CacheService) private cacheService: ICacheService,
    @inject(TYPES.FileSystemConfig) private config: IFileSystemConfig
  ) {}

  async uploadFile(file: File, customMetadata?: Record<string, any>): Promise<FileMetadata> {
    // Dosya boyutu kontrolü
    if (file.size > this.config.fileSizeLimit * 1024 * 1024) {
      throw new Error(`File size exceeds the limit of ${this.config.fileSizeLimit}MB`)
    }

    const id = crypto.randomUUID()
    const metadata: FileMetadata = {
      id,
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      customMetadata,
      playable: false,
      displayable: false
    }

    try {
      // Dosya yazma
      await this.fileOps.writeFile(id, file)

      // Medya işlemleri
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        metadata.displayable = true

        // Thumbnail oluştur
        const thumbnail = await this.mediaProcessor.generateThumbnail(file)
        const thumbnailId = `${id}_thumb`
        await this.fileOps.writeFile(thumbnailId, thumbnail)
        metadata.thumbnailId = thumbnailId
      }

      if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
        metadata.playable = true
        metadata.duration = await this.mediaProcessor.getMediaDuration(file)
      }

      // Metadata kaydet
      await this.metadataOps.addMetadata(metadata)

      return metadata
    } catch (error) {
      // Hata durumunda temizlik
      await this.fileOps.deleteFile(id).catch(() => {})
      if (metadata.thumbnailId) {
        await this.fileOps.deleteFile(metadata.thumbnailId).catch(() => {})
      }
      throw error
    }
  }

  async getFile(id: string): Promise<{ file: File; metadata: FileMetadata }> {
    const cacheKey = `file_${id}`

    const cached = await this.cacheService.get<{ file: File; metadata: FileMetadata }>(cacheKey)
    if (cached) {
      return cached
    }

    const metadata = await this.metadataOps.getMetadata(id)
    if (!metadata) {
      throw new Error('File not found')
    }

    const file = await this.fileOps.readFile(id)
    const result = { file, metadata }

    // Dosyayı cache'e al (metadata hariç boyut)
    this.cacheService.set(cacheKey, result, file.size)

    return result
  }

  async getFileThumbnail(id: string): Promise<File | null> {
    const cacheKey = `thumb_${id}`

    const cached = await this.cacheService.get<File>(cacheKey)
    if (cached) {
      return cached
    }

    const metadata = await this.metadataOps.getMetadata(id)
    if (!metadata?.thumbnailId) {
      return null
    }

    const thumbnail = await this.fileOps.readFile(metadata.thumbnailId)
    this.cacheService.set(cacheKey, thumbnail, thumbnail.size)

    return thumbnail
  }

  async deleteFile(id: string): Promise<void> {
    const metadata = await this.metadataOps.getMetadata(id)
    if (!metadata) {
      throw new Error('File not found')
    }

    await Promise.all([
      this.fileOps.deleteFile(id),
      metadata.thumbnailId ? this.fileOps.deleteFile(metadata.thumbnailId) : Promise.resolve(),
      this.metadataOps.deleteMetadata(id)
    ])
  }

  async listFiles(): Promise<FileMetadata[]> {
    return this.metadataOps.listMetadata()
  }

  async updateMetadata(id: string, changes: Partial<FileMetadata>): Promise<void> {
    await this.metadataOps.updateMetadata(id, changes)
  }

  async searchFiles(query: (record: FileMetadata) => boolean): Promise<FileMetadata[]> {
    return this.metadataOps.searchMetadata(query)
  }
}
