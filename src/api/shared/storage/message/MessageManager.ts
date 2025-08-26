import { Collection } from 'dexie'

import { openMessageDB } from '../db/MessageDB'
import { metadataDB } from '../db/MetadataDB'
import { Message, MessageType } from '../models/Message'

interface MessageFilter {
  sender?: string
  recipient?: string
  contentIncludes?: string
  type?: MessageType
  after?: number // timestamp
  before?: number // timestamp
}

export class MessageManager {
  private dbPromise = openMessageDB()

  constructor() {
    this.dbPromise.catch((error) => {
      console.error('Mesaj veritabanı açılamadı:', error)
    })
  }

  async saveMessage(msg: Message): Promise<void> {
    await metadataDB.messages.put(msg)
  }

  async deleteMessage(id: string): Promise<void> {
    await metadataDB.messages.delete(id)
  }

  async searchMessages(
    filter: MessageFilter
  ): Promise<Collection<Message, string, Message>> {
    return metadataDB.transaction('r', metadataDB.messages, async () => {
      return metadataDB.messages.filter((msg: Message) => {
        if (filter.sender && msg.sender !== filter.sender) return false
        if (filter.recipient && msg.recipient !== filter.recipient) return false
        if (filter.type && msg.type !== filter.type) return false
        if (filter.after && msg.timestamp < filter.after) return false
        if (filter.before && msg.timestamp > filter.before) return false
        return !(
          filter.contentIncludes &&
          !msg.content
            .toLowerCase()
            .includes(filter.contentIncludes.toLowerCase())
        )
      })
    })
  }
}
