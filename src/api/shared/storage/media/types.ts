export interface MediaMetadata {
  id: string
  name: string
  type: string
  size: number
  path: string
  thumbnailPath?: string
  duration?: number
  width?: number
  height?: number
  createdAt: number
}
