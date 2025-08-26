import { Observable } from 'rxjs'
import { ILogObj, ISettingsParam, Logger } from 'tslog'

/* -------------------------------------------------------------------------- */
/*                                STATE TYPES                                 */
/* -------------------------------------------------------------------------- */

/**
 * Yöneticinin (XmppManager) yayınladığı bağlantı durumu enum değerleri.
 */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'offline'
  | 'failed'

/**
 * Bağlantı durum snapshot bilgisi.
 */
export interface ConnectionStateInfo {
  /** Geçerli durum. */
  state: ConnectionState
  /** Durum değişimine eşlik eden (opsiyonel) neden / açıklama. */
  reason?: string
  /** (Opsiyonel) Reconnect attempt sayısı (1-based). */
  attempt?: number
  /** Strophe.Status integer değeri (varsa). */
  stropheStatus?: number
  /** Unix epoch (ms) zaman damgası. */
  timestamp: number
}

/**
 * Tekil bir XMPP stanza (mesaj / presence / iq) sarmalayıcı.
 */
export interface StanzaEnvelope {
  /** Stanzanın stringleştirilmiş XML içeriği. */
  xml: string
  /** Orijinal DOM Element referansı. */
  element: Element
  /** Yön: 'in' (gelen) veya 'out' (giden). */
  direction: 'in' | 'out'
  /** Unix epoch (ms). */
  timestamp: number
}

/**
 * Hata yayınına konu olan olay modeli.
 */
export interface XmppErrorEvent {
  /** Orijinal hata nesnesi (Error veya başka tip). */
  error: any
  /** Hatanın bağlamını ifade eden kısa kod. (örn: 'connect_timeout') */
  context: string
  /** Unix epoch (ms). */
  timestamp: number
  /** (Varsa) o anki reconnect deneme sayısı. */
  attempt?: number
}

/* -------------------------------------------------------------------------- */
/*                           RECONNECT / CONFIG TYPES                         */

/* -------------------------------------------------------------------------- */

/**
 * Otomatik yeniden bağlanma davranışı konfigürasyonu.
 */
export interface ReconnectConfig {
  /** Reconnect özelliği aktif mi. */
  enabled: boolean
  /** İlk başarısızlıktan sonraki minimum bekleme (ms). */
  initialDelayMs: number
  /** Beklemenin tavan değeri (ms). */
  maxDelayMs: number
  /** Exponential artış çarpanı. */
  multiplier: number
  /** Rastgele oynatma (0..1 arası önerilir). */
  jitterRatio: number
  /** Maksimum attempt sayısı (opsiyonel, yoksa sınırsız). */
  maxAttempts?: number
}

/**
 * Zaman aşımı ayarları.
 */
export interface TimeoutsConfig {
  /** Bağlanma aşaması maksimum bekleme (ms). */
  connectTimeoutMs?: number
}

/**
 * Filtre fonksiyonları konfigürasyonu.
 * Dönen false, ilgili mesajın publish edilmesini engeller.
 */
export interface FilterConfig {
  /** Gelen mesaj filtreleyici. */
  inboundMessage?: (env: StanzaEnvelope) => boolean
  /** Giden mesaj filtreleyici. */
  outboundMessage?: (env: StanzaEnvelope) => boolean
}

/* -------------------------------------------------------------------------- */
/*                               METRIC MODEL                                 */

/* -------------------------------------------------------------------------- */

/**
 * Sağlık / performans metrikleri.
 */
export interface HealthMetrics {
  /** Başlangıç (manager oluşturulduğu an). */
  startTime: number
  /** Son başarılı bağlantı zamanı. */
  lastConnectedAt?: number
  /** Son kopma zamanı. */
  lastDisconnectedAt?: number
  /** Aktif oturum başlangıcı. */
  currentSessionStart?: number
  /** Toplam bağlı kalınan süre (ms). */
  totalUptimeMs: number
  /** Aktif oturum süresi (ms). */
  currentSessionUptimeMs: number
  /** Toplam başarılı bağlantı oturumu sayısı. */
  sessions: number
  /** Toplam reconnect attempt sayısı. */
  totalReconnectAttempts: number
  /** Başarılı reconnect sayısı. */
  successfulReconnects: number
  /** Art arda başarısızlık sayacı. */
  consecutiveFailures: number
  /** Toplam gelen stanza. */
  totalMessagesIn: number
  /** Toplam gönderilen stanza. */
  totalMessagesOut: number
  /** Ortalama oturum süresi (ms). */
  averageSessionDurationMs?: number
  /** En uzun oturum süresi (ms). */
  longestSessionDurationMs?: number
  /** Son oturum süresi (ms). */
  lastSessionDurationMs?: number

  /* --------------------------- Outbound Queue Kısmı -------------------------- */

