export class CryptoUtils {
  private static encoder = new TextEncoder()
  private static decoder = new TextDecoder()
  private static IV_LENGTH = 12
  private static PASSWORD = 'SuperSecretPassword!'

  public static async encrypt<T>(data: T): Promise<string> {
    const key = await this.getKey()
    const iv = window.crypto.getRandomValues(new Uint8Array(this.IV_LENGTH))
    const encodedData = this.encoder.encode(JSON.stringify(data))

    const encryptedData = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encodedData
    )

    return btoa(
      String.fromCharCode(...iv) +
        String.fromCharCode(...new Uint8Array(encryptedData))
    )
  }

  public static async decrypt<T>(encryptedData: string): Promise<T> {
    const key = await this.getKey()
    const binaryData = atob(encryptedData)
    const iv = new Uint8Array(
      binaryData
        .slice(0, this.IV_LENGTH)
        .split('')
        .map((c) => c.charCodeAt(0))
    )
    const encryptedBytes = new Uint8Array(
      binaryData
        .slice(this.IV_LENGTH)
        .split('')
        .map((c) => c.charCodeAt(0))
    )

    const decryptedData = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encryptedBytes
    )

    return JSON.parse(this.decoder.decode(decryptedData))
  }

  private static async getKey(): Promise<CryptoKey> {
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      this.encoder.encode(this.PASSWORD),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    )

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: this.encoder.encode('salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    )
  }
}
