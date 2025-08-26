import { injectable } from 'tsyringe'

import type { IFileOperationsAdapter } from './interfaces'

@injectable()
export class OPFSAdapter implements IFileOperationsAdapter {
  private root: FileSystemDirectoryHandle | null = null

  async initialize(): Promise<void> {
    if (!this.root) {
      this.root = await navigator.storage.getDirectory()
    }
  }

  async readFile(name: string): Promise<File> {
    await this.initialize()
    const fileHandle = await this.root!.getFileHandle(name)
    return await fileHandle.getFile()
  }

  async writeFile(name: string, data: Blob): Promise<void> {
    await this.initialize()
    const fileHandle = await this.root!.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(data)
    await writable.close()
  }

  async deleteFile(name: string): Promise<void> {
    await this.initialize()
    await this.root!.removeEntry(name)
  }

  async listFiles(): Promise<string[]> {
    await this.initialize()
    const files: string[] = []
    // @ts-ignore
    for await (const entry of this.root!.values()) {
      if (entry.kind === 'file') {
        files.push(entry.name)
      }
    }
    return files
  }

  async exists(name: string): Promise<boolean> {
    try {
      await this.initialize()
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
      const message = `File get size error for "${name}": ${
        error instanceof Error ? error.message : String(error)
      }`
      throw new Error(message)
    }
  }
}
