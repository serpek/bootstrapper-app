console.log('Logger')
import {
  type ILogObjMeta,
  type ISettingsParam,
  Logger as TSLogger
} from 'tslog'
import { injectable } from 'tsyringe'

import { dependsOn } from '../ServiceManager/utils'

export interface LogService<LogObj> extends TSLogger<LogObj> {
  store: ((transportLogger: LogObj & ILogObjMeta) => void)[]

  custom(...args: unknown[]): (LogObj & ILogObjMeta) | undefined

  create(settings?: ISettingsParam<LogObj>): TSLogger<LogObj>
}

/**
 * A class for managing logging.
 *
 * @typeparam LogObj - The type of the log object.
 */
@injectable()
@dependsOn('ConfigServiceImpl')
export class LogServiceImpl<LogObj>
  extends TSLogger<LogObj>
  implements LogService<LogObj>
{
  store: ((transportLogger: LogObj & ILogObjMeta) => void)[] = []

  /**
   * Creates a new instance of the LogService class.
   *
   * @param {ISettingsParam<LogObj>} [settings] - Optional settings for the logger.
   * @param {LogObj} [logObj] - Optional log object.
   */
  constructor(settings?: ISettingsParam<LogObj>, logObj?: LogObj) {
    super(
      {
        // (1)
        hideLogPositionForProduction: true,
        prettyLogTimeZone: 'UTC',
        type: 'pretty',
        prettyErrorParentNamesSeparator: '',
        prettyLogTemplate: '{{logLevelName}}\t{{name}}',
        overwrite: {},
        ...settings,
        ...{ name: settings ? `[${settings?.name}]` : '' }
      },
      logObj
    )
    console.warn('Logger created')
    if (!settings) {
      this.info(` Logger created`)
    } else {
      this.info(` Logger created`, settings.name)
    }
  }

  private static _instance: LogService<any> | undefined

  /**
   * Gets the instance of the LogService, creating it if it does not exist, and attaching transport to it.
   *
   * @return {LogService<LogObj>} The instance of the LogService.
   */
  static get instance(): LogService<any> {
    if (!LogServiceImpl._instance) {
      LogServiceImpl._instance = new LogServiceImpl()
      LogServiceImpl._instance.attachTransport((transportLogger) => {
        LogServiceImpl._instance?.store.push(transportLogger)
        // LogService._instance?.silly('Logger attached')
      })
    }

    return LogServiceImpl._instance
  }

  /**
   * A method that accepts a variable number of arguments and returns a LogObj & ILogObjMeta or undefined.
   *
   * @param {unknown[]} args - variable number of arguments
   * @return {(LogObj & ILogObjMeta) | undefined} the result of super.log
   */

  public custom(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(8, 'CUSTOM', ...args)
  }

  /**
   * Creates a new TSLogger with the given settings.
   *
   * @param {ISettingsParam<LogObj>} [settings] - Optional settings for the TSLogger.
   * @return {TSLogger<LogObj>} The created TSLogger.
   */
  public create(settings?: ISettingsParam<LogObj>): TSLogger<LogObj> {
    return this.getSubLogger({
      prefix: [''],
      ...settings
    })
  }
}

/**
 * <https://datatracker.ietf.org/doc/html/rfc5424>
 * SYSLOG
 * <PRIORITY> <VERSION> <ISOTIMESTAMP> <HOSTNAME> <APPLICATION> <PID> <MESSAGEID> <[STRUCTURED-DATA]> <MSG>
 * <165>1 2003-10-11T22:14:15.003Z mymachine.example.com myapplication 1234 ID47 [example@0 class="high"] BOMmyapplication is started
 * <165>1 2003-10-11T22:14:15.003Z mymachine.example.com evntslog - ID47 [exampleSDID@32473 iut="3" eventSource="Application" eventID="1011"] BOMAn application event log entry...
 *
 * Syslog Message Facilities
 * Code   Facility
 *  0     kernel messages
 *  1     user-level messages
 *  2     mail system
 *  3     system daemons
 *  4     security/authorization messages
 *  5     messages generated internally by syslogd
 *  6     line printer subsystem
 *  7     network news subsystem
 *  8     UUCP subsystem
 *  9     clock daemon
 * 10     security/authorization messages
 * 11     FTP daemon
 * 12     NTP subsystem
 * 13     log audit
 * 14     log alert
 * 15     clock daemon (note 2)
 * 16     local use 0  (local0)
 * 17     local use 1  (local1)
 * 18     local use 2  (local2)
 * 19     local use 3  (local3)
 * 20     local use 4  (local4)
 * 21     local use 5  (local5)
 * 22     local use 6  (local6)
 * 23     local use 7  (local7)
 *
 * Code   Severity
 * 0      Emergency: system is unusable
 * 1      Alert: action must be taken immediately
 * 2      Critical: critical conditions
 * 3      Error: error conditions
 * 4      Warning: warning conditions
 * 5      Notice: normal but significant condition
 * 6      Informational: informational messages
 * 7      Debug: debug-level messages
 *
 *               Table 2. Syslog Message Severities
 */
