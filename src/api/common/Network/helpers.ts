// ---------------- Standalone Helpers ----------------

import { NetworkErrorKind } from './types'

function cacheBuster(url: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}_t=${Date.now()}`
}

function joinUrl(base: string, path: string): string {
  if (!base.endsWith('/') && !path.startsWith('/')) return `${base}/${path}`
  if (base.endsWith('/') && path.startsWith('/')) return base + path.slice(1)
  return base + path
}

function classifyError(err: any): NetworkErrorKind {
  if (err?.name === 'AbortError') return 'timeout'
  if (err?.message?.includes?.('abort')) return 'abort'
  if (err?.message?.includes?.('Failed to fetch')) return 'network-error'
  return 'other'
}

export { cacheBuster, classifyError, joinUrl }
