import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config'
import { connectDatabase, type Database } from '../../src/db/client'
import { createApp } from '../../src/http'
import { createRooms } from '../../src/rooms'

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
    TRUST_PROXY: 'true',
    ...overrides,
  })
  return createApp({
    db: database.db,
    config,
    rooms: createRooms({ db: database.db, config }),
  })
}

function get(path: string, ip: string): Request {
  return new Request(`http://server${path}`, {
    headers: { 'x-forwarded-for': ip },
  })
}

function post(path: string, ip: string): Request {
  return new Request(`http://server${path}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  })
}

describe('/auth/* rate limiting', () => {
  it('has its own bucket, sized apart from board creation', async () => {
    const a = app({ AUTH_LIMIT_PER_MIN: '2', CREATE_LIMIT_PER_MIN: '1' })
    expect((await a.request(get('/auth/ok', '1.1.1.1'))).status).toBe(200)
    expect((await a.request(get('/auth/ok', '1.1.1.1'))).status).toBe(200)
    expect((await a.request(get('/auth/ok', '1.1.1.1'))).status).toBe(429)

    // The board-creation bucket (sized at 1) was never touched by the
    // two auth reads above: the first creation from the same address
    // still succeeds.
    expect((await a.request(post('/boards', '1.1.1.1'))).status).toBe(201)
  })

  it('is not exhausted by a spent board-creation bucket', async () => {
    const a = app({ AUTH_LIMIT_PER_MIN: '5', CREATE_LIMIT_PER_MIN: '1' })
    expect((await a.request(post('/boards', '2.2.2.2'))).status).toBe(201)
    expect((await a.request(post('/boards', '2.2.2.2'))).status).toBe(429)

    // A session check from the same address right after still has
    // tokens left in its own bucket.
    expect((await a.request(get('/auth/ok', '2.2.2.2'))).status).toBe(200)
  })
})
