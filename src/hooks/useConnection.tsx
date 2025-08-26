import {
  createContext,
  PropsWithChildren,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import {
  type IActivityMonitor,
  type IAuthManager,
  type IConfigurationService,
  type INetworkChangeDetector,
  ITaskManager,
  NetworkInfo,
  NetworkStatus,
  SessionContext
} from '@bipweb/common'
import { ServiceContainer } from '@bipweb/core'

interface ConnectionContextType {
  activityMonitor: IActivityMonitor
  authManager: IAuthManager
  taskManager: ITaskManager
  session: SessionContext
  networkManager: INetworkChangeDetector
  networkInfo: NetworkInfo | null
  networkStatsus: NetworkStatus
  conf: IConfigurationService
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(
  undefined
)

export function ConnectionProvider({
  children,
  container
}: PropsWithChildren<{
  children?: ReactNode
  container: ServiceContainer
}>) {
  const [conf] = useState(
    container.get<IConfigurationService>('ConfigurationService')
  )
  const [activityMonitor] = useState(
    container.get<IActivityMonitor>('ActivityMonitor')
  )
  const [taskManager] = useState(container.get<ITaskManager>('TaskManager'))
  const [authManager] = useState(container.get<IAuthManager>('AuthManager'))
  const [networkManager] = useState(
    container.get<INetworkChangeDetector>('NetworkChangeDetector')
  )
  const [session, setSesion] = useState<SessionContext>(
    authManager.sessionInfo$.getValue()
  )
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(
    networkManager.getNetworkInfo() || null
  )
  const [networkStatsus, setNetworkStatus] = useState<NetworkStatus>(
    networkManager.getStatus()
  )

  useEffect(() => {
    authManager.sessionInfo$.subscribe((value) => {
      setSesion(value)
    })

    return () => {
      authManager.sessionInfo$.unsubscribe()
      console.log('App sessionInfo unsubscribed')
    }
  }, [authManager])

  useEffect(() => {
    networkManager.onNetworkChange().subscribe((event) => {
      setNetworkInfo(event.network)
      setNetworkStatus(event.status)
      // if (networkManager.lastStatus !== event.status && event.status === 'online') {
      // console.warn('Internet connection reconnected!', event.status)
      // }
      // if (networkManager.lastStatus !== event.status && event.status === 'offline') {
      // console.warn('Internet connection lost!', event.status)
      // }
    })

    return () => {
      networkManager.stop()
      console.log('NetworkChangeDetector unsubscribed')
    }
  }, [networkManager])

  const value = useMemo(
    () => ({
      conf,
      authManager,
      activityMonitor,
      session,
      networkManager,
      networkInfo,
      networkStatsus,
      taskManager
    }),
    [
      conf,
      authManager,
      activityMonitor,
      session,
      networkManager,
      networkInfo,
      networkStatsus,
      taskManager
    ]
  )

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  )
}

export function useConnection() {
  const context = useContext(ConnectionContext)
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider')
  }
  return context
}
