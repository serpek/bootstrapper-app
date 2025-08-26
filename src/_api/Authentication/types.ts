/* Tip & Protokol Tanımları */

const INBOUND_BW_TYPES = [
  'qr',
  'token',
  'error',
  'logout',
  'online',
  'offline',
  'mobilestatus',
  'userstatus',
  'pong',
  'statistics'
] as const

const OUTBOUND_BW_TYPES = [
  'init',
  'logout',
  'reconn',
  'activate',
  'statistics',
  'ping',
  'temp'
] as const

type InboundBwType = (typeof INBOUND_BW_TYPES)[number]

type OutboundBwType = (typeof OUTBOUND_BW_TYPES)[number]

type BwType = InboundBwType | OutboundBwType

type Message<T extends BwType> = {
  bw: T
  id: number
}

type BrowserData = {
  browser: string
  browserVersion: string
  fp: string
  ip: string
  lang: string
  os: string
  osVersion: string
  time: number
  webIdentityKey: string
}

type InitMessage = Message<'init'> & { wp: BrowserData }

type LogoutMessage = Message<'logout'> & {
  cr: { apikey: string }
}

type ReconnectMessage = Message<'reconn'> & {
  wp: BrowserData
  cr: { apikey: string }
}

type TokenMessage = Message<'token'> & {
  username: string
  domain: string
  apikey: string
  lang: string
  mobileIdentityKey: string
  status: string
  enc: boolean
  userId: string
}

type ActivateMessage = Message<'activate'> & {
  cr: { apikey: string }
}

type StatisticsMessage = Message<'statistics'> & {
  message: {
    type: string
    osType: string
    msisdn: string
    appVersion: string
    webVersion: string
    time: number
  }
}

type PingMessage = Message<'ping'>
type TempMessage = Message<'temp'>

type QrMessage = Message<'qr'> & {
  qr: string
  status: string
  enc: boolean
}

/**
 * Oturum / Auth durumları
 */
enum Status {
  INIT,
  QR,
  AUTHORIZING,
  UNAUTHORIZED,
  AUTHORIZED,
  USEHERE,
  NONBETA,
  MOBILE_NON_COMPATIBLE,
  CHECK_ACCESS_TOKEN
}

/**
 * WebSocket readyState eşlemesi
 */
enum State {
  INIT = -1,
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3
}

/**
 * Session güncelleme nedenleri
 * Gerektikçe genişletilebilir.
 */
type SessionUpdateReason =
  | 'CONNECT_START'
  | 'SOCKET_OPEN'
  | 'INIT_MESSAGE_SENT'
  | 'RECONNECT_MESSAGE_SENT'
  | 'INBOUND_QR'
  | 'INBOUND_TOKEN'
  | 'PONG_RECEIVED'
  | 'PING_TIMEOUT'
  | 'SOCKET_CLOSE'
  | 'MANUAL_CLOSE'
  | 'RECONNECT_ATTEMPT'
  | 'RECONNECT_GIVE_UP'
  | 'STATUS_RESET'
  | 'LOGOUT_REQUESTED'
  | 'TOKEN_PERSISTED'
  | 'AUTHORIZING'
  | 'AUTHORIZED'
  | 'UNAUTHORIZED'
  | 'CLEANUP'
  | 'OTHER'

type SessionContext = {
  guid: string
  index: number
  status: Status
  socket: State
  lastUpdate: number
  lastReason: SessionUpdateReason | null
  qr?: string
  keys?: Partial<{ web: string; mobile: string }>
  token?: string
  msisdn?: string
}

/* Type Guards */
function isInboundBwType(bw: string): bw is InboundBwType {
  return (INBOUND_BW_TYPES as readonly string[]).includes(bw)
}

export { INBOUND_BW_TYPES, isInboundBwType, OUTBOUND_BW_TYPES, State, Status }

export type {
  ActivateMessage,
  BrowserData,
  BwType,
  InboundBwType,
  InitMessage,
  LogoutMessage,
  Message,
  OutboundBwType,
  PingMessage,
  QrMessage,
  ReconnectMessage,
  SessionContext,
  SessionUpdateReason,
  StatisticsMessage,
  TempMessage,
  TokenMessage
}
