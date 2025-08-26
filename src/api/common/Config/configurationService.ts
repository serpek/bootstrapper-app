import { inject, singleton } from 'tsyringe'
import { z } from 'zod'

import { dependsOn } from '@bipweb/core'

import { type ILogService } from '../'

import { applicationConfigurationSchema } from './schemes'
import type { IApplicationConfiguration, IConfigurationService } from './types'

@dependsOn('LogService')
@singleton()
export class ConfigurationService implements IConfigurationService {
  isInitialized = false
  private readonly _name: string = 'ConfigurationService'
  private _logger: ILogService<any>

  constructor(@inject('LogService') private logger: ILogService<any>) {
    this._logger = this.logger.create({
      name: this._name
    })
    this._logger.init(`${this._name} created...`)

    this._data = applicationConfigurationSchema.parse({})
  }

  private _data: IApplicationConfiguration

  public get data(): IApplicationConfiguration {
    return { ...this._data } // Return a copy to prevent direct modification
  }

  public init(): void {
    if (!this.isInitialized) {
      this.isInitialized = true
      // this._logger.debug(`${this._name} initialized`)
      //await sleep(1000)
    }
  }

  public configure(): void {
    // No configuration needed for now
  }

  public get<K extends keyof IApplicationConfiguration>(
    key: K
  ): IApplicationConfiguration[K] {
    return this.data[key]
  }

  public has(key: keyof IApplicationConfiguration): boolean {
    return (
      key in this._data &&
      this._data[key] !== undefined &&
      this._data[key] !== null
    )
  }

  public resetToDefaults(): void {
    this._data = applicationConfigurationSchema.parse({})
  }

  public setData(value: Partial<IApplicationConfiguration>): void {
    try {
      this.validateAndSet(value)
    } catch (error) {
      this._logger.error('Failed to update configuration', error)
      throw error
    }
  }

  private validateAndSet(config?: Partial<IApplicationConfiguration>): void {
    try {
      const mergedConfig = { ...this._data, ...config }
      this._data = applicationConfigurationSchema.parse(mergedConfig)
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid config data: ${error.issues.map((issue) => issue.message).join(', ')}`
        )
      }
      console.error('Unexpected error during config validation:', error)
      throw error
    }
  }
}
