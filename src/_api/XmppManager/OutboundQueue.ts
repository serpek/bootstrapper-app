/* JSDoc eklenmiş sürüm (tamamı) */
import { Observable, Subject } from 'rxjs'
import { ILogObj, Logger } from 'tslog'

import {
  GiveupQueueSnapshot,
  IQueueMetricsSink,
  OutboundQueueConfig,
  OutboundQueueEvent,
  OutboundQueueSnapshot,
  OutboundQueueSnapshotItem,
  OutboundRetryContext,
  OutboundSendOptions
} from './types'

/**
 * İç kuyruk elemanı temsilcisi.
 */
interface QueueItem {
  id: string
  element: Element
  raw?: string
  enqueuedAt: number
  priority: number // 0 en yüksek
  attempt: number // gönderim denemesi sayısı (retry dahil)
  maxAttempts: number
  nextEligibleSendAt?: number // retry backoff zamanı
  ttlOverrideMs?: number
}

/**
 * Normalize (varsayılanları set edilmiş) kuyruk konfigürasyonu.
 */
interface NormalizedCfg {
  enabled: boolean
  maxSize: number
  dropStrategy: 'drop-oldest' | 'drop-newest' | 'error'
  flushBatchSize: number
  flushIntervalMs: number
  ttlMs: number
  expireCheckIntervalMs: number
  retryFailedSends: boolean
  maxSendRetries: number
  retryBackoffBaseMs: number
  retryBackoffMultiplier: number
  retryJitterRatio: number
  retryBackoffFn?: (attempt: number, ctx: OutboundRetryContext) => number
  priorities: number
}

let GLOBAL_QUEUE_ID = 0

/**
 * Benzersiz kuyruk öğesi id üretir.
 */
function genId(): string {
  GLOBAL_QUEUE_ID += 1
  return 'oq_' + GLOBAL_QUEUE_ID
}

/**
 * OutboundQueue bağımlılıkları (DI).
 */
export interface OutboundQueueDeps {
  /** Opsiyonel konfigürasyon. */
  config?: OutboundQueueConfig
  /** Log çıktısı için logger. */
  logger: Logger<ILogObj>
  /** Metrik güncelleme sink'i. */
  metrics: IQueueMetricsSink
  /** Bağlantı hazır mı (flush koşulu). */
  isConnected: () => boolean
  /**
   * Gerçek gönderim fonksiyonu. Hata fırlatırsa retry devreye girer.
   * @throws Error gönderim hatası durumunda
   */
  sendFn: (el: Element) => void
}

/**
 * Mesaj kuyruğunu yöneten, retry / TTL / priority / snapshot / giveup işlevlerini kapsülleyen sınıf.
 *
 * Not: Bağlantı durumunu kendi izlemez; `onConnected()` / `onDisconnected()` ile bilgilendirilir.
 */
export class OutboundQueue {
  private readonly cfg: NormalizedCfg
  private readonly logger: Logger<ILogObj>
  private readonly metrics: IQueueMetricsSink
  private readonly isConnectedFn: () => boolean
  private readonly sendFn: (el: Element) => void

  private items: QueueItem[] = []
  private giveup: QueueItem[] = []
  private flushing = false
  private expireTimer?: ReturnType<typeof setInterval>

  private readonly eventsSubject = new Subject<OutboundQueueEvent>()
  /**
   * Kuyruk event akışı (queue_full, dropped, expired, retry_scheduled, retry_giveup, giveup_stored).
   */
  public readonly events$: Observable<OutboundQueueEvent> =
    this.eventsSubject.asObservable()

  /**
   * Yeni OutboundQueue örneği oluşturur.
   * @param deps Bağımlılık nesnesi
   */
  constructor(deps: OutboundQueueDeps) {
    this.logger = deps.logger
    this.metrics = deps.metrics
    this.isConnectedFn = deps.isConnected
    this.sendFn = deps.sendFn
    this.cfg = this.normalize(deps.config)
    this.setupExpireTimer()
  }

  /* ------------------------------------------------------------------------ */
  /*                                PUBLIC API                                */

  /* ------------------------------------------------------------------------ */

  /**
   * Event observable (alias).
   */
  get events(): Observable<OutboundQueueEvent> {
    return this.events$
  }

