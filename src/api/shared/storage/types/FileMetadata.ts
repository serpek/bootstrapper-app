export interface FileMetadata {
  name: string
  size: number
  type: string
  lastModified: number

  previewable: boolean
  thumbnailAvailable: boolean
  duration?: number
  width?: number
  height?: number
  isPlayable?: boolean
  customMetadata?: Record<string, any>
}
