import { injectable } from 'tsyringe'
import { v4 as uuidv4 } from 'uuid'

import { metadataDB } from '../db/MetadataDB'
import {
  MediaMessage,
  Message,
  MessageType,
  TextMessage
} from '../models/Message'

import { MediaFileManager } from './MediaFileManager'

@injectable()
export class MessageService {
  private messages: Message[] = []

  constructor(private mediaManager: MediaFileManager) {}

  async init(): Promise<void> {
    await this.mediaManager.init()
  }

  async sendTextMessage(
    senderId: string,
    receiverId: string,
    content: string
  ): Promise<TextMessage> {
    const message: TextMessage = {
      receiver: '',
      sender: '',
      id: uuidv4(),
      type: MessageType.TEXT,
      senderId,
      receiverId,
      timestamp: Date.now(),
      content
    }
    this.messages.push(message)
    return message
  }

  async sendMediaMessage(
    senderId: string,
    receiverId: string,
    file: File
  ): Promise<MediaMessage> {
    const id = uuidv4()

    const mediaMessage: MediaMessage = {
      content: '',
      receiver: '',
      sender: '',
      id,
      type: MessageType.MEDIA,
      senderId,
      receiverId,
      timestamp: Date.now(),
      mediaType: file.type,
      fileName: file.name,
      fileSize: file.size
    }

    await this.mediaManager.writeMedia(id, file)
    this.messages.push(mediaMessage)
    return mediaMessage
  }

  async getMessage(id: string): Promise<Message | undefined> {
    return this.messages.find((m) => m.id === id)
  }

  async getMediaBlob(id: string): Promise<Blob> {
    return await this.mediaManager.readMedia(id)
  }

  async getThumbnailBlob(id: string): Promise<Blob | null> {
    return await this.mediaManager.getThumbnail(id)
  }

  async deleteMessage(id: string): Promise<void> {
    this.messages = this.messages.filter((m) => m.id !== id)
    await this.mediaManager.deleteMedia(id)
  }

  async searchMessages(query: string): Promise<Message[]> {
    return this.messages.filter(
      (m) =>
        m.type === MessageType.TEXT &&
        m.content.toLowerCase().includes(query.toLowerCase())
    )
  }

  async listAllMessages(): Promise<Message[]> {
    return [...this.messages]
  }

  async syncWithOPFS(): Promise<void> {
    const existingIds = await this.mediaManager.listMediaIds()
    const mediaMessages = this.messages.filter(
      (m) => m.type === MessageType.MEDIA
    ) as MediaMessage[]

    for (const msg of mediaMessages) {
      if (!existingIds.includes(msg.id)) {
        console.warn(`Media missing for message ${msg.id}, removing`)
        this.messages = this.messages.filter((m) => m.id !== msg.id)
        await metadataDB.thumbnails.delete(msg.id)
      }
    }
  }
}
