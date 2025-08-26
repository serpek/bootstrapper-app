import { inject, injectable } from 'tsyringe'

import { TYPES } from './di-container'
import type { IFileOperationsAdapter, IFileSystemConfig } from './interfaces'

@injectable()
export class FileOperationsAdapter implements IFileOperationsAdapter {
  private root: FileSystemDirectoryHandle | null = null
  private syncAccessHandles: Map<string, FileSystemSyncAccessHandle> = new Map()

  constructor(
    @inject(TYPES.FileSystemConfig) private config: IFileSystemConfig
  ) {}

  async readFile(name: string): Promise<File> {
    await this.initialize()

    try {
      const fileHandle = await this.root!.getFileHandle(name)
      return await fileHandle.getFile()
    } catch (error) {
      throw this.createFileError('read', name, error)
    }
  }

  async writeFile(name: string, data: Blob): Promise<void> {
    await this.initialize()

    try {
      if (this.config.useWorker) {
        await this.writeWithSyncAccess(name, data)
      } else {
        await this.writeAsync(name, data)
      }
    } catch (error) {
      throw this.createFileError('write', name, error)
    }
  }

  async deleteFile(name: string): Promise<void> {
    await this.initialize()

    try {
      if (this.syncAccessHandles.has(name)) {
        this.syncAccessHandles.get(name)?.close()
        this.syncAccessHandles.delete(name)
      }
      await this.root!.removeEntry(name)
    } catch (error) {
      throw this.createFileError('delete', name, error)
    }
  }

  async listFiles(): Promise<string[]> {
    await this.initialize()

    const files: string[] = []
    try {
      // @ts-ignore
      for await (const entry of this.root!.values()) {
        if (entry.kind === 'file') {
          files.push(entry.name)
        }
      }
      return files
    } catch (error) {
      throw this.createFileError('list', '', error)
    }
  }

  async exists(name: string): Promise<boolean> {
    await this.initialize()

    try {
      await this.root!.getFileHandle(name)
      return true
    } catch {
      return false
    }
  }

  async getFileSize(name: string): Promise<number> {
    await this.initialize()

    try {
      const fileHandle = await this.root!.getFileHandle(name)
      const file = await fileHandle.getFile()
      return file.size
    } catch (error) {
      throw this.createFileError('get size', name, error)
    }
  }

  async close(): Promise<void> {
    for (const [, handle] of this.syncAccessHandles) {
      handle.close()
    }
    this.syncAccessHandles.clear()
  }

  private async initialize(): Promise<void> {
    if (!this.root) {
      this.root = await navigator.storage.getDirectory()
    }
  }

  private async writeAsync(name: string, data: Blob): Promise<void> {
    const fileHandle = await this.root!.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(data)
    await writable.close()
  }

  private async writeWithSyncAccess(name: string, data: Blob): Promise<void> {
    let syncHandle = this.syncAccessHandles.get(name)

    if (!syncHandle) {
      const fileHandle = await this.root!.getFileHandle(name, { create: true })
      syncHandle = await fileHandle.createSyncAccessHandle()
    }
    try {
      if (syncHandle) {
        this.syncAccessHandles.set(name, syncHandle)
        const buffer = await data.arrayBuffer()

        syncHandle.write(buffer, { at: 0 })
        syncHandle.flush()
      }
    } catch (error) {
      this.syncAccessHandles.delete(name)
      syncHandle?.close()
      throw error
    }
  }

  private createFileError(
    operation: string,
    filename: string,
    error: unknown
  ): Error {
    const message = `File ${operation} error for "${filename}": ${
      error instanceof Error ? error.message : String(error)
    }`
    return new Error(message)
  }
}
