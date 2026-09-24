import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  API_KEY_PREFIX,
  issueApiKey,
  listApiKeys,
  resolveApiKey,
  revokeAllApiKeys,
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

describe('named api keys', () => {
  it('issues several named keys, lists them newest first, resolves scope and stamps last use', async () => {
    const userA = await createUser('pro')
    const laptop = await issueApiKey(database.db, userA, {
      name: 'Claude · laptop',
      boardIds: null,
    })
    const studio = await issueApiKey(database.db, userA, {
      name: 'Claude Code · studio',
      boardIds: ['b1', 'b2'],
    })
    expect(laptop.key.startsWith(API_KEY_PREFIX)).toBe(true)
    const listed = await listApiKeys(database.db, userA)
    expect(listed.map((k) => k.name)).toEqual([
      'Claude Code · studio',
      'Claude · laptop',
    ])
    expect(listed[1]?.lastUsedAt).toBeNull()
    expect(await resolveApiKey(database.db, studio.key)).toEqual({
      userId: userA,
      plan: 'pro',
      keyId: studio.id,
      boardIds: ['b1', 'b2'],
    })
    await new Promise((r) => setTimeout(r, 20))
    const after = await listApiKeys(database.db, userA)
    expect(after.find((k) => k.id === studio.id)?.lastUsedAt).not.toBeNull()
  })

  it('revokes one key by id and leaves the others', async () => {
    const userA = await createUser()
    const a = await issueApiKey(database.db, userA, {
      name: 'a',
      boardIds: null,
    })
    const b = await issueApiKey(database.db, userA, {
      name: 'b',
      boardIds: null,
    })
    expect(await revokeApiKey(database.db, userA, a.id)).toBe(true)
    expect(await revokeApiKey(database.db, userA, a.id)).toBe(false)
    expect(await resolveApiKey(database.db, a.key)).toBeNull()
    expect(await resolveApiKey(database.db, b.key)).not.toBeNull()
    await revokeAllApiKeys(database.db, userA)
    expect(await resolveApiKey(database.db, b.key)).toBeNull()
  })

  it('never revokes another user key, even by a guessed id', async () => {
    const userA = await createUser()
    const userB = await createUser()
    const a = await issueApiKey(database.db, userA, {
      name: 'a',
      boardIds: null,
    })
    expect(await revokeApiKey(database.db, userB, a.id)).toBe(false)
    expect(await resolveApiKey(database.db, a.key)).not.toBeNull()
  })

  it('never lists another user key', async () => {
    const userA = await createUser()
    const userB = await createUser()
    await issueApiKey(database.db, userA, { name: 'a', boardIds: null })
    expect(await listApiKeys(database.db, userB)).toEqual([])
  })

  it('resolves null for unknown and revoked keys', async () => {
    expect(await resolveApiKey(database.db, 'tlwb_nonsense')).toBeNull()
    expect(await resolveApiKey(database.db, 'no-prefix')).toBeNull()
    const userA = await createUser()
    const key = await issueApiKey(database.db, userA, {
      name: 'k',
      boardIds: null,
    })
    // A real, otherwise-valid key hash presented without its prefix must
    // still resolve to null: this is what actually exercises the prefix
    // guard. 'no-prefix' above matches no row either way, prefixed or
    // not, so it would pass even with the guard deleted.
    expect(
      await resolveApiKey(database.db, key.key.slice(API_KEY_PREFIX.length)),
    ).toBeNull()
    await revokeApiKey(database.db, userA, key.id)
    expect(await resolveApiKey(database.db, key.key)).toBeNull()
  })
})
