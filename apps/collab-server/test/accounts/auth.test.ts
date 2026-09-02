import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuth, sessionUser } from '../../src/accounts/auth'
import { loadConfig } from '../../src/config'
import { connectDatabase, type Database } from '../../src/db/client'
import { session, user } from '../../src/db/schema'
import { sessionCookie } from '../session-cookie'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

const env = {
  DATABASE_URL: url,
  CORS_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-at-least-32-characters!!',
  GITHUB_CLIENT_ID: 'gid',
  GITHUB_CLIENT_SECRET: 'gsec',
}

describe('createAuth', () => {
  let database: Database
  beforeAll(async () => {
    database = await connectDatabase(url)
  })
  afterAll(async () => {
    await database.close()
  })

  it('is null without accounts config', () => {
    const config = loadConfig({ DATABASE_URL: url, CORS_ORIGIN: '*' })
    expect(createAuth({ db: database.db, config })).toBeNull()
  })

  it('answers ok on its own routes', async () => {
    const auth = createAuth({ db: database.db, config: loadConfig(env) })
    expect(auth).not.toBeNull()
    const response = await auth?.handler(
      new Request('http://localhost:3000/auth/ok'),
    )
    expect(response?.status).toBe(200)
  })

  it('resolves no session from empty headers', async () => {
    const auth = createAuth({ db: database.db, config: loadConfig(env) })
    expect(await sessionUser(auth, new Headers())).toBeNull()
  })

  it('resolves null against a disabled auth', async () => {
    expect(await sessionUser(null, new Headers())).toBeNull()
  })

  it('normalizes plan, image and stripeCustomerId from a real session', async () => {
    const config = loadConfig(env)
    const auth = createAuth({ db: database.db, config })
    const userId = randomUUID()
    await database.db.insert(user).values({
      id: userId,
      name: 'Real User',
      email: `${userId}@example.com`,
    })
    const token = randomUUID()
    await database.db.insert(session).values({
      id: randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    const cookie = sessionCookie(token, config.accounts?.secret as string)
    expect(await sessionUser(auth, new Headers({ cookie }))).toEqual({
      id: userId,
      name: 'Real User',
      email: `${userId}@example.com`,
      image: null,
      plan: 'free',
      stripeCustomerId: null,
    })
  })
})
