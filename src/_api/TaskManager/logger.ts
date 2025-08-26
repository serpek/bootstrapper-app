import type { ILogObj, Logger } from 'tslog'

import { LogLevel } from './task-types'

const LEVEL_ORDER: LogLevel[] = [
  'silent',
  'error',
  'warn',
  'info',
  'debug',
  'trace'
]
const levelPriority = (lvl: LogLevel) => LEVEL_ORDER.indexOf(lvl)

export interface LevelLogger {
  level: LogLevel

  setLevel(l: LogLevel): void

  trace(...args: any[]): void

  debug(...args: any[]): void

  info(...args: any[]): void

  warn(...args: any[]): void

  error(...args: any[]): void
}

export function createLevelLogger(opts: {
  base?: Logger<ILogObj> | Console
  level?: LogLevel
  prefix?: string
}): LevelLogger {
  const base = opts.base ?? console
  let current: LogLevel = opts.level ?? 'info'
  const pref = opts.prefix ? `[${opts.prefix}]` : ''

  const allow = (needed: LogLevel) =>
    current !== 'silent' && levelPriority(current) >= levelPriority(needed)

  function invoke(
    method: 'trace' | 'debug' | 'info' | 'warn' | 'error',
    lvl: LogLevel,
    args: any[]
  ) {
    if (!allow(lvl)) return
    const fn = (base as any)[method] || (base as any).log
    // tslog logger metotları 'this' bağımlı => apply ile çağır.
    fn.apply(base, pref ? [pref, ...args] : [...args])
  }

  return {
    get level() {
      return current
    },
    setLevel(l: LogLevel) {
      current = l
    },
    trace: (...a) => invoke('trace', 'trace', a),
    debug: (...a) => invoke('debug', 'debug', a),
    info: (...a) => invoke('info', 'info', a),
    warn: (...a) => invoke('warn', 'warn', a),
    error: (...a) => invoke('error', 'error', a)
  }
}
