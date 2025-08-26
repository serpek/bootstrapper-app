import { type } from 'arktype'
import { injectable } from 'tsyringe'

import { LogServiceImpl } from '../'

import { ConfigSchema, type IConfig } from './config.schema'

const log = LogServiceImpl.instance.create({
  name: 'ConfigService'
})

export interface ConfigService {
  data: IConfig

  setData(value: Partial<IConfig>): void
}

@injectable()
export class ConfigServiceImpl implements ConfigService {
  private static instance: ConfigService

  constructor(config: Partial<IConfig>) {
    log.info('ConfigService created...')

    const validationResult = ConfigSchema(config)
    if (validationResult instanceof type.errors) {
      throw new Error(`Geçersiz config verileri: ${validationResult.summary}`)
    } else {
      this._data = validationResult
    }

    // const validationResult = ConfigSchema.safeParse(config)
    //
    // if (validationResult.success) {
    //   this._data = validationResult.data
    // } else {
    //   throw new Error(`Geçersiz config verileri: ${validationResult.error}`)
    // }
  }

  private _data: IConfig

  get data(): IConfig {
    return this._data
  }

  public static create(config?: Partial<IConfig>): ConfigService {
    if (!ConfigServiceImpl.instance) {
      if (!config) {
        throw new Error('Config parametresi zorunludur.')
      }
      ConfigServiceImpl.instance = new ConfigServiceImpl(config)
    }
    return ConfigServiceImpl.instance
  }

  public setData(value: Partial<IConfig>) {
    const _d = Object.assign(this._data, value)

    const validationResult = ConfigSchema(_d)

    if (validationResult instanceof type.errors) {
      throw new Error(`Geçersiz config verileri: ${validationResult.summary}`)
    } else {
      this._data = validationResult
    }

    // const validationResult = ConfigSchema.safeParse(_d)
    // if (validationResult.success) {
    //   this._data = validationResult.data
    // } else {
    //   throw new Error(`Geçersiz config verileri: ${validationResult.error}`)
    // }
  }
}
