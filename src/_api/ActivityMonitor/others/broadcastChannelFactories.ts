// Farklı senaryolar için BroadcastChannel üreticileri

// 1) Native BroadcastChannel (varsayılanın açıkça verilmiş hâli)
export function createNativeBroadcastChannelFactory() {
  return (name: string): BroadcastChannel => new BroadcastChannel(name)
}

// 2) 'broadcast-channel' (npm) polyfill'i
// npm i broadcast-channel
export function createBroadcastChannelLibFactory() {
  // Tip esnekliği için 'as unknown as BroadcastChannel' kullanılıyor.
  // Bu kütüphanenin API'si (postMessage/onmessage/close) yeterli uyumluluğa sahip.

  const LibBC = require('broadcast-channel').BroadcastChannel as any
  return (name: string): BroadcastChannel =>
    new LibBC(name) as unknown as BroadcastChannel
}

// 3) localStorage tabanlı shim (yalın ve basit, aynı sekmede çalışmaz; cross-tab içindir)
export function createLocalStorageShimFactory() {
  return (name: string): BroadcastChannel => {
    const key = `__bc__:${name}`
    const listeners = new Set<(ev: MessageEvent) => void>()

    const channel: any = {
      name,
      onmessage: null as ((ev: MessageEvent) => void) | null,
      postMessage(data: any) {
        // Benzersiz bir payload ile storage tetikle
        localStorage.setItem(
          key,
          JSON.stringify({
            data,
            ts: Date.now(),
            nonce: Math.random().toString(36).slice(2)
          })
        )
      },
      addEventListener(type: string, handler: any) {
        if (type === 'message') listeners.add(handler)
      },
      removeEventListener(type: string, handler: any) {
        if (type === 'message') listeners.delete(handler)
      },
      close() {
        window.removeEventListener('storage', onStorage)
      }
    }

    function onStorage(ev: StorageEvent) {
      if (ev.key !== key || ev.newValue == null) return
      try {
        const parsed = JSON.parse(ev.newValue)
        const msgEvent = { data: parsed.data } as MessageEvent
        // onmessage callback
        if (channel.onmessage) {
          try {
            channel.onmessage(msgEvent)
          } catch {
            // Hata yakalama, onmessage içinde hata oluşursa
            console.error('Error in channel.onmessage:', ev)
          }
        }
        // addEventListener('message', ...)
        for (const l of Array.from(listeners)) {
          try {
            l(msgEvent)
          } catch {
            // Hata yakalama, dinleyici içinde hata oluşursa
            console.error('Error in channel listener:', ev)
          }
        }
      } catch {
        // JSON parse hatası, geçersiz veri
        console.error('Error parsing storage event data:', ev)
      }
    }

    window.addEventListener('storage', onStorage)
    return channel as BroadcastChannel
  }
}

// 4) window.postMessage köprüsü (örn. Electron preload veya iframe üzerinden)
// - postMessage ile gönderirken: window.postMessage({ channel: name, payload }, '*')
// - Alırken: channel.onmessage(MessageEvent) çağrılır ve data = payload olur.
export function createPostMessageBridgeFactory(
  targetWindow: Window = window,
  targetOrigin = '*'
) {
  return (name: string): BroadcastChannel => {
    const listeners = new Set<(ev: MessageEvent) => void>()

    const channel: any = {
      name,
      onmessage: null as ((ev: MessageEvent) => void) | null,
      postMessage(data: any) {
        // Köprü formatı: { channel, payload }
        targetWindow.postMessage({ channel: name, payload: data }, targetOrigin)
      },
      addEventListener(type: string, handler: any) {
        if (type === 'message') listeners.add(handler)
      },
      removeEventListener(type: string, handler: any) {
        if (type === 'message') listeners.delete(handler)
      },
      close() {
        window.removeEventListener('message', onMessage)
      }
    }

    function onMessage(ev: MessageEvent) {
      const d = ev?.data
      if (!d || typeof d !== 'object' || d.channel !== name) return
      const msgEvent = { data: d.payload } as MessageEvent
      if (channel.onmessage) {
        try {
          channel.onmessage(msgEvent)
        } catch {
          // Hata yakalama, onmessage içinde hata oluşursa
          console.error('Error in channel.onmessage:', ev)
        }
      }
      for (const l of Array.from(listeners)) {
        try {
          l(msgEvent)
        } catch {
          // Hata yakalama, dinleyici içinde hata oluşursa
          console.error('Error in channel listener:', ev)
        }
      }
    }

    window.addEventListener('message', onMessage)
    return channel as BroadcastChannel
  }
}

// 5) No-op (test/sessiz mod)
export function createNoopBroadcastChannelFactory() {
  return (name: string): BroadcastChannel => {
    const channel: any = {
      name,
      onmessage: null as ((ev: MessageEvent) => void) | null,
      postMessage(_data: any) {
        /* noop */
      },
      addEventListener(_type: string, _handler: any) {
        /* noop */
      },
      removeEventListener(_type: string, _handler: any) {
        /* noop */
      },
      close() {
        /* noop */
      }
    }
    return channel as BroadcastChannel
  }
}
