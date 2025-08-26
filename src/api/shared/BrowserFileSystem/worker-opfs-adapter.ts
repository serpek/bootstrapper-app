import * as crypto from 'node:crypto'
import { inject, injectable } from 'tsyringe'

import { TYPES } from './di-container'
import type { IFileOperationsAdapter, IFileSystemConfig } from './interfaces'

@injectable()
export class WorkerOPFSAdapter implements IFileOperationsAdapter {
  private worker: Worker

  constructor(
    @inject(TYPES.FileSystemConfig) private config: IFileSystemConfig
  ) {
    if (!this.config.workerScript) {
      throw new Error('Worker script path is required in config')
    }
    this.worker = new Worker(this.config.workerScript)
  }

  async readFile(name: string): Promise<File> {
    const result = await this.postMessage<ArrayBuffer>('readFile', { name })
    return new File([result], name)
  }

  async writeFile(name: string, data: Blob): Promise<void> {
    const buffer = await data.arrayBuffer()
    await this.postMessage('writeFile', { name, data: buffer })
  }

  async deleteFile(name: string): Promise<void> {
    await this.postMessage('deleteFile', { name })
  }

  async listFiles(): Promise<string[]> {
    return this.postMessage<string[]>('listFiles')
  }

  async exists(name: string): Promise<boolean> {
    return this.postMessage<boolean>('exists', { name })
  }

  terminate(): void {
    this.worker.terminate()
  }

  getFileSize(): Promise<number> {
    return Promise.resolve(0)
  }

  private postMessage<T>(action: string, payload?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const messageId = crypto.randomUUID()

      const handler = (e: MessageEvent) => {
        if (e.data.messageId === messageId) {
          this.worker.removeEventListener('message', handler)
          if (e.data.error) {
            reject(new Error(e.data.error))
          } else {
            resolve(e.data.result)
          }
        }
      }

      this.worker.addEventListener('message', handler)
      this.worker.postMessage({ action, payload, messageId })
    })
  }
}
