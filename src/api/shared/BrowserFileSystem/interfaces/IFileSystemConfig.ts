export interface IFileSystemConfig {
  /**
   * Worker kullanılıp kullanılmayacağı
   */
  useWorker: boolean

  /**
   * Cache boyutu (MB cinsinden)
   */
  cacheSize: number

  /**
   * Maksimum dosya yükleme boyutu (MB cinsinden)
   */
  fileSizeLimit: number

  /**
   * Worker script yolu (useWorker true ise gerekli)
   */
  workerScript?: string

  /**
   * Thumbnail boyutları
   */
  thumbnailOptions?: {
    maxWidth: number
    maxHeight: number
    quality: number
  }

  /**
   * Desteklenen MIME tipleri
   */
  supportedMimeTypes?: string[]
}
