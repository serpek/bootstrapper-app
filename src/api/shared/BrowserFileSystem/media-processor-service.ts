import { inject, injectable } from 'tsyringe'

import { TYPES } from './di-container'
import type { IFileSystemConfig, IMediaProcessorService } from './interfaces'

@injectable()
export class MediaProcessorService implements IMediaProcessorService {
  private readonly canvas: OffscreenCanvas | HTMLCanvasElement
  private canvasContext:
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null

  constructor(
    @inject(TYPES.FileSystemConfig) private config: IFileSystemConfig
  ) {
    // Worker içinde OffscreenCanvas, normalde HTMLCanvasElement kullan
    this.canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas')

    this.canvasContext = this.canvas.getContext('2d')
  }

  async generateThumbnail(
    file: File,
    maxWidth: number = 200,
    maxHeight: number = 200
  ): Promise<Blob> {
    if (!this.isSupportedMediaType(file.type)) {
      throw new Error(`Unsupported media type: ${file.type}`)
    }

    try {
      if (file.type.startsWith('image/')) {
        return await this.processImageThumbnail(file, maxWidth, maxHeight)
      } else if (file.type.startsWith('video/')) {
        return await this.processVideoThumbnail(file, maxWidth, maxHeight)
      }
      throw new Error(
        `Thumbnail generation not supported for type: ${file.type}`
      )
    } catch (error) {
      throw new Error(
        `Failed to generate thumbnail: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async getMediaDuration(file: File): Promise<number> {
    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
      throw new Error(
        'Duration can only be extracted from audio or video files'
      )
    }

    return new Promise((resolve, reject) => {
      const media = file.type.startsWith('audio/')
        ? new Audio()
        : document.createElement('video')

      const url = URL.createObjectURL(file)
      media.src = url

      media.onloadedmetadata = () => {
        resolve(media.duration)
        URL.revokeObjectURL(url)
      }

      media.onerror = () => {
        reject(new Error('Failed to load media for duration extraction'))
        URL.revokeObjectURL(url)
      }
    })
  }

  async generatePreviewMetadata(file: File): Promise<{
    playable?: boolean
    displayable?: boolean
    duration?: number
    thumbnailId?: string
  }> {
    const result: {
      playable?: boolean
      displayable?: boolean
      duration?: number
      thumbnailId?: string
    } = {}

    try {
      result.playable =
        file.type.startsWith('audio/') || file.type.startsWith('video/')
      result.displayable =
        file.type.startsWith('image/') || file.type.startsWith('video/')

      if (result.playable) {
        result.duration = await this.getMediaDuration(file)
      }

      if (result.displayable) {
        result.thumbnailId = `thumb_${crypto.randomUUID()}`
      }

      return result
    } catch (error) {
      console.warn('Preview metadata generation partially failed:', error)
      return result // Hata olsa bile elde edilen kısmi sonuçları döndür
    }
  }

  isSupportedMediaType(mimeType: string): boolean {
    const supportedTypes = this.config.supportedMimeTypes || [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/webm',
      'video/ogg',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav'
    ]

    return supportedTypes.some(
      (type) =>
        type === mimeType ||
        (type.endsWith('/*') && mimeType.startsWith(type.replace('/*', '/')))
    )
  }

  private async processImageThumbnail(
    file: File,
    maxWidth: number,
    maxHeight: number
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)

      img.onload = () => {
        try {
          const dimensions = this.calculateDimensions(
            img.width,
            img.height,
            maxWidth,
            maxHeight
          )
          this.setCanvasSize(dimensions.width, dimensions.height)

          this.canvasContext?.drawImage(
            img,
            0,
            0,
            dimensions.width,
            dimensions.height
          )
          this.canvasToBlob(resolve, reject)
        } catch (error) {
          reject(error)
        } finally {
          URL.revokeObjectURL(url)
        }
      }

      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to load image'))
      }

      img.src = url
    })
  }

  private async processVideoThumbnail(
    file: File,
    maxWidth: number,
    maxHeight: number
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      const url = URL.createObjectURL(file)

      video.onloadedmetadata = () => {
        video.currentTime = Math.min(1, video.duration * 0.1)
      }

      video.onseeked = () => {
        try {
          const dimensions = this.calculateDimensions(
            video.videoWidth,
            video.videoHeight,
            maxWidth,
            maxHeight
          )
          this.setCanvasSize(dimensions.width, dimensions.height)

          this.canvasContext?.drawImage(
            video,
            0,
            0,
            dimensions.width,
            dimensions.height
          )
          this.canvasToBlob(resolve, reject)
        } catch (error) {
          reject(error)
        } finally {
          URL.revokeObjectURL(url)
        }
      }

      video.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to load video'))
      }

      video.src = url
    })
  }

  private canvasToBlob(
    resolve: (blob: Blob) => void,
    reject: (error: Error) => void
  ): void {
    if (this.canvas instanceof OffscreenCanvas) {
      this.canvas
        .convertToBlob({ type: 'image/jpeg', quality: 0.8 })
        .then(resolve)
        .catch(reject)
    } else {
      // this.canvas.toBlob(
      //   (blob) => {
      //      blob ? resolve(blob) : reject(new Error('Canvas to Blob conversion failed'))
      //   },
      //   'image/jpeg',
      //   0.8
      // )
    }
  }

  private setCanvasSize(width: number, height: number): void {
    this.canvas.width = width
    this.canvas.height = height
  }

  private calculateDimensions(
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number
  ): { width: number; height: number } {
    let width = originalWidth
    let height = originalHeight

    if (width > height) {
      if (width > maxWidth) {
        height *= maxWidth / width
        width = maxWidth
      }
    } else {
      if (height > maxHeight) {
        width *= maxHeight / height
        height = maxHeight
      }
    }

    return { width, height }
  }
}
