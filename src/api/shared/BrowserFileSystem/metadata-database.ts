import Dexie from 'dexie'

import { FileMetadata } from './types'

export class MetadataDatabase extends Dexie {
  files: Dexie.Table<FileMetadata, string>

  constructor() {
    super('BrowserFileSystemMetadata')
    this.version(1).stores({
      files: 'id, name, type, lastModified'
    })
    this.files = this.table('files')
  }
}
