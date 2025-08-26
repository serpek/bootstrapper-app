self.onmessage = async (event) => {
  const { action, path, data } = event.data

  try {
    switch (action) {
      case 'writeFile': {
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle(path, { create: true })
        const writable = await handle.createWritable()
        await writable.write(data.blob)
        await writable.close()
        self.postMessage({ status: 'success', action })
        break
      }

      case 'deleteFile': {
        const root = await navigator.storage.getDirectory()
        await root.removeEntry(path)
        self.postMessage({ status: 'success', action })
        break
      }

      case 'readFile': {
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle(path)
        const file = await handle.getFile()
        const buffer = await file.arrayBuffer()
        const blob = new Blob([buffer], { type: file.type })
        self.postMessage({ status: 'success', action, result: blob }, [blob])
        break
      }

      default:
        self.postMessage({ status: 'error', error: 'Unknown action' })
    }
  } catch (error: any) {
    self.postMessage({ status: 'error', action, error: error.message })
  }
}
