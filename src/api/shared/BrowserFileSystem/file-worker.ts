self.addEventListener('message', async (e) => {
  const { action, payload, messageId } = e.data

  try {
    let result

    switch (action) {
      case 'readFile':
        result = await readFile(payload.name)
        break
      case 'writeFile':
        result = await writeFile(payload.name, payload.data)
        break
      case 'deleteFile':
        result = await deleteFile(payload.name)
        break
      case 'listFiles':
        result = await listFiles()
        break
      case 'exists':
        result = await exists(payload.name)
        break
      default:
        throw new Error(`Unknown action: ${action}`)
    }

    self.postMessage({ messageId, result })
  } catch (error) {
    self.postMessage({
      messageId,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

async function getFileHandle(name: string, create = false) {
  const root = await navigator.storage.getDirectory()
  return root.getFileHandle(name, { create })
}

async function readFile(name: string): Promise<ArrayBuffer> {
  const handle = await getFileHandle(name)
  const file = await handle.getFile()
  return file.arrayBuffer()
}

async function writeFile(name: string, data: ArrayBuffer): Promise<void> {
  const handle = await getFileHandle(name, true)
  const syncHandle = await handle.createSyncAccessHandle()

  try {
    syncHandle.write(data)
    syncHandle.flush()
  } finally {
    syncHandle.close()
  }
}

async function deleteFile(name: string): Promise<void> {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(name)
}

async function listFiles(): Promise<string[]> {
  const root = await navigator.storage.getDirectory()
  const files: string[] = []

  // @ts-ignore
  for await (const entry of root.values()) {
    if (entry.kind === 'file') {
      files.push(entry.name)
    }
  }

  return files
}

async function exists(name: string): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory()
    await root.getFileHandle(name)
    return true
  } catch {
    return false
  }
}
