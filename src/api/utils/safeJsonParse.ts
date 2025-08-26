export function safeJsonParse<T>(
  jsonString: string | undefined | null,
  defaultValue: T
): T {
  if (!jsonString) return defaultValue
  try {
    return JSON.parse(jsonString) as T
  } catch (e) {
    console.error('JSON parse error:', e)
    return defaultValue
  }
}