  /**
   * Mesajı kuyruklar.
   * @param element XMPP stanza element
   * @param raw Orijinal raw XML (opsiyonel)
   * @param options Mesaj bazlı kuyruk ayarları
   * @param initialAttempt Dakota: direct send hatası sonrası yeniden ekleme gibi özel senaryolar
   */
  enqueue(
    element: Element,
    raw?: string,
    options?: OutboundSendOptions,
    initialAttempt = 0
  ): void {
    if (!this.cfg.enabled) {
      this.emitDropped(undefined, 'queue_disabled')
      return
    }
    let priority = options?.priority ?? 1
    if (priority < 0) priority = 0
    if (priority >= this.cfg.priorities) priority = this.cfg.priorities - 1

    const maxAttempts = options?.maxRetries
      ? Math.max(1, options.maxRetries)
      : this.cfg.maxSendRetries

    if (this.items.length >= this.cfg.maxSize) {
      this.handleFull(element, raw, priority, maxAttempts, options)
      return
    }

    const item: QueueItem = {
      id: genId(),
      element,
      raw,
      enqueuedAt: Date.now(),
      priority,
      attempt: initialAttempt,
      maxAttempts,
      ttlOverrideMs:
        options?.ttlMs && options.ttlMs > 0 ? options.ttlMs : undefined
    }

    this.insert(item)
    this.metrics.bump('outboundQueued', 1)
    this.logger.trace('Queue: enqueued', {
      id: item.id,
      size: this.items.length,
      pr: item.priority,
      ttlOverride: item.ttlOverrideMs
    })
  }

  /**
   * Koşullar uygunsa flush sürecini başlatır (bağlantı + kuyruk dolu + halen flush edilmemiş).
   */
  flushIfPossible(): void {
    if (
      !this.cfg.enabled ||
      !this.isConnectedFn() ||
      this.flushing ||
      this.items.length === 0
    )
      return
    this.flushing = true
    const runBatch = () => {
      if (!this.isConnectedFn()) {
        this.flushing = false
        return
      }
      const now = Date.now()
      let sentInBatch = 0
      while (
        sentInBatch < this.cfg.flushBatchSize &&
        this.items.length > 0 &&
        this.isConnectedFn()
      ) {
        const item = this.items[0]
        // Retry bekleme penceresi
        if (item.nextEligibleSendAt && item.nextEligibleSendAt > now) break
        // TTL kontrol
        if (this.isExpired(item, now)) {
          this.items.shift()
          this.metrics.bump('outboundExpired', 1)
          this.emitEvent('expired', item.id, { during: 'flush' })
          continue
        }
        try {
          this.sendFn(item.element)
          this.items.shift()
          sentInBatch++
        } catch (err) {
          if (!this.scheduleRetry(item, err)) {
            this.items.shift()
          } else {
            this.items.sort(queueSort)
            if (this.items[0] === item) break
          }
        }
      }
      if (this.items.length > 0 && this.isConnectedFn()) {
        if (this.cfg.flushIntervalMs > 0)
          setTimeout(runBatch, this.cfg.flushIntervalMs)
        else queueMicrotask(runBatch)
      } else {
        this.flushing = false
        if (this.items.length === 0) this.logger.info('Queue: flush complete')
      }
    }
    runBatch()
  }

  /**
   * Bağlantı sağlanınca çağrılmalı (expire + flush tetikler).
   */
  onConnected(): void {
    this.expireOld()
    this.flushIfPossible()
  }

  /**
   * Bağlantı kesilince çağrılabilir (şu an no-op).
   */
  onDisconnected(): void {
    /* no-op */
  }

  /**
   * Aktif kuyruk boyutu.
   */
  getSize(): number {
    return this.items.length
  }

  /**
   * Aktif kuyruğu temizler.
   */
  clear(): void {
    const removed = this.items.length
    this.items.length = 0
    this.logger.info('Queue: cleared', { removed })
  }

  /**
   * Aktif kuyruk snapshot'ını üretir.
   */
  getSnapshot(): OutboundQueueSnapshot {
    const now = Date.now()
    return {
      size: this.items.length,
      items: this.items.map((it) => this.snapshotItem(it, now)),
      generatedAt: new Date(now).toISOString()
    }
  }

  /**
   * Giveup kuyruğu snapshot'ı.
   */
  getGiveupSnapshot(): GiveupQueueSnapshot {
    const now = Date.now()
    return {
      size: this.giveup.length,
      items: this.giveup.map((it) => this.snapshotItem(it, now)),
      generatedAt: new Date(now).toISOString()
    }
  }

