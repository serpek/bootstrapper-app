import sha256 from 'crypto-js/sha256'
import { generateKeyPair, KeyPair } from 'ecies-25519'
import { UAParser } from 'ua-parser-js'

import { byteArrayToBase64 } from '@bipweb/utils'

import {
  ActivateMessage,
  BrowserData,
  InitMessage,
  LogoutMessage,
  PingMessage,
  ReconnectMessage,
  StatisticsMessage,
  TempMessage
} from './types'

/**
 * ID üretimi: (timestamp düşük 32bit) << 12 | counter (0-4095)
 * Çok sekmeli kullanımda çarpışmayı azaltır.
 */
class IdGenerator {
  private counter = 0

  next(): number {
    const lowTs = Date.now() & 0xffffffff
    this.counter = (this.counter + 1) & 0xfff
    return (lowTs << 12) | this.counter
  }
}

export interface MessageBuilderOptions {
  lang?: string
  ip?: string
}

export class MessageBuilder {
  public browserData: BrowserData

  private readonly _uaParser = new UAParser()
  private readonly _webIdentityKey: KeyPair = generateKeyPair()
  // private readonly _webEphemeralKey: KeyPair = generateKeyPair() // Gelecekte şifreleme için
  private readonly idGen = new IdGenerator()
  private readonly lang: string
  private readonly ip: string

  constructor(opts: MessageBuilderOptions = {}) {
    this.lang =
      opts.lang ??
      (typeof navigator !== 'undefined'
        ? navigator.language.split('-')[0]
        : 'tr')
    this.ip = opts.ip ?? ''
    this.browserData = this._getBrowserData()
  }

  Init(): InitMessage {
    return { bw: 'init', wp: this.browserData, id: this.idGen.next() }
  }

  Logout(apikey: string): LogoutMessage {
    return {
      bw: 'logout',
      cr: { apikey },
      id: this.idGen.next()
    }
  }

  Reconnect(apikey: string): ReconnectMessage {
    return {
      bw: 'reconn',
      wp: this.browserData,
      cr: { apikey },
      id: this.idGen.next()
    }
  }

  Activate(apikey: string): ActivateMessage {
    return {
      bw: 'activate',
      cr: { apikey },
      id: this.idGen.next()
    }
  }

  Statistics(): StatisticsMessage {
    return {
      bw: 'statistics',
      message: {
        appVersion: '',
        msisdn: '',
        osType: this.browserData.os,
        time: Date.now(),
        type: 'browser',
        webVersion: ''
      },
      id: this.idGen.next()
    }
  }

  Ping(): PingMessage {
    return { bw: 'ping', id: this.idGen.next() }
  }

  Temp(): TempMessage {
    return { bw: 'temp', id: this.idGen.next() }
  }

  private _getBrowserData(): BrowserData {
    const webIdentityKey = byteArrayToBase64(this._webIdentityKey.publicKey)

    const browserInfo = this._uaParser.getBrowser()
    const osInfo = this._uaParser.getOS()

    const params = {
      browser: browserInfo.name || '',
      browserVersion: browserInfo.version || '',
      os: osInfo.name || '',
      osVersion: osInfo.version || 'undefined'
    }

    const fp = sha256(JSON.stringify(params)).toString()
    return {
      ...params,
      fp,
      webIdentityKey,
      lang: this.lang,
      ip: this.ip,
      time: Date.now()
    }
  }
}
