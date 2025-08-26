import { inject, injectable } from 'tsyringe'

import { TYPES } from './di-container'
import type { IFileOperationsAdapter, IFileSystemConfig } from './interfaces'
import { OPFSAdapter } from './opfs-adapter'
import { WorkerOPFSAdapter } from './worker-opfs-adapter'

@injectable()
export class FileOperationsFactory {
  constructor(
    @inject(TYPES.FileSystemConfig) private config: IFileSystemConfig
  ) {}

  createAdapter(): IFileOperationsAdapter {
    return this.config.useWorker
      ? new WorkerOPFSAdapter(this.config)
      : new OPFSAdapter()
  }
}
