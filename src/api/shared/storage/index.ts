import 'reflect-metadata'

import { container } from 'tsyringe'

import { MediaFileManager } from './services/MediaFileManager'

const mediaManager = container.resolve(MediaFileManager)

async function main() {
  await mediaManager.init()

  const fileBlob = new Blob(['Example content'], { type: 'text/plain' })
  await mediaManager.writeMedia('example-message-id', fileBlob)

  const readBlob = await mediaManager.readMedia('example-message-id')
  console.log('Read blob:', await readBlob.text())

  const thumb = await mediaManager.getThumbnail('example-message-id')
  console.log('Thumbnail exists:', !!thumb)

  await mediaManager.deleteMedia('example-message-id')
}

main().catch(console.error)
