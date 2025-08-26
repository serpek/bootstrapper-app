export interface FileMetadata {
  id: string
  name: string
  size: number
  type: string
  lastModified: number
  customMetadata?: Record<string, any>
  thumbnailId?: string
  duration?: number // Video/audio için
  playable?: boolean // Medya oynatılabilir mi
  displayable?: boolean // Görüntülenebilir mi
}

export interface FileSystemOptions {
  useWorker?: boolean
  cacheSize?: number // MB cinsinden
  fileSizeLimit?: number // Default 100MB
}

export interface ProgressEvent {
  loaded: number
  total?: number
  percentage: number
  operation: 'read' | 'write' | 'delete' | 'process'
}