  /**
   * Giveup kuyruğunu temizler.
   */
  clearGiveup(): void {
    const c = this.giveup.length
    this.giveup.length = 0
    this.logger.info('Queue: giveup cleared', { c })
  }

  /**
   * Kaynakları (interval + subject) serbest bırakır.
   */
  dispose(): void {
    if (this.expireTimer) {
      clearInterval(this.expireTimer)
      this.expireTimer = undefined
    }
    this.eventsSubject.complete()
  }

  /* ------------------------------------------------------------------------ */
  /*                              INTERNAL (PRIVATE)                          */

  /* ------------------------------------------------------------------------ */

  /**
   * Konfigürasyon normalize eder (varsayılanları uygular).
   */
  private normalize(c?: OutboundQueueConfig): NormalizedCfg {
    const q = c || {}
    return {
      enabled: q.enabled !== false,
      maxSize: q.maxSize ?? 500,
      dropStrategy: q.dropStrategy ?? 'drop-oldest',
      flushBatchSize: q.flushBatchSize ?? Number.POSITIVE_INFINITY,
      flushIntervalMs: q.flushIntervalMs ?? 0,
      ttlMs: q.ttlMs ?? 0,
      expireCheckIntervalMs: q.expireCheckIntervalMs ?? 10000,
      retryFailedSends: q.retryFailedSends !== false,
      maxSendRetries: q.maxSendRetries ?? 3,
      retryBackoffBaseMs: q.retryBackoffBaseMs ?? 500,
      retryBackoffMultiplier: q.retryBackoffMultiplier ?? 2,
      retryJitterRatio: q.retryJitterRatio ?? 0.2,
      retryBackoffFn: q.retryBackoffFn,
      priorities: q.priorities ?? 3
    }
  }

  /**
   * Öğeyi sıralı yapıya ekler.
   */
  private insert(item: QueueItem): void {
    this.items.push(item)
    this.items.sort(queueSort)
  }

  /**
   * Kapasite aşımında strateji uygular.
   */
  private handleFull(
    element: Element,
    raw: string | undefined,
    priority: number,
    maxAttempts: number,
    options?: OutboundSendOptions
  ): void {
    this.metrics.bump('outboundQueueFullEvents', 1)
    this.emitEvent('queue_full', 'n/a', { size: this.items.length })
    switch (this.cfg.dropStrategy) {
      case 'drop-oldest': {
        const dropped = this.items.shift()
        if (dropped) {
          this.metrics.bump('outboundDropped', 1)
          this.emitEvent('dropped', dropped.id, { reason: 'drop-oldest' })
        }
        const item: QueueItem = {
          id: genId(),
          element,
          raw,
          enqueuedAt: Date.now(),
          priority,
          attempt: 0,
          maxAttempts,
          ttlOverrideMs:
            options?.ttlMs && options.ttlMs > 0 ? options.ttlMs : undefined
        }
        this.insert(item)
        this.metrics.bump('outboundQueued', 1)
        break
      }
      case 'drop-newest':
        this.metrics.bump('outboundDropped', 1)
        this.emitEvent('dropped', 'new_item', { reason: 'drop-newest' })
        break
      case 'error':
      default:
        this.metrics.bump('outboundDropped', 1)
        this.emitDropped(undefined, 'queue_full_error')
    }
  }

  /**
   * Gönderim hatasında retry planlar veya giveup uygular.
   * @returns true => retry planlandı, false => item kesin kaldırılmalı
   */
  private scheduleRetry(item: QueueItem, error: any): boolean {
    if (!this.cfg.retryFailedSends) {
      this.metrics.bump('outboundDropped', 1)
      this.emitEvent('dropped', item.id, {
        reason: 'send_error_no_retry',
        error: this.errDesc(error)
      })
      return false
    }
    item.attempt += 1
    if (item.attempt >= item.maxAttempts) {
      this.metrics.bump('outboundGiveups', 1)
      this.emitEvent('retry_giveup', item.id, {
        attempts: item.attempt,
        error: this.errDesc(error)
      })
      this.giveup.push(item)
      this.emitEvent('giveup_stored', item.id, { size: this.giveup.length })
      return false
    }

    let delay: number | undefined
    if (this.cfg.retryBackoffFn) {
      const ctx: OutboundRetryContext = {
        id: item.id,
        attempt: item.attempt,
        maxAttempts: item.maxAttempts,
        enqueuedAt: item.enqueuedAt,
        ageMs: Date.now() - item.enqueuedAt,
        priority: item.priority
      }
      try {
        delay = this.cfg.retryBackoffFn(item.attempt, ctx)
      } catch (e) {
        this.logger.warn('Queue: custom retryBackoffFn error, fallback', {
          err: this.errDesc(e)
        })
      }
    }
    if (delay == null || delay < 0) {
      const base =
        this.cfg.retryBackoffBaseMs *
        Math.pow(this.cfg.retryBackoffMultiplier, item.attempt - 1)
      const jitter = base * this.cfg.retryJitterRatio
      delay = base + (Math.random() * 2 - 1) * jitter
    }
    item.nextEligibleSendAt = Date.now() + Math.max(0, Math.round(delay))
    this.metrics.bump('outboundRetried', 1)
    this.emitEvent('retry_scheduled', item.id, {
      attempt: item.attempt,
      delayMs: delay
    })
    this.items.sort(queueSort)
    return true
  }