  /** Kuyruğa alınan toplam öğe. */
  outboundQueued: number
  /** Düşürülen (capacity / policy / error) öğe sayısı. */
  outboundDropped: number
  /** TTL nedeniyle exp. edilen öğeler. */
  outboundExpired: number
  /** Retry planlanan öğe sayısı. */
  outboundRetried: number
  /** Giveup (retry limitine ulaşan) öğe sayısı. */
  outboundGiveups: number
  /** queue_full olayı toplam sayısı. */
  outboundQueueFullEvents: number
}

/**
 * Retry backoff fonksiyonuna sağlanan bağlam.
 */
export interface OutboundRetryContext {
  /** Kuyruk öğesi benzersiz kimlik. */
  id: string
  /** Şu ana kadar yapılmış deneme (1..maxAttempts-1 arası olur; schedule aşamasında artmış). */
  attempt: number
  /** Maksimum deneme sınırı. */
  maxAttempts: number
  /** Kuyruğa alınma zamanı (epoch ms). */
  enqueuedAt: number
  /** Kuyruğa alınma yaş (ms). */
  ageMs: number
  /** Öğenin önceliği (0 yüksek). */
  priority: number
}

/**
 * Outbound kuyruk davranış konfigürasyonu.
 */
export interface OutboundQueueConfig {
  /** Kuyruk açık mı. */
  enabled?: boolean
  /** Kapasite sınırı. */
  maxSize?: number
  /** Kapasite aşımında strateji. */
  dropStrategy?: 'drop-oldest' | 'drop-newest' | 'error'
  /** Her flush turunda maksimum gönderim (Infinity => sınırsız). */
  flushBatchSize?: number
  /** Batch turları arası bekleme. 0 => senkron/microtask. */
  flushIntervalMs?: number

  /* ------------------------------ TTL Yönetimi ------------------------------- */
  /** Global TTL (ms). 0 veya undefined => devre dışı. */
  ttlMs?: number
  /** TTL temizleme periyodu (ms). */
  expireCheckIntervalMs?: number

  /* ------------------------------ Retry Yönetimi ----------------------------- */
  /** Gönderim hatasında yeniden denensin mi. */
  retryFailedSends?: boolean
  /** Toplam maksimum attempt (attempt >= max => giveup). */
  maxSendRetries?: number
  /** İlk backoff tabanı (ms). */
  retryBackoffBaseMs?: number
  /** Exponential çarpan. */
  retryBackoffMultiplier?: number
  /** Jitter oranı (0..1). */
  retryJitterRatio?: number
  /**
   * Özel gecikme hesap fonksiyonu.
   * Negatif veya undefined dönerse default exponential+jitter kullanılır.
   */
  retryBackoffFn?: (attempt: number, item: OutboundRetryContext) => number

  /* -------------------------------- Priority -------------------------------- */
  /** Öncelik seviye sayısı (0..n-1). */
  priorities?: number
}

/**
 * Tek seferlik göndermeye özel opsiyonlar.
 */
export interface OutboundSendOptions {
  /** Mesaj önceliği (0 en yüksek). */
  priority?: number
  /** Özel max retry (default config üstüne yazar). */
  maxRetries?: number
  /** Mesaja özel TTL (ms). */
  ttlMs?: number
}

/* -------------------------------------------------------------------------- */
/*                               QUEUE EVENTS                                 */
/* -------------------------------------------------------------------------- */

/**
 * Kuyruk event türleri.
 */
export type OutboundQueueEventType =
  | 'queue_full'
  | 'dropped'
  | 'expired'
  | 'retry_scheduled'
  | 'retry_giveup'
  | 'giveup_stored'

/**
 * Kuyruk olay modeli.
 */
export interface OutboundQueueEvent {
  /** Olay tipi. */
  type: OutboundQueueEventType
  /** İlgili öğe id’si (yoksa 'n/a'). */
  itemId: string
  /** Unix epoch (ms). */
  timestamp: number
  /** Ek açıklayıcı detaylar. */
  detail?: Record<string, unknown>
}

/**
 * Aktif kuyruğun snapshot item modeli.
 */
export interface OutboundQueueSnapshotItem {
  /** Kuyruk item id. */
  id: string
  /** Öncelik (0 yüksek). */
  priority: number
  /** Şu ana kadarki deneme sayısı. */
  attempt: number
  /** Maksimum attempt sınırı. */
  maxAttempts: number
  /** Yaş (ms). */
  ageMs: number
  /** Efektif TTL (ms) (override veya global). */
  ttlMs?: number
  /** Kalan yaşam (ms). */
  expiresInMs?: number
  /** Bir sonraki gönderim denemesine kalan (retry) süre (ms). */
  nextEligibleInMs?: number
  /** Kuyruğa alınma zamanı ISO string. */
  queuedAt: string
}

/**
 * Aktif outbound queue snapshot.
 */
export interface OutboundQueueSnapshot {
  /** Toplam öğe sayısı. */
  size: number
  /** Öğeler. */
  items: OutboundQueueSnapshotItem[]
  /** Snapshot üretim zamanı (ISO). */
  generatedAt: string
}

