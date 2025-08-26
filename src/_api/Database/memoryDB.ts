import Dexie, { Table } from 'dexie'

export class MemoryDB<T extends { id: string }> extends Dexie {
  items: Table<T, string>

  constructor(dbName: string) {
    super(dbName, { addons: [] })
    this.version(1).stores({
      items: 'id'
    })

    this.items = this.table('items')
  }
}
