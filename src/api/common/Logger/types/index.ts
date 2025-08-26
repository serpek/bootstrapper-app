import { type ILogObjMeta, ISettingsParam, Logger as TSLogger } from 'tslog'

export interface ILogServices<LogObj> extends TSLogger<LogObj> {
  store: Array<(transportLogger: LogObj & ILogObjMeta) => void>

  custom(...args: unknown[]): (LogObj & ILogObjMeta) | undefined

  create(settings?: ISettingsParam<LogObj>): ILogService<LogObj>
}

export enum LogLevel {
  TRACE = 10,
  DEBUG = 20,
  INFO = 30,
  WARN = 40,
  ERROR = 50,
  SILENT = 99
}

export interface LogFilter {
  level?: string | string[]
  startDate?: Date
  endDate?: Date
  keyword?: string
  page?: number
  pageSize?: number
}

export interface LogEntry {
  id: string
  timestamp: Date
  level: string
  message: string
  data?: any
}

export type CreateLogEntry = Omit<LogEntry, 'id'>

export interface LogAnalytics {
  total: number
  byLevel: Record<string, number>
  averagePerDay: number
}

export interface ILogService<LogObj> extends TSLogger<LogObj> {
  custom(...args: unknown[]): (LogObj & ILogObjMeta) | undefined

  init(...args: unknown[]): (LogObj & ILogObjMeta) | undefined

  create(settings?: ISettingsParam<LogObj>): ILogService<LogObj>

  exportLogs(format?: 'csv' | 'xls'): Promise<Blob>

  cleanLogs(): Promise<void>

  subscribeToLogs(callback: (log: LogEntry) => void): () => void

  subscribeToLogs(callback: (log: LogEntry) => void): () => void

  getLogs(filter: LogFilter): Promise<{ data: LogEntry[]; total: number }>

  getLogAnalytics(): Promise<LogAnalytics>
}
