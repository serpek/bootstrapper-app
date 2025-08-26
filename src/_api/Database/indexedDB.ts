import Dexie, { Table } from 'dexie'

export class IndexedDB extends Dexie {
  items: Table<{ id: string; data: string }, string>

  constructor(dbName: string) {
    super(dbName)
    this.version(1).stores({
      items: 'id'
    })

    this.items = this.table('items')
  }
}
