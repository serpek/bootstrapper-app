export interface IFileOperationsAdapter {
  /**
   * Dosya okur
   * @param name Dosya adı
   * @returns Promise<File>
   */
  readFile(name: string): Promise<File>

  /**
   * Dosya yazar
   * @param name Dosya adı
   * @param data Yazılacak veri
   * @returns Promise<void>
   */
  writeFile(name: string, data: Blob): Promise<void>

  /**
   * Dosya siler
   * @param name Dosya adı
   * @returns Promise<void>
   */
  deleteFile(name: string): Promise<void>

  /**
   * Dosya listesi getirir
   * @returns Promise<string[]>
   */
  listFiles(): Promise<string[]>

  /**
   * Dosya varlığını kontrol eder
   * @param name Dosya adı
   * @returns Promise<boolean>
   */
  exists(name: string): Promise<boolean>

  /**
   * Dosya boyutunu getirir
   * @param name Dosya adı
   * @returns Promise<number> Byte cinsinden boyut
   */
  getFileSize(name: string): Promise<number>
}
