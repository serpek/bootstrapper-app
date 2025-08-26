import { Observable } from 'rxjs'
import { ILogObj, ISettingsParam, Logger } from 'tslog'

import { IServiceWrapper } from '@bipweb/core'

/**
 * Temel network türleri.
 */
export type NetworkType = 'wifi' | 'cellular' | 'ethernet' | 'unknown'
export type NetworkStatus = 'online' | 'offline'

/**
 * Tarayıcı NetworkInformation API verilerinin normalize edilmiş sürümü.
 * downlink değeri spec'te Mbps (megabit/s) -> burada MB/s için /8 dönüştürüldü.
 */
export interface NetworkInfo {
  type: NetworkType
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g' | '5g' | 'unknown'
  downlinkMBps: number
  rtt: number
}

/**
 * Electron (veya başka dış sağlayıcı) üzerinden gelen zenginleştirilmiş bilgi.
 * Tümü opsiyonel alanlar.
 */
export interface ElectronNetworkAugmentedInfo {
  platform?: string
  hostname?: string
  interfaces?: Array<{
    name: string
    address: string
    family?: string
    mac?: string
    internal?: boolean
    up?: boolean
    speedMbps?: number
  }>
  activeInterfaceName?: string
  avgPingMs?: number
  dnsLookupMs?: number
  packetLossPercent?: number
  captivePortalSuspected?: boolean
  rawSamples?: number
  offlineConfidence?: number
  onlineConfidence?: number
  lastSampleTs?: number
  extra?: Record<string, unknown>
}

/**
 * Hata türü sınıflandırması.
 */
export type NetworkErrorKind =
  | 'timeout'
  | 'abort'
  | 'http-error'
  | 'network-error'
  | 'skipped-rate-limit'
  | 'unreachable'
  | 'other'

/**
 * Health check sırasında yayılan hata olayı.
 */
export interface NetworkErrorEvent {
  error: unknown
  attempt: number
  isFinal: boolean
  timestamp: number
  reason: string
  kind: NetworkErrorKind
  httpStatus?: number
  urlTried?: string
}

/**
 * Kaynak (browser/electron) snapshot'ı.
 */
export interface SourceStatusSnapshot {
  status: NetworkStatus
  timestamp: number
  confidence?: number
  provider?: 'browser' | 'electron' | string
}

/**
 * Metrikler.
 */
export interface NetworkMetrics {
  totalChecks: number
  successfulChecks: number
  failedChecks: number
  skippedChecks: number
  totalUrlsTried: number
  consecutiveFailures: number
  currentIntervalMs: number
  lastSuccessTs?: number
  lastFailureTs?: number
  totalOnlineDurationMs: number
  totalOfflineDurationMs: number
  currentStatusDurationMs: number
  prevStatusDurationMs: number
  statusLastChangedTs: number
  averageRttMs?: number
  minRttMs?: number
  maxRttMs?: number
  totalTransitions: number
  flapCountWindow: number
  flapCountTotal: number
  isFlapping: boolean
  onlineSinceTs?: number
  offlineSinceTs?: number
  electronUpdateCount: number
  lastElectronUpdateTs?: number
  lastElectronLatencyMs?: number
  electronOfflineConfidence?: number
  electronOnlineConfidence?: number
  providerDominance?: 'browser' | 'electron' | 'merged'
}

/**
 * Durum değişim olayı.
 */
export interface NetworkChangeEvent {
  status: NetworkStatus
  network: NetworkInfo
  eventIndex: number
  retryIndex: number
  timestamp: number
  isFlapping: boolean
  flapCount: number
  reason: string
  metrics?: NetworkMetrics
  sources: {
    browser: SourceStatusSnapshot
    electron?: SourceStatusSnapshot & {
      augmented?: ElectronNetworkAugmentedInfo
    }
  }
  compositeStatusReason: string
}

/**
 * Harici sağlayıcı update payload.
 */
export interface ExternalProviderUpdate {
  provider: string
  status: NetworkStatus
  confidence?: number
  augmentedInfo?: ElectronNetworkAugmentedInfo
  latencyMs?: number
  timestamp: number
  reason?: string
}

