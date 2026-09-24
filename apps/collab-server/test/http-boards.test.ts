import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config'
import { findBoard } from '../src/db/boards'
import { connectDatabase } from '../src/db/client'
import type { Extension } from '../src/extension'
import { createApp, roleFor } from '../src/http'
import { hashKey } from '../src/keys'
import { createRooms } from '../src/rooms'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function app(
  overrides: Record<string, string> = {},
  now?: () => number,
  extension: Extension = {},
) {
  const config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    ...overrides,
  })
  return createApp({
    db: database.db,
    config,
    rooms: createRooms({ db: database.db, config }),
    now,
    extension,
  })
}

function post(ip = '10.0.0.1') {
  return new Request('http://server/boards', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  })
}

describe('POST /boards', () => {
  it('creates a board under a server-issued id and returns two distinct keys stored hashed', async () => {
    const response = await app().request(post())
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.boardId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(body.editKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.viewKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.editKey).not.toBe(body.viewKey)
    const stored = await findBoard(database.db, body.boardId)
    expect(stored?.editKeyHash.equals(hashKey(body.editKey))).toBe(true)
    expect(stored?.viewKeyHash.equals(hashKey(body.viewKey))).toBe(true)
  })

  it('issues a different id on every call and ignores any body', async () => {
    const first = await (await app().request(post())).json()
    const withBody = new Request('http://server/boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardId: first.boardId }),
    })
    const second = await app().request(withBody)
    expect(second.status).toBe(201)
    expect((await second.json()).boardId).not.toBe(first.boardId)
  })

  it('rate limits creations per IP', async () => {
    const limited = app(
      { CREATE_LIMIT_PER_MIN: '2', TRUST_PROXY: 'true' },
      () => 0,
    )
    expect((await limited.request(post('1.1.1.1'))).status).toBe(201)
    expect((await limited.request(post('1.1.1.1'))).status).toBe(201)
    expect((await limited.request(post('1.1.1.1'))).status).toBe(429)
    expect((await limited.request(post('2.2.2.2'))).status).toBe(201)
  })

  it('is not bypassed by a forged X-Forwarded-For prefix', async () => {
    const limited = app(
      { CREATE_LIMIT_PER_MIN: '1', TRUST_PROXY: 'true' },
      () => 0,
    )
    expect((await limited.request(post('1.1.1.1'))).status).toBe(201)
    expect((await limited.request(post('9.9.9.9, 1.1.1.1'))).status).toBe(429)
  })

  it('ignores X-Forwarded-For entirely without TRUST_PROXY', async () => {
    // The shipped Compose file publishes the port directly, with no
    // proxy in front: there the header is fully client-controlled, so
    // honouring it would make the creation limit a formality.
    const limited = app({ CREATE_LIMIT_PER_MIN: '1' }, () => 0)
    expect((await limited.request(post('1.1.1.1'))).status).toBe(201)
    expect((await limited.request(post('2.2.2.2'))).status).toBe(429)
  })

  it('answers a handler failure as JSON and logs one line', async () => {
    const brokenDb = {
      insert: () => {
        throw new Error('database is down')
      },
    } as never
    const config = loadConfig({ DATABASE_URL: url, CORS_ORIGIN: 'http://a' })
    const broken = createApp({
      db: brokenDb,
      config,
      rooms: createRooms({ db: brokenDb, config }),
    })
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    let response: Response
    try {
      response = await broken.request(post())
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

describe('extension', () => {
  it('ignores a session cookie when no extension identifies', async () => {
    const response = await app().request(
      new Request('http://server/boards', {
        method: 'POST',
        headers: { cookie: 'session_token=stale' },
      }),
    )
    expect(response.status).toBe(201)
    const stored = await findBoard(database.db, (await response.json()).boardId)
    expect(stored?.ownerId).toBeNull()
  })

  it('owns a created board by whoever identify answers', async () => {
    const identified = app({}, undefined, {
      identify: async (headers) =>
        headers.get('x-who') ? { id: headers.get('x-who') as string } : null,
    })
    const response = await identified.request(
      new Request('http://server/boards', {
        method: 'POST',
        headers: { 'x-who': 'p1' },
      }),
    )
    expect(response.status).toBe(201)
    const stored = await findBoard(database.db, (await response.json()).boardId)
    expect(stored?.ownerId).toBe('p1')
  })

  it('refuses creation with 403 when canCreateBoard says no', async () => {
    const capped = app({}, undefined, {
      identify: async () => ({ id: 'p2' }),
      canCreateBoard: async (id) => id !== 'p2',
    })
    const response = await capped.request(post())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'board limit reached' })
  })

  it('mounts extra routes with the core context', async () => {
    const mounted = app({ TRUST_PROXY: 'true' }, () => 0, {
      mount: (hono, ctx) => {
        const limiter = ctx.createIpLimiter(1)
        hono.get('/whoami', (c) =>
          limiter.take(ctx.clientIp(c))
            ? c.json({ ip: ctx.clientIp(c), rooms: typeof ctx.rooms.acquire })
            : c.json({ error: 'too many requests' }, 429),
        )
      },
    })
    const first = await mounted.request(
      new Request('http://server/whoami', {
        headers: { 'x-forwarded-for': '9.9.9.9' },
      }),
    )
    expect(await first.json()).toEqual({ ip: '9.9.9.9', rooms: 'function' })
    const second = await mounted.request(
      new Request('http://server/whoami', {
        headers: { 'x-forwarded-for': '9.9.9.9' },
      }),
    )
    expect(second.status).toBe(429)
  })

  it('lets identify grant the owner edit on assets without a key', async () => {
    const owner = app({}, undefined, { identify: async () => ({ id: 'p3' }) })
    const created = await (await owner.request(post())).json()
    const bytes = new Uint8Array([137, 80, 78, 71])
    const hash = createHash('sha256').update(bytes).digest('hex')
    const put = await owner.request(
      new Request(`http://server/boards/${created.boardId}/assets/${hash}`, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: bytes,
      }),
    )
    expect(put.status).toBe(201)
  })
})

describe('roleFor', () => {
  const board = {
    id: 'b1',
    editKeyHash: hashKey('edit-key'),
    viewKeyHash: hashKey('view-key'),
    ownerId: 'user-1',
  }

  it('owner session grants edit without a key', () => {
    expect(roleFor(board, null, 'user-1')).toBe('edit')
  })

  it('another user falls back to the key', () => {
    expect(roleFor(board, 'view-key', 'user-2')).toBe('view')
  })

  it('no key and no ownership is refused', () => {
    expect(roleFor(board, null, 'user-2')).toBeNull()
  })

  it('owner wins over a weaker key', () => {
    expect(roleFor(board, 'view-key', 'user-1')).toBe('edit')
  })
})
