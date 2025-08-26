# (Güncellenmiş Bölümlerden Kesit)

## Yeni: Worker Kullanımını Aç/Kapat

Artık `TaskManagerConfig` içine `useWorker?: boolean` eklenmiştir.

```ts
// Worker açık (varsayılan)
const tm = new TaskManager();

// Worker kapalı (inline cron scheduling)
const tmNoWorker = new TaskManager({useWorker: false});

// Eski (deprecated): disableWorker -> useWorker=false eşdeğeri
const tmDeprecated = new TaskManager({disableWorker: true}); // Uyarı log basar
```

Worker kapalı olduğunda:

- Croner örnekleri manager içinde tutulur (inlineSchedulers).
- Batching ve worker postMessage mekanizması devre dışı kalır (gerekirse log).
- Diğer tüm API (manual trigger, metrics, missed tick simulation) aynı davranır.

## setActivityState Boolean API

Önceki: `setActivityState('active'|'idle')`  
Yeni: `setActivityState(isActive: boolean)`

```ts
tm.setActivityState(false); // idle
tm.setActivityState(true);  // active
```

Idle -> Active dönüşünde kaçan tetikler yine simüle edilir.

> Not: Eski imzayı kullanan kodlar breaking change yaşar; adaptasyon için basit string -> boolean map:

```ts
function migrate(old: 'active' | 'idle') {
    manager.setActivityState(old === 'active');
}
```

## Log Seviyeleri & Debug / Trace

`TaskManagerConfig` içine eklenen alanlar:

| Alan               | Tip                                                           | Varsayılan | Açıklama                                        |
|--------------------|---------------------------------------------------------------|------------|-------------------------------------------------|
| logLevel           | 'silent' \| 'error' \| 'warn' \| 'info' \| 'debug' \| 'trace' | 'info'     | Çıktı ayrıntı düzeyi                            |
| debug (deprecated) | boolean                                                       | -          | logLevel belirtilmemişse 'debug' anlamına gelir |

Örnek:

```ts
const manager = new TaskManager({
    logLevel: 'debug',
    useWorker: true,
});

manager.setLogLevel('trace'); // runtime değişim
console.log('Şu anki seviye', manager.getLogLevel());
```

Seviye davranışı:

- silent: Hiç log yok
- error: Sadece task-error, task-timeout, worker error
- warn: + missed-tick-simulated, task-removed
- info: + temel lifecycle (start, success, complete, added vs.)
- debug: + overlap (queued / parallel) ve ek süre bilgisi
- trace: + tüm event payload JSON ve internal worker/inline tick izleme

Merkezi loglama TaskManager event akışına abone olarak yapılır; Task sınıfına doğrudan logger enjekte edilmez (kapsüllü). Gerektiğinde future sürümde Task içi satır içi log
eklenebilir.

