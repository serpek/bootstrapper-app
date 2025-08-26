import 'reflect-metadata'

import { container, DependencyContainer } from 'tsyringe'

import type { IFileSystemConfig } from './interfaces'

export const enum TYPES {
  FileOperations = 'FileOperations',
  MetadataOperations = 'MetadataOperations',
  MediaProcessor = 'MediaProcessor',
  CacheService = 'CacheService',
  FileSystemConfig = 'FileSystemConfig'
}

let appContainer: DependencyContainer

export function configureContainer(
  config: IFileSystemConfig
): DependencyContainer {
  appContainer = container.createChildContainer()

  // Config'i register et
  appContainer.register(TYPES.FileSystemConfig, {
    useValue: config
  })

  return appContainer
}

export function getContainer(): DependencyContainer {
  if (!appContainer) {
    throw new Error('Container has not been configured yet')
  }
  return appContainer
}

export function resetContainer(): void {
  appContainer.reset()
}
