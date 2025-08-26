import Dexie from 'dexie'
import * as ExcelJS from 'exceljs'
import FileSaver from 'file-saver'
import type { ILogObjMeta, IMeta, ISettingsParam } from 'tslog'
import { Logger as TSLogger } from 'tslog'
import { singleton } from 'tsyringe'

import { dependsOn } from '@bipweb/core'
import { encryptData, generateKey } from '@bipweb/shared'

import type {
  CreateLogEntry,
  ILogService,
  LogAnalytics,
  LogEntry,
  LogFilter
} from './types'

/**
 * LogService implements ILogService with filtering, real-time monitoring,
 * encryption, and analytics reporting.
 */

@dependsOn()
@singleton()
export class LogService<LogObj>
  extends TSLogger<LogObj>
  implements ILogService<LogObj>
{
  public store: Array<(transportLogger: LogObj & ILogObjMeta) => void> = []
  private db: Dexie
  private readonly externalServiceUrl?: string
  private encryptionKey?: CryptoKey
  private subscribers: Array<(log: LogEntry) => void> = []

  constructor(settings?: ISettingsParam<LogObj>, logObj?: LogObj) {
    super(
      {
        hideLogPositionForProduction: true,
        prettyLogTimeZone: 'UTC',
        type: 'pretty',
        // prefix: [''],
        // parentNames: [''],
        // prettyErrorParentNamesSeparator: '',
        // prettyLogTemplate: '{{logLevelName}}\t{{name}}',
        prettyLogTemplate: '[{{logLevelName}}]{{logName}} ',
        overwrite: {
          addPlaceholders(
            logObjMeta: IMeta,
            placeholderValues: Record<string, string | number>
          ) {
            placeholderValues['logLevelId'] = logObjMeta.logLevelId
            placeholderValues['logName'] = logObjMeta.name
              ? `[${logObjMeta.name.toUpperCase()}]`
              : ''
          }
        },
        ...settings,
        name: settings?.name || 'unknown'
      },
      logObj
    )
    // Initialize Dexie database
    this.db = new Dexie('LogDB')
    this.db.version(1).stores({
      logs: '++id, timestamp, level'
    })
    this.externalServiceUrl = ''

    // Generate encryption key
    generateKey()
      .then((key) => (this.encryptionKey = key))
      .catch((err) => this.error('Key generation failed', err))

    // Attach performance monitoring
    this.attachTransport(async (logObj: LogObj & ILogObjMeta) => {
      this.store.push(() => this.handleLogTransport(logObj))
      const entry = await this.saveToIndexedDB(logObj)
      if (entry) this.subscribers.forEach((sub) => sub(entry))

      // @ts-ignore
      if (logObj._meta?.performance) {
        // @ts-ignore
        console.log(`[Performance] ${logObj._meta.performance}ms`)
      }
      if (this.externalServiceUrl) {
        await this.sendToExternalService(logObj)
      }
    })

    // this.init(`Logger initialized for ${this.settings.name}`)

    // Enforce 30-day retention on initialization
    this.enforceRetentionPolicy().catch((err) =>
      this.error('Retention enforcement failed', err)
    )
  }

  /**
   * Cleans all logs from IndexedDB.
   */
  public async cleanLogs(): Promise<void> {
    try {
      await this.db.table('logs').clear()
      this.store = []
      this.info('All logs cleaned')
    } catch (error) {
      this.error('Failed to clean logs', error)
      throw error
    }
  }

  /**
   * Creates a sub-logger with inherited functionality.
   */
  public create(
    settings?: ISettingsParam<LogObj>,
    logObj?: LogObj
  ): ILogService<LogObj> {
    const subLogger = this.getSubLogger({ ...settings }, logObj)
    return Object.assign(subLogger, {
      store: [],
      custom: this.custom.bind(subLogger),
      init: this.init.bind(subLogger),
      create: this.create.bind(subLogger),
      exportLogs: this.exportLogs.bind(this),
      cleanLogs: this.cleanLogs.bind(this),
      getLogs: this.getLogs.bind(this),
      subscribeToLogs: this.subscribeToLogs.bind(this),
      getLogAnalytics: this.getLogAnalytics.bind(this)
    }) as ILogService<LogObj>
  }

  /**
   * Custom log level implementation.
   */
  public custom(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(8, 'CUSTOM', ...args)
  }

  public init(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(12, 'INIT', ...args)
  }

  /**
   * Exports logs from the last 30 days to CSV or XLS format.
   * @param format 'csv' or 'xls'
   * @returns Blob containing the exported file
   */
  public async exportLogs(format: 'csv' | 'xls' = 'csv'): Promise<Blob> {
    const logs = await this.getLogs({}) // Get all logs
    // const decryptedLogs = await Promise.all(
    //   logs.data.map(async (log) => ({
    //     ...log,
    //     message: this.encryptionKey
    //       ? await decryptData(log.message, this.encryptionKey)
    //       : log.message
    //   }))
    // )

    if (format === 'csv') {
      const csvContent = [
        'ID,Timestamp,Level,Message,Data',
        ...logs.data.map(
          (log) =>
            `${log.id},${log.timestamp.toISOString()},${log.level},${log.message.replace(/,/g, '')},${JSON.stringify(log.data)}`
        )
      ].join('\n')

      FileSaver.saveAs(
        new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }),
        'logs.csv'
      )
      return new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    } else {
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('Logs')
      worksheet.columns = [
        { header: 'ID', key: 'id', width: 15 },
        { header: 'Timestamp', key: 'timestamp', width: 25 },
        { header: 'Level', key: 'level', width: 10 },
        { header: 'Message', key: 'message', width: 50 },
        { header: 'Data', key: 'data', width: 30 }
      ]
      logs.data.forEach((log) => worksheet.addRow(log))
      const buffer = await workbook.xlsx.writeBuffer()
      FileSaver.saveAs(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }),
        'logs.xls'
      )
      return new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
    }
  }

  /**
   * Provides analytics on stored logs.
   */
  public async getLogAnalytics(): Promise<LogAnalytics> {
    const logs = await this.db.table('logs').toArray()
    const byLevel = logs.reduce(
      (acc, log) => {
        acc[log.level] = (acc[log.level] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )
    const days =
      [...new Set(logs.map((log) => log.timestamp.toDateString()))].length || 1
    return {
      total: logs.length,
      byLevel,
      averagePerDay: logs.length / days
    }
  }

  /**
   * Filters logs based on level, date range, or keyword.
   */
  public async getLogs(
    filter: LogFilter
  ): Promise<{ data: LogEntry[]; total: number }> {
    const table = this.db.table('logs')
    let collection = table.toCollection()
    if (filter.level) {
      collection = table.where('level').equals(filter.level)
    }

    if (filter.startDate && filter.endDate) {
      collection = collection.filter(
        (log) =>
          log.timestamp >= filter.startDate! && log.timestamp <= filter.endDate!
      )
    } else if (filter.startDate) {
      collection = collection.filter(
        (log) => log.timestamp >= filter.startDate!
      )
    } else if (filter.endDate) {
      collection = collection.filter((log) => log.timestamp <= filter.endDate!)
    }

    if (filter.keyword) {
      collection = collection.filter((log) =>
        log.message.toLowerCase().includes(filter.keyword!.toLowerCase())
      )
    }

    const totalCount = await collection.count()
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize
      collection = collection.offset(offset).limit(filter.pageSize)
    }

    const logs = await collection.toArray()
    // const decryptedLogs = await Promise.all(
    //   logs.map(async (log) => ({
    //     ...log,
    //     message: this.encryptionKey
    //       ? await decryptData(log.message, this.encryptionKey)
    //       : log.message
    //   }))
    // )
    if (filter.keyword) {
      return {
        data: logs.filter((log) => log.message.includes(filter.keyword)),
        total: totalCount
      }
    }
    return { data: logs, total: totalCount }
  }

  /**
   * Subscribes to real-time log updates.
   * @returns Unsubscribe function
   */
  public subscribeToLogs(callback: (log: LogEntry) => void): () => void {
    this.subscribers.push(callback)
    return () => {
      this.subscribers = this.subscribers.filter((sub) => sub !== callback)
    }
  }

  async checkStorageQuota(): Promise<void> {
    const logs = await this.db.table('logs').toArray()
    const size = JSON.stringify(logs).length / 1024 / 1024 // MB cinsinden
    if (size > 50) {
      const toDelete = logs.slice(0, logs.length / 2)
      await this.db
        .table('logs')
        .where('id')
        .anyOf(toDelete.map((l) => l.id))
        .delete()
      this.info('Storage quota exceeded, old logs deleted')
    }
  }

  async encryptLog(message: string): Promise<string> {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt']
    )
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(message)
    )
    return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(encrypted)))}`
  }

  async rotateLogs(): Promise<void> {
    const logs = await this.db.table('logs').toArray()
    if (logs.length > 10000) {
      // Örnek sınır
      const oldLogs = logs.slice(0, 5000)
      const compressed = await this.compressLogs(oldLogs)
      await this.db
        .table('archives')
        .put({ id: Date.now().toString(), data: compressed })
      await this.db
        .table('logs')
        .where('id')
        .anyOf(oldLogs.map((l) => l.id))
        .delete()
      this.info('Logs rotated and archived')
    }
  }

  private async compressLogs(logs: LogEntry[]): Promise<string> {
    const data = JSON.stringify(logs)
    return btoa(data)
  }

  /**
   * Enforces 30-day retention policy by deleting older logs.
   */
  private async enforceRetentionPolicy(): Promise<void> {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    try {
      await this.db
        .table('logs')
        .where('timestamp')
        .below(thirtyDaysAgo)
        .delete()
      // this.debug('Retention policy enforced')
    } catch (error) {
      this.error('Retention policy enforcement failed', error)
    }
  }

  private handleLogTransport(logObj: LogObj & ILogObjMeta): void {
    console.log('Transport handled:', logObj)
  }

  /**
   * Saves log entry to IndexedDB.
   */
  private async saveToIndexedDB(
    logObj: LogObj & ILogObjMeta
  ): Promise<LogEntry> {
    const message = `${logObj[1]}`
    const data = logObj[2] ? JSON.stringify(logObj[2]) : ''
    const encryptedMessage = this.encryptionKey
      ? await encryptData(message, this.encryptionKey)
      : message
    const entry: CreateLogEntry = {
      //id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date(logObj._meta.date),
      level: `${logObj._meta.logLevelId}`,
      message: encryptedMessage,
      data
    }
    try {
      await this.db.table('logs').put(entry)
      return entry as unknown as LogEntry
    } catch (error) {
      this.error('Failed to save log to IndexedDB', error)
      throw error
    }
  }

  /**
   * Sends log entry to an external service.
   */
  private async sendToExternalService(
    logObj: LogObj & ILogObjMeta
  ): Promise<void> {
    if (!this.externalServiceUrl) return
    try {
      await fetch(this.externalServiceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logObj)
      })
      this.debug('Log sent to external service')
    } catch (error) {
      this.error('Failed to send log to external service', error)
    }
  }
}

export const logService = new LogService({ name: 'Logger' })
