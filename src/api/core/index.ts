/*
const root = await navigator.storage.getDirectory()
const estimate = await navigator.storage.estimate()
console.log(estimate.quota && (estimate.quota / 1024 / 1024).toFixed(2) + 'MB')
*/

import 'reflect-metadata'

import { Bootstrapper } from './bootstrapper'

export * from './bootstrapper'
export * from './serviceContainer'
export * from './types'
export * from './utils'

const bootstrapper = new Bootstrapper()

export { bootstrapper }
