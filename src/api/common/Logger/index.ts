export * from './logService'
export * from './types'
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