  /**
   * Öğenin TTL süresinin dolup dolmadığını kontrol eder.
   */
  private isExpired(item: QueueItem, now: number): boolean {
    const ttl =
      item.ttlOverrideMs && item.ttlOverrideMs > 0
        ? item.ttlOverrideMs
        : this.cfg.ttlMs
    if (!ttl || ttl <= 0) return false
    return now - item.enqueuedAt > ttl
  }

  /**
   * TTL timer kurulumunu yapar.
   */
  private setupExpireTimer(): void {
    if (!this.cfg.ttlMs || this.cfg.ttlMs <= 0) return
    this.expireTimer = setInterval(
      () => this.expireOld(),
      this.cfg.expireCheckIntervalMs
    )
  }

  /**
   * Süresi dolmuş (TTL) öğeleri temizler.
   */
  private expireOld(): void {
    if (!this.cfg.ttlMs || this.cfg.ttlMs <= 0) return
    const now = Date.now()
    let expired = 0
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.isExpired(this.items[i], now)) {
        const it = this.items.splice(i, 1)[0]
        expired++
        this.emitEvent('expired', it.id, { during: 'periodic' })
      }
    }
    if (expired > 0) {
      this.metrics.bump('outboundExpired', expired)
      this.logger.warn('Queue: TTL expired messages', { expired })
    }
  }

  /**
   * Snapshot item modeli üretir.
   */
  private snapshotItem(it: QueueItem, now: number): OutboundQueueSnapshotItem {
    const ageMs = now - it.enqueuedAt
    const baseTtl =
      it.ttlOverrideMs && it.ttlOverrideMs > 0
        ? it.ttlOverrideMs
        : this.cfg.ttlMs > 0
          ? this.cfg.ttlMs
          : undefined
    const expiresInMs = baseTtl ? Math.max(0, baseTtl - ageMs) : undefined
    const nextEligibleInMs =
      it.nextEligibleSendAt && it.nextEligibleSendAt > now
        ? it.nextEligibleSendAt - now
        : undefined
    return {
      id: it.id,
      priority: it.priority,
      attempt: it.attempt,
      maxAttempts: it.maxAttempts,
      ageMs,
      ttlMs: baseTtl,
      expiresInMs,
      nextEligibleInMs,
      queuedAt: new Date(it.enqueuedAt).toISOString()
    }
  }

  /**
   * Event yayınlar.
   */
  private emitEvent(
    type: OutboundQueueEvent['type'],
    itemId: string,
    detail?: Record<string, unknown>
  ): void {
    this.eventsSubject.next({
      type,
      itemId,
      timestamp: Date.now(),
      detail
    })
  }

  /**
   * Düşürme (drop) event’i üretir.
   */
  private emitDropped(itemId: string | undefined, reason: string): void {
    this.emitEvent('dropped', itemId || 'n/a', { reason })
  }

  /**
   * Hata nesnesini sadeleştirilmiş objeye çevirir.
   */
  private errDesc(e: any): Record<string, unknown> {
    if (e instanceof Error) return { message: e.message, name: e.name }
    return { value: String(e) }
  }
}

/**
 * Kuyruk sıralaması fonksiyonu:
 * 1. priority (asc)
 * 2. nextEligibleSendAt (asc)
 * 3. enqueuedAt (asc)
 */
function queueSort(a: QueueItem, b: QueueItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  const na = a.nextEligibleSendAt || 0
  const nb = b.nextEligibleSendAt || 0
  if (na !== nb) return na - nb
  return a.enqueuedAt - b.enqueuedAt
}
