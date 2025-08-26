import { inject, injectable } from 'tsyringe'

import { LogServiceImpl } from '../Logger'

import { IService } from './IService'
import { dependsOn } from './utils'

@injectable()
@dependsOn('LogServiceImpl')
export class AuthService implements IService {
  private users = new Map<string, string>() // username:password

  constructor(@inject('LogServiceImpl') private logger: LogServiceImpl<any>) {}

  async init() {
    this.users.set('admin', '1234') // Simülasyon
    this.logger.info('AuthService initialized')
  }

  login(username: string, password: string): boolean {
    const valid = this.users.get(username) === password
    this.logger.info(
      `User ${username} login attempt: ${valid ? 'Success' : 'Failed'}`
    )
    return valid
  }
}
