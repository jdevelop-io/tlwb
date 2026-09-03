import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { monthOf, readUsage, spendQuota } from '../../src/accounts/quota'
import { connectDatabase, type Database } from '../../src/db/client'
import { user } from '../../src/db/schema'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

let database: Database

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

async function createUser(): Promise<string> {
  const id = randomUUID()
  await database.db
    .insert(user)
    .values({ id, name: 'Agent Owner', email: `${id}@example.com` })
  return id
}

describe('monthOf', () => {
  it('formats UTC months', () => {
    expect(monthOf(Date.UTC(2026, 7, 28))).toBe('2026-08')
  })
})

describe('spendQuota / readUsage', () => {
  it('counts up and stops at the limit', async () => {
    const userA = await createUser()
    expect(await spendQuota(database.db, userA, '2026-08', 2)).toBe(true)
    expect(await spendQuota(database.db, userA, '2026-08', 2)).toBe(true)
    expect(await spendQuota(database.db, userA, '2026-08', 2)).toBe(false)
    expect(await readUsage(database.db, userA, '2026-08')).toBe(2)
  })

  it('a zero limit spends nothing against an existing counter', async () => {
    const userA = await createUser()
    expect(await spendQuota(database.db, userA, '2026-08', 2)).toBe(true)
    expect(await spendQuota(database.db, userA, '2026-08', 0)).toBe(false)
    expect(await readUsage(database.db, userA, '2026-08')).toBe(1)
  })

  // Distinct from the case above: no row exists yet for this user and
  // month, so a naive insert-on-no-conflict path would spend one unit
  // unconditionally. The explicit `limit < 1` guard must catch this
  // before any row is written.
  it('a zero limit spends nothing on a fresh counter', async () => {
    const userA = await createUser()
    expect(await spendQuota(database.db, userA, '2026-08', 0)).toBe(false)
    expect(await readUsage(database.db, userA, '2026-08')).toBe(0)
  })

  it('a new month starts a fresh counter', async () => {
    const userA = await createUser()
    expect(await spendQuota(database.db, userA, '2026-08', 2)).toBe(true)
    expect(await spendQuota(database.db, userA, '2026-08', 2)).toBe(true)
    expect(await spendQuota(database.db, userA, '2026-09', 2)).toBe(true)
    expect(await readUsage(database.db, userA, '2026-09')).toBe(1)
  })

  it('reads zero usage for a user with no recorded spend', async () => {
    const userA = await createUser()
    expect(await readUsage(database.db, userA, '2026-08')).toBe(0)
  })
})
