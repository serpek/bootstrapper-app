export async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i < retries - 1) {
        console.warn(`Retry ${i + 1}/${retries}`)
        await new Promise((res) => setTimeout(res, delay))
      } else {
        console.error('All retries failed')
        throw err
      }
    }
  }
  throw new Error('Max retries reached')
}

export function dependsOn(...dependencies: string[]) {
  return function (target: any) {
    Reflect.defineMetadata('dependencies', dependencies, target)
  }
}

export function LazyProxyWithCache<
  T extends { init?: () => Promise<void> | void }
>(instance: T): T {
  let initialized = false
  const cache = new Map<string | symbol, any>()

  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (!initialized && typeof target.init === 'function') {
        initialized = true
        const result = target.init()
        if (result instanceof Promise) {
          result.catch((err) => console.error('Lazy Init Error:', err))
        }
      }

      // Cachelenmiş değeri döndür
      if (cache.has(prop)) {
        return cache.get(prop)
      }

      const value = Reflect.get(target, prop, receiver)
      cache.set(prop, value)
      return value
    }
  })
}

/**
 * LazyProxy - Servisi ilk erişimde init eden proxy
 * @param instance - Servis örneği
 * @returns Proxy ile sarmalanmış servis
 */
export function LazyProxy<T extends { init?: () => Promise<void> | void }>(
  instance: T
): T {
  let initialized = false

  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (!initialized && typeof target.init === 'function') {
        initialized = true
        const result = target.init()
        if (result instanceof Promise) {
          result.catch((err) => console.error('Lazy Init Error:', err))
        }
      }
      return Reflect.get(target, prop, receiver)
    }
  })
}
