try {
  console.log('[Worker] initialize çağrılıyor')
  self.postMessage({ id: 'init', result: '[Worker] initialized' })
} catch (error) {
  console.error('[Worker] initialize hatası:', error)
  self.postMessage({ id: 'init', error: (error as Error).message })
}
