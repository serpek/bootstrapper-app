import { InboundBwType, Message } from './types'

/**
 * Mesaj işleme katmanı.
 * Ek olarak dışarıdan registerHandler ile özelleştirilebilir.
 */
export class MessageHandler {
  private handlers: Map<
    InboundBwType,
    (message: Message<InboundBwType>) => void
  > = new Map()

  constructor(autoInit: boolean = true) {
    if (autoInit) {
      this.initializeHandlers()
    }
  }

  registerHandler(
    type: InboundBwType,
    handler: (message: Message<InboundBwType>) => void
  ): void {
    this.handlers.set(type, handler)
  }

  unregisterHandler(type: InboundBwType): void {
    this.handlers.delete(type)
  }

  clearHandlers(): void {
    this.handlers.clear()
  }

  handleMessage(message: Message<InboundBwType>): void {
    const handler = this.handlers.get(message.bw)
    if (handler) {
      handler(message)
    } else {
      console.warn('No handler registered for message type:', message.bw)
    }
  }

  private initializeHandlers(): void {
    const log = (label: string) => (m: Message<InboundBwType>) =>
      console.log(`${label} Message processed:`, m)

    this.registerHandler('qr', log('QR'))
    this.registerHandler('token', log('Token'))
    this.registerHandler('error', (m) =>
      console.error('Error Message processed:', m)
    )
    this.registerHandler('logout', log('Logout'))
    this.registerHandler('online', log('Online'))
    this.registerHandler('offline', log('Offline'))
    this.registerHandler('mobilestatus', log('Mobile Status'))
    this.registerHandler('userstatus', log('User Status'))
    this.registerHandler('pong', log('Pong'))
    this.registerHandler('statistics', log('Statistics'))
  }
}
