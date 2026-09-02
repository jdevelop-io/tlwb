import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  issueApiKey,
  resolveApiKey,
  revokeApiKey,
} from '../../src/accounts/api-keys'
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

async function createUser(plan: 'free' | 'pro' = 'free'): Promise<string> {
  const id = randomUUID()
  await database.db
    .insert(user)
    .values({ id, name: 'Agent Owner', email: `${id}@example.com`, plan })
  return id
}

describe('issueApiKey / resolveApiKey / revokeApiKey', () => {
  it('issues a prefixed key and resolves it to its user and plan', async () => {
    const userA = await createUser('pro')
    const key = await issueApiKey(database.db, userA)
    expect(key.startsWith('tlwb_')).toBe(true)
    expect(await resolveApiKey(database.db, key)).toEqual({
      userId: userA,
      plan: 'pro',
    })
  })

  it('regenerating revokes the previous key', async () => {
    const userA = await createUser()
    const first = await issueApiKey(database.db, userA)
    await issueApiKey(database.db, userA)
    expect(await resolveApiKey(database.db, first)).toBeNull()
  })

  it('resolves null for unknown and revoked keys', async () => {
    expect(await resolveApiKey(database.db, 'tlwb_nonsense')).toBeNull()
    expect(await resolveApiKey(database.db, 'no-prefix')).toBeNull()
    const userA = await createUser()
    const key = await issueApiKey(database.db, userA)
    await revokeApiKey(database.db, userA)
    expect(await resolveApiKey(database.db, key)).toBeNull()
  })
})
