import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useContext,
  useEffect,
  useState
} from 'react'

type GlobalStateType = {
  globalState: Record<string, any>
  setGlobalState: Dispatch<SetStateAction<Record<string, any>>>
}

const GlobalStateContext = createContext<GlobalStateType | null>(null)

export const GlobalStateProvider = ({ children }: { children: ReactNode }) => {
  const [globalState, setGlobalState] = useState<Record<string, any>>({})

  return (
    <GlobalStateContext.Provider value={{ globalState, setGlobalState }}>
      {children}
    </GlobalStateContext.Provider>
  )
}

export function useGlobalState<T>(
  key: string,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(GlobalStateContext)
  if (!context) {
    throw new Error('useGlobalState must be used within a GlobalStateProvider')
  }

  const { globalState, setGlobalState } = context

  useEffect(() => {
    if (!(key in globalState)) {
      setGlobalState((prev) => ({ ...prev, [key]: defaultValue }))
    }
  }, [key, defaultValue, setGlobalState])

  const setValue: Dispatch<SetStateAction<T>> = (value) => {
    setGlobalState((prev) => ({
      ...prev,
      [key]:
        typeof value === 'function'
          ? (value as (prevState: T) => T)(prev[key])
          : value
    }))
  }

  return [globalState[key] ?? defaultValue, setValue]
}
