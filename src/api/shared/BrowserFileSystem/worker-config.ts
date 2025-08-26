// worker-config.ts
import { BrowserFileSystem } from './browser-file-system'
import { configureDependencies } from './configure-dependencies'

const workerConfig = {
  useWorker: true,
  cacheSize: 100,
  fileSizeLimit: 100,
  workerScript: '/dist/file-worker.js' // Worker script yolu
}

const workerContainer = configureDependencies(workerConfig)
const workerFileSystem = workerContainer.resolve(BrowserFileSystem)
workerFileSystem.listFiles().catch(console.error)
