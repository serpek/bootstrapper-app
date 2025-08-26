export enum MessageType {
  TEXT = 'text',
  MEDIA = 'media'
}

export interface BaseMessage {
  senderId: string
  receiverId: string
  recipient?: string

  content: string
  id: string
  sender: string
  receiver: string
  timestamp: number
  type: MessageType
  mediaPath?: string
  customMetadata?: Record<string, any>
}

export interface TextMessage extends BaseMessage {
  type: MessageType.TEXT
  content: string
}

export interface MediaMessage extends BaseMessage {
  type: MessageType.MEDIA
  mediaType: string
  fileName: string
  fileSize: number
}

export type Message = TextMessage | MediaMessage
