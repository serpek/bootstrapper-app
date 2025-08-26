import { inject, injectable } from 'tsyringe'

import { DatabaseService } from './databaseService'
import { IService } from './IService'
import { dependsOn } from './utils'

@injectable()
@dependsOn('DatabaseService')
export class UserService implements IService {
  constructor(@inject('DatabaseService') private db: DatabaseService) {}

  async init() {
    console.log('UserService initialized')
  }

  async getUserById(userId: string) {
    this.db.query(`SELECT *
                       FROM users
                       WHERE id = ${userId}`)
  }
}
