import { injectable } from 'tsyringe'

import { MetadataDatabase } from './metadata-database'
import { FileMetadata } from './types'

@injectable()
export class MetadataService {
  private db: MetadataDatabase

  constructor() {
    this.db = new MetadataDatabase()
  }

  async addMetadata(metadata: FileMetadata): Promise<void> {
    await this.db.files.put(metadata)
  }

  async getMetadata(id: string): Promise<FileMetadata | undefined> {
    return this.db.files.get(id)
  }

  async updateMetadata(
    id: string,
    changes: Partial<FileMetadata>
  ): Promise<void> {
    await this.db.files.update(id, changes)
  }

  async deleteMetadata(id: string): Promise<void> {
    await this.db.files.delete(id)
  }

  async listMetadata(): Promise<FileMetadata[]> {
    return this.db.files.toArray()
  }

  async searchMetadata(
    query: (record: FileMetadata) => boolean
  ): Promise<FileMetadata[]> {
    return this.db.files.filter(query).toArray()
  }
}
