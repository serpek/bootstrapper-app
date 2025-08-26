# XMPP Manager & Outbound Queue

Modern, reaktif ve genişletilebilir bir XMPP bağlantı yöneticisi.  
`XmppManager` bağlantı yaşam döngüsünü ve temel metrikleri yönetir, `OutboundQueue` ise bağlantı hazır değilken veya geçici gönderim hatalarında mesajları kuyruklayıp yeniden
dener.

---

## İçindekiler

- [Özellikler](#özellikler)
- [Kurulum](#kurulum)
- [Temel Kullanım](#temel-kullanım)
- [Outbound Queue Konfigürasyonu](#outbound-queue-konfigürasyonu)
- [Custom Backoff Örneği](#custom-backoff-örneği)
- [Queue Event Tipleri](#queue-event-tipleri)
- [Snapshot Kullanımı](#snapshot-kullanımı)
- [Metrik Alanları](#metrik-alanları)
- [Manual Ağ Durumu](#gelişmiş-örnek-manual-ağ-durumu)
- [JSDoc Referansı ve Örnekleri](#jsdoc-referansı-ve-örnekleri)
    - [Fonksiyon Örneği](#fonksiyon-örneği)
    - [Arayüz Örneği](#arayüz-örneği)
    - [JSDoc İpuçları](#jsdoc-ipuçları)
- [Mimari Notlar](#mimari-notlar)
- [Genişletme Önerileri](#genişletme-önerileri)
- [Lisans](#lisans)

---

## Özellikler

### Bağlantı Yönetimi

- Strophe tabanlı XMPP bağlantısı
- Durum yayını (`connectionState$`)
- Otomatik yeniden bağlanma (exponential + jitter backoff)
- Manuel ağ (online/offline) bildirme
- Zaman aşımı (connect timeout)

### Outbound Queue

- Öncelik (0 = en yüksek)
- Sınırlandırılmış kapasite + düşürme stratejileri:
    - `drop-oldest`
    - `drop-newest`
    - `error`
- Mesaj bazlı TTL override + global TTL
- Periyodik TTL temizleme
- Retry (exponential+jitter) veya opsiyonel custom `retryBackoffFn`
- Maks deneme (`maxSendRetries`)
- Backoff parametreleri (base, multiplier, jitter)
- Giveup (tükenmiş retry) kuyruğu & snapshot
- Queue event akışı (`outboundQueueEvents$`)
- Priority + backoff sıralı flush
- Snapshot API (aktif & giveup)

### Metrikler

`metrics$` (isteğe bağlı throttle) üzerinden:

- Bağlantı süreleri, oturum sayıları
- Reconnect deneme / başarı sayıları
- Mesaj giriş / çıkış toplamları
- Kuyruk: queued, dropped, expired, retried, giveups, queueFullEvents

### Genişletilebilirlik

- Queue bağımsız sınıf (DI ile)
- Metrics sink arayüzü (`IQueueMetricsSink`)
- Kolay test edilebilir
- Sub-logger ile ayrıştırılmış log çıktısı

---

## Kurulum

```bash
npm install strophe.js tslog rxjs
```

> TypeScript yapılandırmanızda `dom` lib’inin (DOMParser/Element) bulunduğundan emin olun.

---

## Temel Kullanım

```ts
import {XmppManager} from './src/xmpp';

const manager = new XmppManager({
    serviceUrl: 'wss://xmpp.example.com/ws',
    jid: 'user@example.com',
    password: 'secret',
    reconnect: {
        enabled: true,
        initialDelayMs: 500,
        maxDelayMs: 30_000,
        multiplier: 2,
        jitterRatio: 0.2,
        maxAttempts: 20
    },
    outboundQueue: {
        maxSize: 1000,
        dropStrategy: 'drop-oldest',
        priorities: 4,
        ttlMs: 60_000,
        retryFailedSends: true,
        maxSendRetries: 5,
        retryBackoffBaseMs: 400,
        retryBackoffMultiplier: 2,
        retryJitterRatio: 0.25
    },
    metricsThrottleMs: 5000,
    debugMode: false
});

manager.connectionState$.subscribe(s => console.log('STATE', s));
manager.metrics$.subscribe(m => console.log('METRICS (throttled)', m));
manager.outboundQueueEvents$.subscribe(e => console.log('QUEUE EVT', e));

await manager.connect();

// Bağlantı yoksa veya retry gerekiyorsa otomatik kuyruklanır
manager.sendRaw('<message to="peer@example.com"><body>Selam</body></message>');

// Mesaj bazlı TTL & priority & max retry
manager.sendRaw('<message ...>Öncelikli</message>', {
    priority: 0,
    ttlMs: 15_000,
    maxRetries: 7
});
```

---

## Outbound Queue Konfigürasyonu

| Alan                   | Tip     | Varsayılan  | Açıklama                     |
|------------------------|---------|-------------|------------------------------|
| enabled                | boolean | true        | Kuyruğu aktif eder           |
| maxSize                | number  | 500         | Maksimum kuyruk kapasitesi   |
| dropStrategy           | enum    | drop-oldest | Kapasite aşımında davranış   |
| flushBatchSize         | number  | Infinity    | Her flush turunda max mesaj  |
| flushIntervalMs        | number  | 0           | Batch turları arası bekleme  |
| ttlMs                  | number  | 0           | Global TTL (0 => devre dışı) |
| expireCheckIntervalMs  | number  | 10000       | TTL temizlik sıklığı         |
| retryFailedSends       | boolean | true        | Gönderim hatalarında retry   |
| maxSendRetries         | number  | 3           | attempt >= max => giveup     |
| retryBackoffBaseMs     | number  | 500         | İlk backoff tabanı           |
| retryBackoffMultiplier | number  | 2           | Exponential çarpan           |
| retryJitterRatio       | number  | 0.2         | Jitter (+/-) oranı           |
| retryBackoffFn         | fn      | yok         | Custom gecikme hesaplama     |
| priorities             | number  | 3           | 0..n-1 öncelik seviyesi      |

---

## Custom Backoff Örneği

```ts
outboundQueue: {
    retryBackoffFn: (attempt, ctx) => {
        // lineer + priority etkisi
        return 300 * attempt + ctx.priority * 100;
    }
}
```

> Geri dönen değer `undefined` veya `< 0` ise varsayılan exponential+jitter backoff kullanılır.

---

## Queue Event Tipleri

| Tip             | Açıklama                                     |
|-----------------|----------------------------------------------|
| queue_full      | Kapasite aşıldı (drop stratejisi tetiklenir) |
| dropped         | Mesaj düşürüldü                              |
| expired         | TTL sebebiyle çıkarıldı                      |
| retry_scheduled | Retry planlandı                              |
| retry_giveup    | Max deneme aşıldı                            |
| giveup_stored   | Giveup kuyruğuna alındı                      |

---

## Snapshot Kullanımı

```ts
const active = manager.getOutboundQueueSnapshot();
const giveups = manager.getGiveupQueueSnapshot();
console.log(active.items.length, giveups.items.length);
manager.clearGiveupQueue();
```

---

## Metrik Alanları

| Alan                    | Açıklama                        |
|-------------------------|---------------------------------|
| totalUptimeMs           | Toplam bağlı kalınan süre       |
| sessions                | Başarılı bağlantı oturum sayısı |
| totalReconnectAttempts  | Reconnect girişimleri           |
| successfulReconnects    | Başarılı reconnect sayısı       |
| totalMessagesIn / Out   | Toplam gelen / giden stanza     |
| outboundQueued          | Kuyruğa alınan toplam           |
| outboundDropped         | Düşürülen mesajlar              |
| outboundExpired         | TTL nedeniyle silinen           |
| outboundRetried         | Planlanan retry sayısı          |
| outboundGiveups         | Giveup edilen mesajlar          |
| outboundQueueFullEvents | Kapasite aşım sayısı            |

---

## Gelişmiş Örnek: Manual Ağ Durumu

```ts
window.addEventListener('offline', () => manager.setNetworkStatus(false));
window.addEventListener('online', () => manager.setNetworkStatus(true));
```

---

## JSDoc Referansı ve Örnekleri

Kaynak kodda tüm public metotlar, önemli internal yardımcılar ve tipler JSDoc ile açıklanmıştır.  
Aşağıda stil kılavuzu niteliğinde kısa örnekler bulunmaktadır.

### Fonksiyon Örneği

```ts
/**
 * Ham XML gönderir (bağlı değilse kuyruk).
 * @param xml String stanza
 * @param options Kuyruk opsiyonları
 * @throws Parse hatası durumunda error stream'e yazar
 */
sendRaw(xml
:
string, options ? : OutboundSendOptions
):
void;
```

### Arayüz Örneği

```ts
/**
 * Sağlık / performans metrikleri.
 */
export interface HealthMetrics {
    /** Toplam bağlı kalınan süre (ms). */
    totalUptimeMs: number;
    /** Toplam reconnect denemesi. */
    totalReconnectAttempts: number;
    // ...
}
```

### JSDoc İpuçları

- Kısa ilk satır (özet) + gerekirse detaylı açıklama.
- Parametreler için `@param`.
- Hata durumları için `@throws`.
- Döndürülen değer için `@returns`.
- Internal metotlar da (karmaşık mantık içeriyorsa) kısaca belgelenmiştir.

---

## Mimari Notlar

- `XmppManager` yalnızca bağlantı yaşam döngüsü / durum / metrik sorumluluklarına odaklıdır.
- `OutboundQueue` bağımsız; DI ile gönderim (`sendFn`) ve bağlantı durumu (`isConnected`) enjekte edilir.
- Metrik güncellemeleri `IQueueMetricsSink` abstraction'ı ile loosely coupled.
- Minimal Strophe tipi (`IStropheConnection`) ile `any` bağımlılığı kaldırıldı.

---

## Genişletme Önerileri

1. Presence / IQ ayrı stream'ler
2. XEP-0199 keepalive ping
3. Persisted queue (IndexedDB / localStorage)
4. Giveup requeue mekanizması
5. Inbound ACK takibi (delivery receipts)
6. Queue pause / resume API
7. Telemetry exporter (Prometheus format)

---

## Lisans

(Depo lisansı doğrultusunda güncelleyiniz.)

---

Bu belge ve kod içi JSDoc birlikte IntelliSense / otomatik tamamlama deneyimini güçlendirir.  
Öneri veya ek gereksinimleriniz için PR / Issue açabilirsiniz.