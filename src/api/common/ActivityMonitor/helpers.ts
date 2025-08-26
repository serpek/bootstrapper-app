/* ----------------------------- Type Guards --------------------------------- */
import { LogLevel } from '../Logger'

import { ActivityStatus, ActivityStatusElectron } from './types'

function isElectronStatus(
  status: ActivityStatus
): status is ActivityStatusElectron {
  return status.platform === 'electron' && status.electronConnected
}

const now = () => Date.now()

/* --------------------------- Log Level Mapping ----------------------------- */
function mapLogLevelToTsLog(logLevel: LogLevel): number {
  switch (logLevel) {
    case LogLevel.TRACE:
      return 1
    case LogLevel.DEBUG:
      return 2
    case LogLevel.INFO:
      return 3
    case LogLevel.WARN:
      return 4
    case LogLevel.ERROR:
      return 5
    case LogLevel.SILENT:
      return 7
    default:
      return 3
  }
}

export { isElectronStatus, mapLogLevelToTsLog, now }
