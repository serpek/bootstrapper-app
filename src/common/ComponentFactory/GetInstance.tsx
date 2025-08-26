export const instanceMap = new Map<string, any>()

export const getInstance = (name: string) => instanceMap.get(name)