/**
 * Retry limitini aşmış (giveup) öğelerin snapshot modeli.
 */
export interface GiveupQueueSnapshot {
  /** Giveup öğe sayısı. */
  size: number
  /** Giveup snapshot öğeleri. */
  items: OutboundQueueSnapshotItem[]
  /** Snapshot zamanı (ISO). */
  generatedAt: string
}

/* -------------------------------------------------------------------------- */
/*                                ROOT CONFIG                                 */

/* -------------------------------------------------------------------------- */

/**
 * XmppManager konfigürasyonu.
 */
export interface XmppConfig {
  /** XMPP servis URL (BOSH / WebSocket). */
  serviceUrl: string
  /** Kullanıcı JID (full ya da bare). */
  jid: string
  /** Kimlik doğrulama parolası / token. */
  password: string
  /** Reconnect ayarları. */
  reconnect: ReconnectConfig
  /** Timeout ayarları. */
  timeouts?: TimeoutsConfig
  /** Filtre fonksiyonları. */
  filters?: FilterConfig
  /** Debug log (verbose) aç/kapat. */
  debugMode?: boolean
  /** Harici logger (tslog). */
  logger?: Logger<ILogObj>
  /** Logger opsiyonları (kendi logger oluşturulurken). */
  loggerOptions?: ISettingsParam<ILogObj>
  /** metrics$ yayınına auditTime throttling ms (0 => yok). */
  metricsThrottleMs?: number
  /** OutboundQueue ayarları. */
  outboundQueue?: OutboundQueueConfig
}

/* -------------------------------------------------------------------------- */
/*                                METRIC SINK                                 */

/* -------------------------------------------------------------------------- */

/**
 * Kuyruğun metrik güncellemek için kullandığı basit arayüz.
 */
export interface IQueueMetricsSink {
  /**
   * Belirtilen metrik alanını (numeric) arttır.
   * @param key HealthMetrics numeric alan adı.
   * @param inc Artış miktarı (varsayılan 1).
   */
  bump(key: keyof HealthMetrics, inc?: number): void

  /**
   * Mevcut metrik snapshot'ını döndür.
   */
  getMetrics(): HealthMetrics
}

/* -------------------------------------------------------------------------- */
/*                            PUBLIC MANAGER API                              */

/* -------------------------------------------------------------------------- */

/**
 * XmppManager dış arayüzü.
 */
export interface IXmppConnectionManager {
  /** Bağlantı durum akışı. */
  readonly connectionState$: Observable<ConnectionStateInfo>
  /** Hata akışı. */
  readonly error$: Observable<XmppErrorEvent>
  /** Gelen mesaj akışı. */
  readonly inboundMessage$: Observable<StanzaEnvelope>
  /** Giden mesaj akışı. */
  readonly outboundMessage$: Observable<StanzaEnvelope>
  /** Sağlık metrik akışı. */
  readonly metrics$: Observable<HealthMetrics>
  /** Outbound queue event akışı. */
  readonly outboundQueueEvents$: Observable<OutboundQueueEvent>

  /**
   * Bağlantıyı başlatır (idempotent).
   */
  connect(): Promise<void>

  /**
   * Bağlantıyı sonlandırır.
   * @param reconnect true ise hemen yeniden bağlanma sürecini tetikler.
   */
  disconnect(reconnect?: boolean): Promise<void>

  /**
   * Ham XML gönderir (bağlı değilse kuyruğa alınır).
   * @param xml XML stanza string
   * @param options Kuyruk / retry / TTL parametreleri
   */
  sendRaw(xml: string, options?: OutboundSendOptions): void

  /**
   * DOM Element stanza gönderir (bağlı değilse kuyruğa alınır).
   * @param element Stanza element
   * @param options Kuyruk opsiyonları
   */
  sendElement(element: Element, options?: OutboundSendOptions): void

  /**
   * Manuel ağ durumu bildirir (online/offline).
   * @param isOnline Ağ online mı.
   */
  setNetworkStatus(isOnline: boolean): void

  /**
   * Anlık bağlantı durumu snapshot.
   */
  getCurrentState(): ConnectionStateInfo

  /**
   * Kullanılan konfigürasyon (immutable).
   */
  getConfig(): XmppConfig

  /**
   * Metrik snapshot'ı.
   */
  getMetrics(): HealthMetrics

  /**
   * Metrikleri sıfırlar.
   */
  resetMetrics(): void

  /**
   * Aktif outbound kuyruk boyutu.
   */
  getOutboundQueueSize(): number

  /**
   * Aktif outbound kuyruğunu temizler.
   */
  clearOutboundQueue(): void

  /**
   * Aktif outbound queue snapshot'ı alınır.
   */
  getOutboundQueueSnapshot(): OutboundQueueSnapshot

  /**
   * Giveup queue snapshot'ı alınır.
   */
  getGiveupQueueSnapshot(): GiveupQueueSnapshot

  /**
   * Giveup kuyruğunu temizler.
   */
  clearGiveupQueue(): void
}
