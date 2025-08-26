import { FileMetadata } from '../types'

export interface IMetadataService {
  /**
   * Yeni metadata ekler
   * @param metadata FileMetadata nesnesi
   * @returns Promise<void>
   */
  addMetadata(metadata: FileMetadata): Promise<void>

  /**
   * ID'ye göre metadata getirir
   * @param id Dosya ID'si
   * @returns Promise<FileMetadata | undefined>
   */
  getMetadata(id: string): Promise<FileMetadata | undefined>

  /**
   * Metadata günceller
   * @param id Dosya ID'si
   * @param changes Kısmi metadata değişiklikleri
   * @returns Promise<void>
   */
  updateMetadata(id: string, changes: Partial<FileMetadata>): Promise<void>

  /**
   * Metadata siler
   * @param id Dosya ID'si
   * @returns Promise<void>
   */
  deleteMetadata(id: string): Promise<void>

  /**
   * Tüm metadata listesini getirir
   * @returns Promise<FileMetadata[]>
   */
  listMetadata(): Promise<FileMetadata[]>

  /**
   * Query fonksiyonu ile metadata arar
   * @param query Arama fonksiyonu
   * @returns Promise<FileMetadata[]>
   */
  searchMetadata(query: (record: FileMetadata) => boolean): Promise<FileMetadata[]>

  /**
   * Özel metadata alanını günceller
   * @param id Dosya ID'si
   * @param key Metadata anahtarı
   * @param value Metadata değeri
   * @returns Promise<void>
   */
  updateCustomMetadata<T = any>(id: string, key: string, value: T): Promise<void>

  /**
   * Özel metadata alanını siler
   * @param id Dosya ID'si
   * @param key Metadata anahtarı
   * @returns Promise<void>
   */
  removeCustomMetadata(id: string, key: string): Promise<void>
}
