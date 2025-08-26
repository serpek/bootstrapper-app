import { DependencyContainer } from 'tsyringe'

import { BrowserFileSystem } from './browser-file-system'
import { CacheService } from './cache-service'
import { configureContainer, TYPES } from './di-container'
import { FileOperationsFactory } from './file-operations-factory'
import { IFileSystemConfig } from './interfaces'
import { MediaProcessorService } from './media-processor-service'
import { MetadataService } from './metadata-service'

export function configureDependencies(
  config: IFileSystemConfig
): DependencyContainer {
  const container = configureContainer(config)

  container.register(FileOperationsFactory, {
    useClass: FileOperationsFactory
  })

  // Adapter'ı factory üzerinden oluştur
  container.register(TYPES.FileOperations, {
    useFactory: (c) => c.resolve(FileOperationsFactory).createAdapter()
  })
  // container.register<IFileOperationsAdapter>(TYPES.FileOperations, {
  //   useClass: WorkerFileAdapter
  // })

  // Diğer servisler
  container.register(TYPES.MetadataOperations, {
    useClass: MetadataService
  })

  container.register(TYPES.MediaProcessor, {
    useClass: MediaProcessorService
  })

  container.register(TYPES.CacheService, {
    useClass: CacheService
  })

  container.register(BrowserFileSystem, {
    useClass: BrowserFileSystem
  })

  return container
}
