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

  it('creates the accounts tables', async () => {
    const rows = await database.db.execute(sql`
      select table_name from information_schema.tables
      where table_name in
        ('user', 'session', 'account', 'verification',
         'api_keys', 'mcp_usage')
    `)
    expect(rows.length).toBe(6)
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
