import 'reflect-metadata'

import { BrowserFileSystem } from './browser-file-system'
import { configureDependencies } from './configure-dependencies'
import { TYPES } from './di-container'
import { IFileOperationsAdapter, IMediaProcessorService } from './interfaces'

const config = {
  useWorker: false,
  cacheSize: 50,
  fileSizeLimit: 100,
  workerScript: '/path/to/file-worker.js' // Worker modunda gerekli
}

const container = configureDependencies(config)
const fileSystem = container.resolve(BrowserFileSystem)
const mediaProcessor = container.resolve<IMediaProcessorService>(
  TYPES.MediaProcessor
)
const fileOps = container.resolve<IFileOperationsAdapter>(TYPES.FileOperations)

async function exampleUsage() {
  try {
    const fileInput = document.getElementById('file-input') as HTMLInputElement
    if (fileInput.files?.length) {
      const metadata = await fileSystem.uploadFile(fileInput.files[0], {
        tags: ['important'],
        description: 'Example file upload'
      })
      console.log('Uploaded file metadata:', metadata)
    }

    // Dosya listeleme
    const files = await fileSystem.listFiles()
    console.log('Files:', files)
  } catch (error) {
    console.error('File system error:', error)
  }
}

async function processMediaFile(file: File) {
  try {
    // Thumbnail oluştur
    const thumbnail = await mediaProcessor.generateThumbnail(file)
    await fileOps.writeFile(`thumb_${file.name}`, thumbnail)

    // Metadata oluştur
    const metadata = await mediaProcessor.generatePreviewMetadata(file)
    console.log('Media metadata:', metadata)

    // Süre bilgisi (video/audio)
    if (metadata.playable) {
      console.log('Duration:', metadata.duration)
    }
  } catch (error) {
    console.error('Media processing failed:', error)
  }
}

export { exampleUsage, fileOps, fileSystem, mediaProcessor, processMediaFile }
