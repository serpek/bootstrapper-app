export interface ICacheService {
  /**
   * Cache'ten veri getirir veya sağlayıcı fonksiyonu çalıştırır
   * @param key Cache anahtarı
   * @param supplier Veri sağlayıcı fonksiyon (opsiyonel)
   * @returns Promise<T | undefined>
   */
  get<T>(key: string, supplier?: () => Promise<T>): Promise<T | undefined>

  /**
   * Cache'e veri ekler
   * @param key Cache anahtarı
   * @param data Cache'lenecek veri
   * @param size Veri boyutu (byte) - opsiyonel
   * @returns void
   */
  set(key: string, data: any, size?: number): void

  /**
   * Cache'ten veri siler
   * @param key Cache anahtarı
   * @returns void
   */
  delete(key: string): void

  /**
   * Tüm cache'i temizler
   * @returns void
   */
  clear(): void

  /**
   * Cache'teki toplam boyutu getirir
   * @returns number Byte cinsinden boyut
   */
  getCurrentSize(): number

  /**
   * Cache'teki maksimum boyutu getirir
   * @returns number Byte cinsinden boyut
   */
  getMaxSize(): number

  /**
   * Cache'teki öğe sayısını getirir
   * @returns number Öğe sayısı
   */
  getItemCount(): number

  /**
   * Belirtilen anahtarın cache'te olup olmadığını kontrol eder
   * @param key Cache anahtarı
   * @returns boolean
   */
  has(key: string): boolean
}
