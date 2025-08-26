export async function encryptData(
  data: string,
  key: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder()
  const encoded = encoder.encode(data)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(encrypted)))}`
}

export async function decryptData(
  encrypted: string,
  key: CryptoKey
): Promise<string> {
  const [ivStr, encStr] = encrypted.split('.')
  const iv = Uint8Array.from(atob(ivStr), (c) => c.charCodeAt(0))
  const encryptedData = Uint8Array.from(atob(encStr), (c) => c.charCodeAt(0))
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encryptedData
  )
  return new TextDecoder().decode(decrypted)
}

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt'
  ])
}
