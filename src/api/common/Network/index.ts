export * from './networkChangeDetector'
export * from './types'
/*
file:// electron-preload-network.ts

import { contextBridge, ipcRenderer } from 'electron'

/!**
 * Renderer'a basit bir API expose eder.
 * Status değişim eventleri main process'ten gelir.
 *!/
type ExternalProviderUpdate = {
    provider: string
    status: 'online' | 'offline'
    confidence?: number
    augmentedInfo?: any
    latencyMs?: number
    timestamp: number
    reason?: string
}

const PUBLISH_CHANNEL = 'network:status'
const REQUEST_CHANNEL = 'network:request-sample'

const api = {
    onStatus: (cb: (update: ExternalProviderUpdate) => void) => {
        ipcRenderer.on(PUBLISH_CHANNEL, (_e, payload: ExternalProviderUpdate) => cb(payload))
    },
    requestSample: () => {
        ipcRenderer.send(REQUEST_CHANNEL)
    }
}
contextBridge.exposeInMainWorld('electronNetwork', api)
*/

/*
file:// electron-main-network.ts

import { app, BrowserWindow, ipcMain } from 'electron'
import os from 'node:os'
import dns from 'node:dns'
import { setTimeout as delay } from 'node:timers/promises'

const CONFIG = {
    baseIntervalMs: 10_000,
    maxIntervalMs: 60_000,
    growFactor: 1.5,
    shrinkFactor: 0.5,
    highLatencyThresholdMs: 1500,
    offlineConfidenceRise: 0.1,
    offlineConfidenceFall: 0.05,
    confidenceOfflineTrigger: 0.85,
    confidenceOnlineTrigger: 0.90,
    sampleBufferSize: 30,
    filterInternalInterfaces: true
}

interface InternalState {
    lastSamples: number[]
    offlineConfidence: number
    onlineConfidence: number
    currentInterval: number
    lastStatus?: 'online' | 'offline'
}

const state: InternalState = {
    lastSamples: [],
    offlineConfidence: 0.2,
    onlineConfidence: 0.8,
    currentInterval: CONFIG.baseIntervalMs
}

async function pseudoPing(host: string): Promise<number> {
    const start = Date.now()
    await new Promise<void>((resolve) => {
        dns.lookup(host, () => resolve())
    })
    // Simüle RTT
    await delay(30)
    return Date.now() - start
}

function gatherInterfaces(filterInternal: boolean) {
    const nets = os.networkInterfaces()
    const interfaces = Object.entries(nets).flatMap(([name, entries]) =>
        (entries || []).map(e => ({
            name,
            address: e.address,
            family: e.family,
            mac: e.mac,
            internal: e.internal,
            up: true
        }))
    )
    return filterInternal
        ? interfaces.filter(i => !i.internal)
        : interfaces
}

function updateConfidence(rtt: number, error: boolean) {
    if (error) {
        state.offlineConfidence = Math.min(1, state.offlineConfidence + CONFIG.offlineConfidenceRise + 0.05)
    } else if (rtt > CONFIG.highLatencyThresholdMs) {
        state.offlineConfidence = Math.min(1, state.offlineConfidence + CONFIG.offlineConfidenceRise)
    } else {
        state.offlineConfidence = Math.max(0, state.offlineConfidence - CONFIG.offlineConfidenceFall)
    }
    state.onlineConfidence = 1 - state.offlineConfidence
}

function deriveStatus(): 'online' | 'offline' {
    if (state.offlineConfidence >= CONFIG.confidenceOfflineTrigger) return 'offline'
    if (state.onlineConfidence >= CONFIG.confidenceOnlineTrigger) return 'online'
    // Eşiklerde değilse önceki statüye sadık kal veya varsayılan online
    return state.lastStatus || 'online'
}

function adaptInterval(newStatus: 'online' | 'offline') {
    if (state.lastStatus && newStatus !== state.lastStatus) {
        // Statü değişti → interval'i küçült
        state.currentInterval = Math.max(3000, Math.round(state.currentInterval * CONFIG.shrinkFactor))
    } else {
        // Stabil durum → büyüt ama max'ı aşma
        state.currentInterval = Math.min(
            CONFIG.maxIntervalMs,
            Math.round(state.currentInterval * CONFIG.growFactor)
        )
    }
}

function publish(win: BrowserWindow, update: any) {
    win.webContents.send('network:status', update)
}

async function loop(win: BrowserWindow) {
    while (!win.isDestroyed()) {
        let rtt = 0
        let error = false
        try {
            rtt = await pseudoPing('example.com')
        } catch {
            error = true
            rtt = CONFIG.highLatencyThresholdMs + 500
        }

        state.lastSamples.push(rtt)
        if (state.lastSamples.length > CONFIG.sampleBufferSize) {
            state.lastSamples.shift()
        }

        updateConfidence(rtt, error)
        const newStatus = deriveStatus()
        adaptInterval(newStatus)

        const interfaces = gatherInterfaces(CONFIG.filterInternalInterfaces)
        const active = interfaces[0]

        const payload = {
            provider: 'electron',
            status: newStatus,
            confidence: newStatus === 'offline' ? state.offlineConfidence : state.onlineConfidence,
            latencyMs: rtt,
            timestamp: Date.now(),
            reason: error ? 'error-sample' : 'periodic-sample',
            augmentedInfo: {
                platform: process.platform,
                hostname: os.hostname(),
                interfaces,
                activeInterfaceName: active?.name,
                avgPingMs: Math.round(state.lastSamples.reduce((a, b) => a + b, 0) / state.lastSamples.length),
                offlineConfidence: state.offlineConfidence,
                onlineConfidence: state.onlineConfidence,
                rawSamples: state.lastSamples.length
            }
        }

        const statusChanged = newStatus !== state.lastStatus
        state.lastStatus = newStatus

        // Yalnızca status değişiminde publish etmek istiyorsan: if (statusChanged) publish(...)
        publish(win, payload)

        await delay(state.currentInterval)
    }
}

app.whenReady().then(() => {
    const win = new BrowserWindow({
        webPreferences: {
            preload: 'PATH/TO/electron-preload-network.js'
        }
    })

    loop(win).catch(err => console.error('Network loop error', err))

    ipcMain.on('network:request-sample', () => {
        // İsteğe bağlı olarak interval beklemeden anlık sample:
        loopOnce(win).catch(() => void 0)
    })
})

async function loopOnce(win: BrowserWindow) {
    try {
        const rtt = await pseudoPing('example.com')
        updateConfidence(rtt, false)
        const newStatus = deriveStatus()
        const interfaces = gatherInterfaces(CONFIG.filterInternalInterfaces)
        publish(win, {
            provider: 'electron',
            status: newStatus,
            confidence: newStatus === 'offline' ? state.offlineConfidence : state.onlineConfidence,
            latencyMs: rtt,
            timestamp: Date.now(),
            reason: 'manual',
            augmentedInfo: {
                platform: process.platform,
                hostname: os.hostname(),
                interfaces
            }
        })
    } catch {
        // ignore
    }
}

*/
/*

/!**
 * Örnek kullanım:
 * - Trace seviyesinde log
 * - Electron entegrasyonu simülasyonu
 * - Manual check, metric reset, status eventleri
 *!/

import { NetworkChangeDetector, ExternalProviderUpdate } from './NetworkChangeDetector'
import { Logger } from 'tslog'

// Özel logger (renkli + trace)
const logger = new Logger({
    name: 'AppNet',
    minLevel: 'trace',
    displayDateTime: true,
    displayLoggerName: true,
    displayFilePath: 'hidden',
    displayFunctionName: false
})

// İsteğe bağlı: custom transport (ör. external collector)
logger.attachTransport((logObj) => {
    // Örn. Logları JSON.stringify ile başka yere gönderebilirsin
    // console.debug('[RAW-TRANSPORT]', JSON.stringify(logObj))
}, 'trace')

const detector = new NetworkChangeDetector({
    primaryUrl: 'https://example.com',          // Sağlık endpoint temeli
    healthPath: '/health',                      // GET https://example.com/health?_t=...
    // test amaçlı sık check için (gerçekte daha büyük tut)
    baseIntervalMs: 15000,
    maxIntervalMs: 120000,
    maxRetries: 4,
    retryBackoffFactor: 2,
    initialRetryDelayMs: 400,
    maxRetryDelayMs: 6000,
    flapThreshold: 3,
    flapWindowMs: 20000,
    accelerateOnFlap: true,
    eventOnUnchangedStatus: false,              // Sadece status değişiminde event
    includeMetricsInEvents: true,
    electronIntegration: {
        enabled: true,
        providerPrecedence: 'merge',
        strategy: 'conservative',
        overrideOfflineConfidenceThreshold: 0.85,
        overrideOnlineConfidenceThreshold: 0.92
    },
    logger
})

// Başlat
detector.start().then(() => {
    logger.info('Detector started')
})

// Status event aboneliği
detector.onNetworkChange().subscribe(evt => {
    logger.info('STATUS EVENT', {
        status: evt.status,
        reason: evt.reason,
        composite: evt.compositeStatusReason,
        eventIndex: evt.eventIndex,
        flapping: evt.isFlapping,
        dominance: evt.metrics?.providerDominance,
        avgRtt: evt.metrics?.averageRttMs
    })
})

// Hata event aboneliği
detector.onError().subscribe(err => {
    logger.warn('NETWORK ERROR', {
        attempt: err.attempt,
        kind: err.kind,
        reason: err.reason,
        http: err.httpStatus
    })
})

// Periyodik (örnek) metric inspection
setInterval(() => {
    const m = detector.getMetrics()
    logger.trace('METRICS SNAPSHOT', {
        totalChecks: m.totalChecks,
        ok: m.successfulChecks,
        fail: m.failedChecks,
        consecutiveFailures: m.consecutiveFailures,
        avgRtt: m.averageRttMs,
        onlineDurationSec: (m.totalOnlineDurationMs / 1000).toFixed(1),
        offlineDurationSec: (m.totalOfflineDurationMs / 1000).toFixed(1),
        flaps: m.flapCountTotal
    })
}, 20000)

// Manuel health check tetikleme (örnek)
setTimeout(() => {
    logger.debug('Manual checkNow() çağrılıyor')
    detector.checkNow().catch(e => logger.error('Manual check error', e))
}, 10000)

// Electron update simülasyonu (offline confidence yükseltilmiş)
setTimeout(() => {
    const fakeElectronUpdate: ExternalProviderUpdate = {
        provider: 'electron',
        status: 'offline',
        confidence: 0.9,
        timestamp: Date.now(),
        reason: 'simulated-offline',
        augmentedInfo: {
            platform: 'darwin',
            hostname: 'dev-host',
            offlineConfidence: 0.9,
            onlineConfidence: 0.1,
            avgPingMs: 1800,
            rawSamples: 12
        }
    }
    logger.info('Simulating electron offline update')
    detector.simulateElectronUpdate(fakeElectronUpdate)
}, 25000)

// Electron tekrar online simülasyonu
setTimeout(() => {
    const fakeElectronUpdate: ExternalProviderUpdate = {
        provider: 'electron',
        status: 'online',
        confidence: 0.95,
        timestamp: Date.now(),
        reason: 'simulated-online',
        augmentedInfo: {
            platform: 'darwin',
            hostname: 'dev-host',
            offlineConfidence: 0.05,
            onlineConfidence: 0.95,
            avgPingMs: 120,
            rawSamples: 25
        }
    }
    logger.info('Simulating electron online update')
    detector.simulateElectronUpdate(fakeElectronUpdate)
}, 45000)

// Metrikleri resetleme örneği
setTimeout(() => {
    logger.warn('Resetting metrics (preserveRtt=false, preserveCounts=false)')
    detector.resetMetrics()
    logger.info('Metrics after reset', detector.getMetrics())
}, 60000)

// Uygulama kapanışı simülasyonu
setTimeout(() => {
    logger.info('Stopping detector')
    detector.stop()
}, 90000)
*/
/*
/!**
 * Sık status değişimi debug etmek için:
 * - eventOnUnchangedStatus = true
 * - incrementEventOnUnchangedStatus = true
 * - Küçük baseInterval
 *!/

import { NetworkChangeDetector } from './NetworkChangeDetector'

const detector = new NetworkChangeDetector({
  primaryUrl: 'https://example.com',
  healthPath: '/health',
  baseIntervalMs: 8000,
  eventOnUnchangedStatus: true,
  incrementEventOnUnchangedStatus: true,
  includeMetricsInEvents: true,
  loggerOptions: {
    name: 'NetDebug',
    minLevel: 'trace',
    displayFilePath: 'hidden',
    displayFunctionName: false
  }
})

detector.start()

detector.onNetworkChange().subscribe((e) => {
  console.log(
    '[EVENT]',
    e.eventIndex,
    e.status,
    e.reason,
    'dom=',
    e.metrics?.providerDominance
  )
})

*/
