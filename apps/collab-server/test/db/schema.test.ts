import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectDatabase, type Database } from '../../src/db/client'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

describe('schema migration', () => {
  let database: Database
  beforeAll(async () => {
    database = await connectDatabase(url)
  })
  afterAll(async () => {
    await database.close()
  })

  it('creates the board tables, tolerating extra tables another schema adds, never the account ones', async () => {
    // A shared database may carry tables this migration knows nothing
    // about, added by another schema entirely; the assertion below must
    // survive that, so one is planted here to prove it does.
    await database.db.execute(
      sql`create table if not exists unrelated_schema_probe (id text primary key)`,
    )
    try {
      const rows = await database.db.execute(sql`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
          and table_name not like '\_\_drizzle%'
      `)
      const tableNames = rows.map((row) => String(row.table_name))
      expect(tableNames).toEqual(
        expect.arrayContaining(['assets', 'board_updates', 'boards']),
      )
      for (const accountTable of [
        'user',
        'session',
        'account',
        'verification',
        'api_keys',
        'mcp_usage',
      ]) {
        expect(tableNames).not.toContain(accountTable)
      }
    } finally {
      await database.db.execute(
        sql`drop table if exists unrelated_schema_probe`,
      )
    }
  })

  it('keeps ownership as an opaque column with no foreign key', async () => {
    const columns = await database.db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'boards' and column_name in
        ('owner_id', 'shared_at', 'agent_at', 'thumbnail', 'thumbnail_seq')
    `)
    expect(columns.map((row) => row.column_name).sort()).toEqual([
      'agent_at',
      'owner_id',
      'shared_at',
    ])
    const constraints = await database.db.execute(sql`
      select constraint_name from information_schema.table_constraints
      where table_name = 'boards' and constraint_type = 'FOREIGN KEY'
    `)
    expect(constraints.length).toBe(0)
  })

  it('indexes boards.owner_id', async () => {
    const rows = await database.db.execute(sql`
      select indexname from pg_indexes where indexname = 'boards_owner_id_idx'
    `)
    expect(rows.length).toBe(1)
  })
})