/**
 * internal health check sonucu
 */
export interface InternalCheckResult {
  ok: boolean
  url?: string
  rttMs?: number
  statusCode?: number
  error?: unknown
  errorKind?: NetworkErrorKind
}

/**
 * Electron entegrasyonu konfigürasyonu.
 */
export interface ElectronIntegrationConfig {
  enabled?: boolean
  providerPrecedence?: 'electron-first' | 'browser-first' | 'merge'
  strategy?: 'conservative' | 'optimistic'
  publishChannel?: string
  requestChannel?: string
  overrideOfflineConfidenceThreshold?: number
  overrideOnlineConfidenceThreshold?: number
}

/**
 * Ana konfigürasyon.
 */
export interface NetworkChangeDetectorConfig {
  primaryUrl?: string
  checkUrls?: string[]
  preferHead?: boolean
  requestTimeoutMs?: number
  baseIntervalMs?: number
  maxIntervalMs?: number
  maxRetries?: number
  retryBackoffFactor?: number
  initialRetryDelayMs?: number
  maxRetryDelayMs?: number
  flapWindowMs?: number
  flapThreshold?: number
  maxChecksPerHour?: number
  accelerateOnFlap?: boolean
  healthPath?: string
  degradedGrowthFactor?: number
  offlineInitialIntervalMultiplier?: number
  includeMetricsInEvents?: boolean
  ewmaAlpha?: number
  autoStart?: boolean
  fetchFn?: typeof fetch
  timeProvider?: () => number
  onlineAccelerationFactor?: number
  electronIntegration?: ElectronIntegrationConfig
  /**
   * Status değişmemiş olsa bile (browser/electron update vs) event üret.
   * Varsayılan false (yalnızca status değişince event).
   */
  eventOnUnchangedStatus?: boolean
  /**
   * eventOnUnchangedStatus true ise bu durumda eventIndex artışı (varsayılan false).
   */
  incrementEventOnUnchangedStatus?: boolean
  /**
   * Dışarıdan logger sağlanmazsa loggerOptions ile tslog konfigüre edilir.
   */
  loggerOptions?: ISettingsParam<ILogObj>
  logger?: Logger<ILogObj>
}

export interface INetworkChangeDetector extends IServiceWrapper {
  configure(config: NetworkChangeDetectorConfig): void

  /**
   * Servisi başlatır.
   */
  start(): Promise<void>

  /**
   * Servisi durdurur ve stream'leri complete eder.
   */
  stop(): void

  /**
   * Sağlık check döngüsünü geçici duraklatır (manual checkNow yine çalışır).
   */
  pause(): void

  /**
   * pause sonrası devam.
   */
  resume(): void

  /**
   * Status değişim event akışı (ReplaySubject(1)).
   */
  onNetworkChange(): Observable<NetworkChangeEvent>

  onNetworkChangeOnce(): Observable<NetworkChangeEvent>

  /**
   * Hata event akışı.
   */
  onError(): Observable<NetworkErrorEvent>

  /**
   * Manuel anlık health check (rate limit kontrolü yapılır).
   */
  checkNow(): Promise<void>

  /**
   * Son composite status.
   */
  getStatus(): NetworkStatus

  /**
   * Mevcut network info (tarayıcı).
   */
  getNetworkInfo(): NetworkInfo

  /**
   * Metrik snapshot.
   */
  getMetrics(): NetworkMetrics

  /**
   * Flapping var mı.
   */
  isFlapping(): boolean

  /**
   * Electron update simülasyonu (test).
   */
  simulateElectronUpdate(update: ExternalProviderUpdate): void

  /**
   * Metrikleri resetler. Varsayılan davranış: her şeyi sıfırla fakat
   * current status süre ölçerleri yeniden başlatılır.
   * Seçenekler ile RTT veya sayaçların korunması sağlanabilir.
   */
  resetMetrics(options?: {
    preserveRtt?: boolean
    preserveCounts?: boolean
  }): void
}
