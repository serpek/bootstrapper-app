export function byteArrayToBase64(data: Uint8Array): string {
  const output = []
  if (data) {
    for (let i = 0; i < data.length; i++)
      output.push(String.fromCharCode(data[i]))
  }
  return window.btoa(output.join(''))
}
