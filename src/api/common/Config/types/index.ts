import type { z } from 'zod'

import { IServiceWrapper } from '@bipweb/core'

import type { applicationConfigurationSchema } from '../schemes'

export type IApplicationConfiguration = z.infer<
  typeof applicationConfigurationSchema
>

export interface IConfigurationService extends IServiceWrapper {
  /**
   * Current configuration data (readonly to prevent direct modification)
   */
  readonly data: IApplicationConfiguration

  /**
   * Updates configuration with partial data
   * @param value Partial configuration to update
   * @throws Error if validation fails
   */
  setData(value: Partial<IApplicationConfiguration>): void

  /**
   * Gets a specific configuration value by key
   * @param key Configuration key to retrieve
   * @returns Value of the specified configuration key
   */
  get<K extends keyof IApplicationConfiguration>(
    key: K
  ): IApplicationConfiguration[K]

  /**
   * Resets configuration to default values
   */
  resetToDefaults(): void

  /**
   * Checks if a specific configuration key exists and has a valid value
   * @param key Configuration key to check
   * @returns boolean indicating if the key exists and is valid
   */
  has(key: keyof IApplicationConfiguration): boolean
}
