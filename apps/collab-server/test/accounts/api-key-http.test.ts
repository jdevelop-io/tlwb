import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_KEY_PREFIX, resolveApiKey } from '../../src/accounts/api-keys'
import { monthOf } from '../../src/accounts/quota'
import { loadConfig } from '../../src/config'
import { connectDatabase, type Database } from '../../src/db/client'
import { session, user } from '../../src/db/schema'
import { createApp } from '../../src/http'
import { createRooms } from '../../src/rooms'
import { sessionCookie } from '../session-cookie'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

const AUTH_SECRET = 'test-secret-at-least-32-characters!!'

let database: Database

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function app(overrides: Record<string, string> = {}) {
  const config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    AUTH_SECRET,
    GITHUB_CLIENT_ID: 'gid',
    GITHUB_CLIENT_SECRET: 'gsec',
    ...overrides,
  })
  return createApp({
    db: database.db,
    config,
    rooms: createRooms({ db: database.db, config }),
  })
}

async function createUser(plan: 'free' | 'pro' = 'free'): Promise<string> {
  const id = randomUUID()
  await database.db
    .insert(user)
    .values({ id, name: 'Ada', email: `${id}@example.com`, plan })
  return id
}

async function cookieFor(userId: string): Promise<string> {
  const token = randomUUID()
  await database.db.insert(session).values({
    id: randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return sessionCookie(token, AUTH_SECRET)
}

describe('GET/POST /me/api-keys, DELETE /me/api-keys/:id, GET /me/usage', () => {
  it('answers 401 signed out on all three routes', async () => {
    const a = app()
    expect((await a.request('http://server/me/api-keys')).status).toBe(401)
    expect(
      (await a.request('http://server/me/api-keys', { method: 'POST' })).status,
    ).toBe(401)
    expect(
      (
        await a.request('http://server/me/api-keys/whatever', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(401)
    expect((await a.request('http://server/me/usage')).status).toBe(401)
  })

  it('issues a prefixed key and lists it with a null lastUsedAt', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)

    const created = await a.request('http://server/me/api-keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Claude · laptop' }),
    })
    expect(created.status).toBe(201)
    const { id, key } = (await created.json()) as { id: string; key: string }
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true)

    const listed = await a.request('http://server/me/api-keys', {
      headers: { cookie },
    })
    expect(listed.status).toBe(200)
    const { keys } = (await listed.json()) as {
      keys: { id: string; name: string; lastUsedAt: string | null }[]
    }
    expect(keys).toEqual([
      expect.objectContaining({
        id,
        name: 'Claude · laptop',
        lastUsedAt: null,
      }),
    ])
  })

  it('rejects an empty name with 400', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)

    const created = await a.request('http://server/me/api-keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  ' }),
    })
    expect(created.status).toBe(400)
  })

  it('rejects boardIds naming a board the user does not own with 400', async () => {
    const a = app()
    const userA = await createUser()
    const userB = await createUser()
    const cookieA = await cookieFor(userA)
    const cookieB = await cookieFor(userB)

    const boardCreated = await a.request('http://server/boards', {
      method: 'POST',
      headers: { cookie: cookieB },
    })
    expect(boardCreated.status).toBe(201)
    const { boardId } = (await boardCreated.json()) as { boardId: string }

    const created = await a.request('http://server/me/api-keys', {
      method: 'POST',
      headers: { cookie: cookieA, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'scoped', boardIds: [boardId] }),
    })
    expect(created.status).toBe(400)
  })

  it('rejects an empty boardIds array with 400', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)

    const created = await a.request('http://server/me/api-keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'scoped to nothing', boardIds: [] }),
    })
    expect(created.status).toBe(400)
  })

  it('never lets one user delete another user key by id', async () => {
    const a = app()
    const userA = await createUser()
    const userB = await createUser()
    const cookieA = await cookieFor(userA)
    const cookieB = await cookieFor(userB)

    const created = await a.request('http://server/me/api-keys', {
      method: 'POST',
      headers: { cookie: cookieA, 'content-type': 'application/json' },
      body: JSON.stringify({ name: "A's key" }),
    })
    const { id, key } = (await created.json()) as { id: string; key: string }

    const deletedByB = await a.request(`http://server/me/api-keys/${id}`, {
      method: 'DELETE',
      headers: { cookie: cookieB },
    })
    expect(deletedByB.status).toBe(404)
    expect(await resolveApiKey(database.db, key)).not.toBeNull()
  })

  it('revokes a key by id, 204 then 404', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)

    const created = await a.request('http://server/me/api-keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'to revoke' }),
    })
    const { id } = (await created.json()) as { id: string }

    const deleted = await a.request(`http://server/me/api-keys/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(deleted.status).toBe(204)

    const again = await a.request(`http://server/me/api-keys/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(again.status).toBe(404)
  })

  it('reports the current month, usage count and the plan limit', async () => {
    const a = app({ MCP_QUOTA_FREE: '1000', MCP_QUOTA_PRO: '50000' })
    const userA = await createUser('free')
    const cookie = await cookieFor(userA)

    const empty = await a.request('http://server/me/usage', {
      headers: { cookie },
    })
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual({
      month: monthOf(Date.now()),
      count: 0,
      limit: 1000,
    })

    const userB = await createUser('pro')
    const cookieB = await cookieFor(userB)
    const pro = await a.request('http://server/me/usage', {
      headers: { cookie: cookieB },
    })
    expect((await pro.json()).limit).toBe(50000)
  })
})
