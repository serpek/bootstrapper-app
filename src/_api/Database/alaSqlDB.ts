import alasql from 'alasql'

export class QueryBuilder {
  private tableName: string
  private columns: string[] = []
  private whereClauses: string[] = []
  private orderByClause: string = ''
  private groupByClause: string = ''
  private joinClauses: string[] = []

  constructor(tableName: string) {
    this.tableName = tableName
  }

  public select(columns: string[]): QueryBuilder {
    this.columns = columns
    return this
  }

  public where(condition: string): QueryBuilder {
    this.whereClauses.push(condition)
    return this
  }

  public orderBy(
    column: string,
    direction: 'ASC' | 'DESC' = 'ASC'
  ): QueryBuilder {
    this.orderByClause = `ORDER BY ${column} ${direction}`
    return this
  }

  public groupBy(column: string): QueryBuilder {
    this.groupByClause = `GROUP BY ${column}`
    return this
  }

  public join(
    type: 'INNER' | 'LEFT' | 'RIGHT',
    table: string,
    onCondition: string
  ): QueryBuilder {
    this.joinClauses.push(`${type} JOIN ${table} ON ${onCondition}`)
    return this
  }

  public build(): string {
    let query = `SELECT ${this.columns.length > 0 ? this.columns.join(', ') : '*'}
                     FROM ${this.tableName}`

    if (this.joinClauses.length > 0) {
      query += ' ' + this.joinClauses.join(' ')
    }

    if (this.whereClauses.length > 0) {
      query += ' WHERE ' + this.whereClauses.join(' AND ')
    }

    if (this.groupByClause) {
      query += ' ' + this.groupByClause
    }

    if (this.orderByClause) {
      query += ' ' + this.orderByClause
    }

    return query
  }
}

class BaseQuery<T extends { id: string }> {
  private tableName: string

  constructor(tableName: string) {
    this.tableName = tableName
  }

  public getAll(): T[] {
    return alasql(`SELECT *
                       FROM ${this.tableName}`) as T[]
  }

  public getById(id: string): T | undefined {
    const result = alasql(
      `SELECT *
             FROM ${this.tableName}
             WHERE id = ?`,
      [id]
    ) as T[]
    return result.length > 0 ? result[0] : undefined
  }

  public executeQuery(query: string): T[] {
    return alasql(query) as T[]
  }
}

export class ProductQuery extends BaseQuery<{
  id: string
  name: string
  price: number
  category: string
}> {
  constructor() {
    super('Products')
  }

  public getByCategory(category: string) {
    return this.executeQuery(`SELECT *
                                  FROM Products
                                  WHERE category = '${category}'`)
  }

  public getByPriceRange(minPrice: number, maxPrice: number) {
    return this.executeQuery(`SELECT *
                                  FROM Products
                                  WHERE price BETWEEN ${minPrice} AND ${maxPrice}`)
  }

  public getTopExpensiveProducts(limit: number = 5) {
    return this.executeQuery(`SELECT *
                                  FROM Products
                                  ORDER BY price DESC LIMIT ${limit}`)
  }
}

//
// alasql(`CREATE TABLE IF NOT EXISTS Products
//         (
//           id
//           STRING
//           PRIMARY
//           KEY,
//           name
//           STRING,
//           price
//           NUMBER,
//           category
//           STRING
//         )`)
//
// const query = new QueryBuilder('Products')
//   .select(['id', 'name', 'price'])
//   .where('price > 100')
//   .orderBy('price', 'DESC')
//   .build()
//
// console.log('⚡ Dinamik Sorgu Sonucu:', alasql(query))

export class AlaSqlDB<T extends { id: string }> {
  private tableName: string

  constructor(dbName: string) {
    this.tableName = `${dbName}_memory`
    alasql(`CREATE TABLE IF NOT EXISTS ${this.tableName}
                (
                    id
                    STRING
                    PRIMARY
                    KEY,
                    data
                    JSON
                )`)
  }

  public async put(item: T): Promise<void> {
    alasql(
      `INSERT
            OR REPLACE INTO
            ${this.tableName}
            VALUES
            (
            ?,
            ?
            )`,
      [item.id, JSON.stringify(item)]
    )
  }

  public async getAll(): Promise<T[]> {
    const rows: { data: string }[] = alasql(`SELECT data
                                                 FROM ${this.tableName}`)

    return rows.map((row) => {
      try {
        return JSON.parse(row.data) as T
      } catch (error) {
        console.error('❌ JSON parse hatası:', error)
        return {} as T
      }
    })
  }

  public async delete(id: string): Promise<void> {
    alasql(
      `DELETE
             FROM ${this.tableName}
             WHERE id = ?`,
      [id]
    )
  }
}
