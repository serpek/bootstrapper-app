console.log('api.ts loaded')
import { container } from 'tsyringe'

import 'reflect-metadata'

import { TaskManager } from './TaskManager/task-manager'
import { LogLevel } from './ActivityMonitor'
import { AuthManager, Status } from './Authentication'
import { InitializationManager } from './initializationManager'
// import {CacheManager, DatabaseSyncFactory, NotificationService} from './Database'
import { LogServiceImpl } from './Logger'
import { config } from './'

const log = LogServiceImpl.instance.create({
  name: 'API'
})

/*const productSchema = type({
  id: 'string',
  name: 'string',
  price: type.number
})

type IProduct = typeof productSchema.infer
const productDb = new DatabaseSyncFactory<IProduct>('Products', productSchema)

DependencyRegistry.registerInstance('ProductDatabase', productDb)
DependencyRegistry.registerInstance('CacheManager', new CacheManager())
DependencyRegistry.registerInstance(
  'NotificationService',
  new NotificationService()
)*/

export class Api {
  authManager: AuthManager
  taskManager: TaskManager

  constructor() {
    log.info('Api')

    this.authManager = new AuthManager(config.data.authSocketAddress, {
      autoConnect: true
    })
    this.authManager.sessionInfo$.subscribe((session) => {
      if (session.status === Status.AUTHORIZED) {
        //
      }
    })

    this.taskManager = new TaskManager({
      logLevel: 'silent',
      logger: LogServiceImpl.instance.create({
        name: 'TaskManager',
        minLevel: LogLevel.SILENT
      }),
      runHistoryLimit: 50,
      defaultTimeoutMs: 10_000,
      percentiles: [0.9, 0.95, 0.99]
    })

    this.taskManager.getEvents$().subscribe((e) => {
      // console.log('[TaskManager][payload]', e)

      if (e.eventType === 'task-error') {
        console.error('[EVENT][ERROR]', e)
      }
    })

    const taskA = this.taskManager.addTask(
      {
        cron: '*/5 * * * * *',
        name: 'SampleTaskA',
        overlapPolicy: 'queue',
        allowManualTrigger: false,
        pauseOnIdle: true
      },
      async (ctx) => {
        if (ctx.abortSignal.aborted) return
        // console.log('TaskA started at', ctx)
        await new Promise((res) => setTimeout(res, 300))
      }
    )

    taskA.getEvents$().subscribe((e) => {
      console.log('[TaskA][payload]', e)
    })

    const taskB = this.taskManager.addTask(
      {
        cron: '*/5 * * * * *',
        name: 'SampleTaskB',
        overlapPolicy: 'parallel',
        allowManualTrigger: false,
        pauseOnIdle: true
      },
      async (ctx) => {
        if (ctx.abortSignal.aborted) return
        // console.log('TaskB started at', ctx)
        await new Promise((res) => setTimeout(res, 300))
      }
    )

    this.taskManager.startAll()

    setInterval(() => {
      console.log('TaskA metrics', this.taskManager.getMetrics(taskA.id))
      console.log('TaskB metrics', this.taskManager.getMetrics(taskB.id))
      console.log('Global metrics', this.taskManager.getMetrics())
    }, 10_000)

    /*
                                                                                                                                                                                                                          this.networkManager.onNetworkChange().subscribe((evt) => {
                                                                                                   console.log('[NetworkManager][onNetworkChange]: ', evt)
                                                                                                   this.activityMonitor.updateNetworkStatus(evt.status === 'online')
                                                                                                 })
                                                                                                 this.networkManager.onNetworkChangeOnce().subscribe((evt) => {
                                                                                                   console.log(
                                                                                                     '[NetworkManager][onNetworkChangeOnce]: ',
                                                                                                     evt.status,
                                                                                                     evt.compositeStatusReason,
                                                                                                     evt.eventIndex
                                                                                                   )
                                                                                                 })
                                                        
                                                                                                 this.networkManager.onError().subscribe((err) => {
                                                                                                   console.warn('[NetworkManager][onError]', err.reason, err.kind)
                                                                                                 })
                                                        
                                                                                                 this.activityMonitor.subscribe((s) =>
                                                                                                   console.log('[ActivityMonitor]', s.isActive, s.reason)
                                                                                                 )
                                                        
                                                                                                 window.addEventListener('beforeunload', () => this.activityMonitor.stop())*/
  }

  public static create(): Api {
    return new Api()
  }

  async main() {
    const initManager = container.resolve(InitializationManager)

    await initManager.initializeAll()

    // const db =
    //   DependencyRegistry.resolve<DatabaseSyncFactory<IProduct>>(
    //     'ProductDatabase'
    //   )
    // await db.addItem({ id: '1', name: 'Ürün 1', price: 100 })

    // new SafePromise((resolve) => {
    //   console.log('resolve promise 1 ')
    //   setTimeout(() => {
    //     resolve(true)
    //   }, 1000)
    // }, 1001)
    //   .then((value) => {
    //     console.log('resolve promise 1 ' + value)
    //   })
    //   .catch(console.error)

    // Promise.all([
    //   new SafePromise<number>(
    //     (resolve) => setTimeout(() => resolve(1), 1000),
    //     3000
    //   ),
    //   new SafePromise<number>(
    //     (resolve) => setTimeout(() => resolve(2), 2000),
    //     3000
    //   ),
    //   new SafePromise<number>(
    //     (resolve) => setTimeout(() => resolve(3), 5000),
    //     3000
    //   )
    // ])
    //   .then(console.log)
    //   .catch(console.error)

    // // Zaman aşımı senaryosu
    // new SafePromise<string>((resolve) => {
    //   console.log('2')
    //   setTimeout(() => resolve('Çok uzun sürdü'), 2500)
    // }, 2000)
    //   .then(console.log)
    //   .catch(console.error) // Error: Promise timed out after 1000ms
    //
    // // Hata senaryosu
    // new SafePromise<string>((_, reject) => {
    //   console.log('3')
    //   setTimeout(() => reject('Bilerek hata verildi'), 500)
    // }, 3000)
    //   .then(console.log)
    //   .catch(console.error) // "Bilerek hata verildi"

    console.log('🚀 Uygulama tamamen başlatıldı!')
  }
}

const API = Api.create()
API.main()

export { API }
