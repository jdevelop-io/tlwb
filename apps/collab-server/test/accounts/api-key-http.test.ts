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

describe('POST/DELETE /me/api-key, GET /me/usage', () => {
  it('answers 401 signed out on all three routes', async () => {
    const a = app()
    expect(
      (await a.request('http://server/me/api-key', { method: 'POST' })).status,
    ).toBe(401)
    expect(
      (await a.request('http://server/me/api-key', { method: 'DELETE' }))
        .status,
    ).toBe(401)
    expect((await a.request('http://server/me/usage')).status).toBe(401)
  })

  it('issues a prefixed key, and regenerating invalidates the previous one', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)

    const first = await a.request('http://server/me/api-key', {
      method: 'POST',
      headers: { cookie },
    })
    expect(first.status).toBe(201)
    const { key: firstKey } = (await first.json()) as { key: string }
    expect(firstKey.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(await resolveApiKey(database.db, firstKey)).toEqual({
      userId: userA,
      plan: 'free',
    })

    const second = await a.request('http://server/me/api-key', {
      method: 'POST',
      headers: { cookie },
    })
    expect(second.status).toBe(201)
    const { key: secondKey } = (await second.json()) as { key: string }
    expect(secondKey).not.toBe(firstKey)
    expect(await resolveApiKey(database.db, firstKey)).toBeNull()
    expect(await resolveApiKey(database.db, secondKey)).toEqual({
      userId: userA,
      plan: 'free',
    })
  })

  it('revokes the active key on delete', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)

    const issued = await a.request('http://server/me/api-key', {
      method: 'POST',
      headers: { cookie },
    })
    const { key } = (await issued.json()) as { key: string }

    const deleted = await a.request('http://server/me/api-key', {
      method: 'DELETE',
      headers: { cookie },
    })
    expect(deleted.status).toBe(204)
    expect(await resolveApiKey(database.db, key)).toBeNull()
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
