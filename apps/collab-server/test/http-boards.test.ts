import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config'
import { findBoard } from '../src/db/boards'
import { connectDatabase } from '../src/db/client'
import { createApp } from '../src/http'
import { hashKey } from '../src/keys'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function app(overrides: Record<string, string> = {}, now?: () => number) {
  return createApp({
    db: database.db,
    config: loadConfig({
      DATABASE_URL: url,
      CORS_ORIGIN: 'http://a',
      ...overrides,
    }),
    now,
  })
}

function post(body: unknown, ip = '10.0.0.1') {
  return new Request('http://server/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

describe('POST /boards', () => {
  it('creates a board and returns two distinct keys stored hashed', async () => {
    const boardId = randomUUID()
    const response = await app().request(post({ boardId }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.boardId).toBe(boardId)
    expect(body.editKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.viewKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.editKey).not.toBe(body.viewKey)
    const stored = await findBoard(database.db, boardId)
    expect(stored?.editKeyHash.equals(hashKey(body.editKey))).toBe(true)
    expect(stored?.viewKeyHash.equals(hashKey(body.viewKey))).toBe(true)
  })

  it('answers 409 without keys on an existing board', async () => {
    const boardId = randomUUID()
    await app().request(post({ boardId }))
    const response = await app().request(post({ boardId }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'board already exists' })
  })

  it('answers 400 on a malformed identifier or body', async () => {
    expect((await app().request(post({ boardId: 'short' }))).status).toBe(400)
    expect(
      (await app().request(post({ boardId: 'has space in it' }))).status,
    ).toBe(400)
    expect((await app().request(post({}))).status).toBe(400)
    const notJson = new Request('http://server/boards', {
      method: 'POST',
      body: 'nope',
    })
    expect((await app().request(notJson)).status).toBe(400)
  })

  it('rate limits creations per IP', async () => {
    const limited = app(
      { CREATE_LIMIT_PER_MIN: '2', TRUST_PROXY: 'true' },
      () => 0,
    )
    expect(
      (await limited.request(post({ boardId: randomUUID() }, '1.1.1.1')))
        .status,
    ).toBe(201)
    expect(
      (await limited.request(post({ boardId: randomUUID() }, '1.1.1.1')))
        .status,
    ).toBe(201)
    expect(
      (await limited.request(post({ boardId: randomUUID() }, '1.1.1.1')))
        .status,
    ).toBe(429)
    expect(
      (await limited.request(post({ boardId: randomUUID() }, '2.2.2.2')))
        .status,
    ).toBe(201)
  })

  it('is not bypassed by a forged X-Forwarded-For prefix', async () => {
    const limited = app(
      { CREATE_LIMIT_PER_MIN: '1', TRUST_PROXY: 'true' },
      () => 0,
    )
    expect(
      (await limited.request(post({ boardId: randomUUID() }, '1.1.1.1')))
        .status,
    ).toBe(201)
    expect(
      (
        await limited.request(
          post({ boardId: randomUUID() }, '9.9.9.9, 1.1.1.1'),
        )
      ).status,
    ).toBe(429)
  })

  it('ignores X-Forwarded-For entirely without TRUST_PROXY', async () => {
    // The shipped Compose file publishes the port directly, with no
    // proxy in front: there the header is fully client-controlled, so
    // honouring it would make the creation limit a formality.
    const limited = app({ CREATE_LIMIT_PER_MIN: '1' }, () => 0)
    expect(
      (await limited.request(post({ boardId: randomUUID() }, '1.1.1.1')))
        .status,
    ).toBe(201)
    expect(
      (await limited.request(post({ boardId: randomUUID() }, '2.2.2.2')))
        .status,
    ).toBe(429)
  })

  it('answers a handler failure as JSON and logs one line', async () => {
    const broken = createApp({
      db: {
        insert: () => {
          throw new Error('database is down')
        },
      } as never,
      config: loadConfig({ DATABASE_URL: url, CORS_ORIGIN: 'http://a' }),
    })
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    let response: Response
    try {
      response = await broken.request(post({ boardId: randomUUID() }))
    } finally {
      spy.mockRestore()
    }
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal error' })
    expect(
      lines.some((line) => {
        const parsed = JSON.parse(line) as { event?: string; error?: string }
        return (
          parsed.event === 'request failed' &&
          String(parsed.error).includes('database is down')
        )
      }),
    ).toBe(true)
  })

  it('serves health and CORS headers', async () => {
    const health = await app().request('http://server/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true })
    const preflight = await app().request('http://server/boards', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://a',
        'access-control-request-method': 'POST',
      },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'http://a',
    )
  })
})
