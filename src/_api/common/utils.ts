export function byteArrayToBase64(data: Uint8Array): string {
  const output = []
  if (data) {
    for (let i = 0; i < data.length; i++)
      output.push(String.fromCharCode(data[i]))
  }
  return window.btoa(output.join(''))
}

export function sleep(ms: number) {
  return new Promise((done) => {
    setTimeout(done, ms)
  })
}

export function createID(): string {
  // console.warn('createID is deprecated. Use createSessionID instead.')
  const length = 10,
    wishlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-'
  return Array.from(crypto.getRandomValues(new Uint32Array(length)))
    .map((x) => wishlist[x % wishlist.length])
    .join('')
}
