export const eventBus = new Map<string, Set<(data: any) => void>>()

export const emit = (eventName: string, data: any) => {
  eventBus.get(eventName)?.forEach((callback) => callback(data))
}
export const on = (eventName: string, callback: (data: any) => void) => {
  if (!eventBus.has(eventName)) eventBus.set(eventName, new Set())
  eventBus.get(eventName)?.add(callback)
  return () => eventBus.get(eventName)?.delete(callback)
}
