import { inject, injectable } from 'tsyringe'

import { TYPES } from './di-container'
import type { IFileOperationsAdapter, IFileSystemConfig } from './interfaces'

@injectable()
export class WorkerFileAdapter implements IFileOperationsAdapter {
  private worker: Worker
  private messageHandlers: Map<
    string,
    { resolve: (value: any) => void; reject: (reason?: any) => void }
  > = new Map()

  constructor(
    @inject(TYPES.FileSystemConfig) private config: IFileSystemConfig
  ) {
    if (!this.config.workerScript) {
      throw new Error('Worker script path is required in config')
    }
    this.worker = new Worker(this.config.workerScript)
    this.worker.onmessage = this.handleWorkerMessage.bind(this)
  }

  async readFile(name: string): Promise<File> {
    try {
      const { buffer, fileName, type } = await this.postMessage<{
        buffer: ArrayBuffer
        fileName: string
        type: string
      }>('readFile', { name })

      return new File([buffer], fileName, { type })
    } catch (error) {
      throw new Error(
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async writeFile(name: string, data: Blob): Promise<void> {
    try {
      const buffer = await data.arrayBuffer()
      await this.postMessage<void>('writeFile', {
        name,
        data: buffer,
        type: data.type
      })
    } catch (error) {
      throw new Error(
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async deleteFile(name: string): Promise<void> {
    try {
      await this.postMessage<void>('deleteFile', { name })
    } catch (error) {
      throw new Error(
        `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async listFiles(): Promise<string[]> {
    try {
      return await this.postMessage<string[]>('listFiles')
    } catch (error) {
      throw new Error(
        `Failed to list files: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async exists(name: string): Promise<boolean> {
    try {
      return await this.postMessage<boolean>('exists', { name })
    } catch (error) {
      throw new Error(
        `Failed to check file existence: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async getFileSize(name: string): Promise<number> {
    try {
      return await this.postMessage<number>('getFileSize', { name })
    } catch (error) {
      throw new Error(
        `Failed to get file size: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  terminate(): void {
    this.worker.terminate()
    this.messageHandlers.clear()
  }

  private handleWorkerMessage(event: MessageEvent): void {
    const { messageId, result, error } = event.data
    const handler = this.messageHandlers.get(messageId)

    if (handler) {
      this.messageHandlers.delete(messageId)
      if (error) {
        handler.reject(new Error(error))
      } else {
        handler.resolve(result)
      }
    }
  }

  private postMessage<T>(action: string, payload?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const messageId = crypto.randomUUID()
      this.messageHandlers.set(messageId, { resolve, reject })

      this.worker.postMessage({
        action,
        payload,
        messageId
      })
    })
  }
}
