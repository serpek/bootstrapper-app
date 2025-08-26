export interface IMediaProcessorService {
  /**
   * Dosya için küçük resim (thumbnail) oluşturur
   * @param file Thumbnail oluşturulacak dosya
   * @param maxWidth Maksimum genişlik (piksel)
   * @param maxHeight Maksimum yükseklik (piksel)
   * @returns Promise<Blob> Thumbnail blob'u
   */
  generateThumbnail(file: File, maxWidth?: number, maxHeight?: number): Promise<Blob>

  /**
   * Medya dosyasının süresini çıkarır (video/audio)
   * @param file Medya dosyası
   * @returns Promise<number> Süre (saniye)
   */
  getMediaDuration(file: File): Promise<number>

  /**
   * Dosya için önizleme bilgilerini oluşturur
   * @param file İşlenecek dosya
   * @returns Promise<Partial<FileMetadata>> Metadata parçası
   */
  generatePreviewMetadata(file: File): Promise<{
    playable?: boolean
    displayable?: boolean
    duration?: number
    thumbnailId?: string
  }>

  /**
   * Desteklenen medya türlerini kontrol eder
   * @param mimeType MIME type
   * @returns boolean Desteklenip desteklenmediği
   */
  isSupportedMediaType(mimeType: string): boolean
}
