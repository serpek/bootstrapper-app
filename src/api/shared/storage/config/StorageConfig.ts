export interface StorageAdapterConfig {
  useWorker?: boolean
  enableCache?: boolean
  maxFileSize?: number // bytes
}

export const DefaultStorageAdapterConfig: StorageAdapterConfig = {
  useWorker: false,
  enableCache: true,
  maxFileSize: 100 * 1024 * 1024 // 100MB
}
