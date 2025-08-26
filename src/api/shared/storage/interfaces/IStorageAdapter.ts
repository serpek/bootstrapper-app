import { FileMetadata } from '../types/FileMetadata'

export interface IStorageAdapter {
  init(): Promise<void>

  writeFile(path: string, blob: Blob): Promise<void>

  readFile(path: string): Promise<Blob>

  deleteFile(path: string): Promise<void>

  renameFile(oldPath: string, newPath: string): Promise<void>

  fileExists(path: string): Promise<boolean>

  listFiles(): Promise<FileMetadata[]>

  setCustomMetadata(path: string, metadata: Record<string, any>): Promise<void>

  getCustomMetadata(path: string): Promise<Record<string, any> | null>

  getFileMetadata(path: string): Promise<FileMetadata>

  generateThumbnail(path: string): Promise<Blob | null>

  getThumbnail(path: string): Promise<Blob | null>
}
