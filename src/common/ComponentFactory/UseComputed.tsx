import { useEffect, useState } from 'react'

export function useComputed<T>(fn: () => T, dependencies: any[]) {
  const [value, setValue] = useState(fn)
  useEffect(() => setValue(fn()), dependencies)
  return value
}
