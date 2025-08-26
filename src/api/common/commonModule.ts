import { QueryClient } from '@tanstack/react-query'

import { type IServiceContainer } from '@bipweb/core'

import { environment } from '../../environments'

import { ActivityMonitor, type IActivityMonitor } from './ActivityMonitor'
import { AuthManager, type IAuthManager } from './Authentication'
import { ConfigurationService, type IConfigurationService } from './Config'
import { type ILogService, LogLevel, logService } from './Logger'
import { type INetworkChangeDetector, NetworkChangeDetector } from './Network'
import { type ITaskManager, TaskManager } from './TaskManager'

export class CommonModule {
  private container: IServiceContainer

  constructor(container: IServiceContainer) {
    this.container = container
  }

  public register(): void {
    this.container.registerInstance<QueryClient>(
      'QueryClient',
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5, // Veriyi 5 dakika boyunca taze kabul et
            refetchOnWindowFocus: false // Pencereye odaklanınca otomatik yeniden çekme kapalı
          }
        }
      })
    )
    this.container.registerDependency<IConfigurationService>(
      'ConfigurationService',
      ConfigurationService,
      environment
    )
    this.container.registerInstance<ILogService<any>>('LogService', logService)
    this.container.registerDependency<INetworkChangeDetector>(
      'NetworkChangeDetector',
      NetworkChangeDetector,
      {
        primaryUrl: 'https://pweb.bip.com',
        healthPath: '/health',
        baseIntervalMs: 8000,
        eventOnUnchangedStatus: true,
        incrementEventOnUnchangedStatus: true,
        includeMetricsInEvents: true,
        logger: logService.create({
          name: 'NetworkChangeDetector'
        })
      }
    )
    this.container.registerDependency<IActivityMonitor>(
      'ActivityMonitor',
      ActivityMonitor,
      {
        logger: logService.create({
          name: 'ActivityMonitor',
          minLevel: LogLevel.SILENT
        })
      }
    )
    this.container.registerDependency<ITaskManager>(
      'TaskManager',
      TaskManager,
      {
        logger: logService.create({
          name: 'TaskManager'
        })
      }
    )
    this.container.registerDependency<IAuthManager>(
      'AuthManager',
      AuthManager,
      {
        url: environment.authenticationSocketUrl,
        autoConnect: true,
        logger: logService.create({
          name: 'AuthManager'
        })
      }
    )
  }
}
