import { inject, injectable } from 'tsyringe'

import { LogServiceImpl } from '../Logger'

import { IService } from './IService'
import { dependsOn } from './utils'

@injectable()
@dependsOn('LogServiceImpl')
export class ErrorService implements IService {
  constructor(@inject('LogServiceImpl') private logger: LogServiceImpl<any>) {}

  async init() {
    console.log('ErrorService initialized')
  }

  logError(error: Error) {
    this.logger.info(`ERROR: ${error.message}`)
  }
}
