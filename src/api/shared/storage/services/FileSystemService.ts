import { inject, injectable } from 'tsyringe'

import type { IStorageAdapter } from '../interfaces/IStorageAdapter'

@injectable()
export class FileSystemService {
  writeFile = this.adapter.writeFile.bind(this.adapter)
  readFile = this.adapter.readFile.bind(this.adapter)
  deleteFile = this.adapter.deleteFile.bind(this.adapter)
  renameFile = this.adapter.renameFile.bind(this.adapter)
  fileExists = this.adapter.fileExists.bind(this.adapter)
  listFiles = this.adapter.listFiles.bind(this.adapter)
  getFileMetadata = this.adapter.getFileMetadata.bind(this.adapter)
  setCustomMetadata = this.adapter.setCustomMetadata.bind(this.adapter)
  getCustomMetadata = this.adapter.getCustomMetadata.bind(this.adapter)
  generateThumbnail = this.adapter.generateThumbnail.bind(this.adapter)
  getThumbnail = this.adapter.getThumbnail.bind(this.adapter)

  constructor(@inject('IStorageAdapter') private adapter: IStorageAdapter) {}

  async init() {
    await this.adapter.init()
  }
}
