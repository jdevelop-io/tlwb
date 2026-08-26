import type { HttpBindings } from '@hono/node-server'
import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Config } from './config'
import { createBoard } from './db/boards'
import type { Db } from './db/client'
import { generateKey, hashKey } from './keys'
import { type BucketEntry, createTokenBucket, sweepStale } from './rate-limit'

export interface HttpDeps {
  db: Db
  config: Config
  now?: () => number
}

const BOARD_ID = /^[A-Za-z0-9_-]{8,64}$/
const CREATE_WINDOW_MS = 60_000
const MAX_TRACKED_IPS = 10_000

type Env = { Bindings: HttpBindings }

/**
 * The container sits behind a reverse proxy that appends to (or
 * replaces) X-Forwarded-For, so only the LAST entry is proxy-supplied:
 * a client can prepend any forged address before it. Without a proxy,
 * the socket address is the client.
 */
function clientIp(c: Context<Env>): string {
  const parts = c.req.header('x-forwarded-for')?.split(',')
  const last = parts?.[parts.length - 1]?.trim()
  // `env` is undefined when the app is driven by `app.request()` in tests.
  return last || c.env?.incoming?.socket?.remoteAddress || 'unknown'
}

export function createApp(deps: HttpDeps): Hono<Env> {
  const { db, config } = deps
  const now = deps.now ?? Date.now
  const app = new Hono<Env>()
  let creationBuckets = new Map<string, BucketEntry>()

  app.use('/boards', cors({ origin: config.corsOrigin }))
  app.use('/boards/*', cors({ origin: config.corsOrigin }))

  app.get('/health', (c) => c.json({ ok: true }))

  app.post('/boards', async (c) => {
    const nowMs = now()
    if (creationBuckets.size > MAX_TRACKED_IPS) {
      // ponytail: sweeps only entries idle past the refill window, so an
      // IP currently rate limited keeps its state. Remaining ceiling: if
      // more than MAX_TRACKED_IPS distinct IPs are all active within the
      // same window, the map still grows without bound; per-entry expiry
      // via a proper LRU is the upgrade if that shows up in practice.
      creationBuckets = sweepStale(creationBuckets, nowMs, CREATE_WINDOW_MS)
    }
    const ip = clientIp(c)
    let entry = creationBuckets.get(ip)
    if (!entry) {
      entry = {
        bucket: createTokenBucket(
          config.createLimitPerMin,
          CREATE_WINDOW_MS,
          now,
        ),
        seen: nowMs,
      }
      creationBuckets.set(ip, entry)
    } else {
      entry.seen = nowMs
    }
    if (!entry.bucket.take()) {
      return c.json({ error: 'too many boards created' }, 429)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'body must be JSON' }, 400)
    }
    const boardId =
      typeof body === 'object' && body !== null && 'boardId' in body
        ? body.boardId
        : undefined
    if (typeof boardId !== 'string' || !BOARD_ID.test(boardId)) {
      return c.json({ error: 'boardId must match ^[A-Za-z0-9_-]{8,64}$' }, 400)
    }

    const editKey = generateKey()
    const viewKey = generateKey()
    const outcome = await createBoard(db, boardId, {
      editKeyHash: hashKey(editKey),
      viewKeyHash: hashKey(viewKey),
    })
    if (outcome === 'exists') {
      return c.json({ error: 'board already exists' }, 409)
    }
    return c.json({ boardId, editKey, viewKey }, 201)
  })

  return app
}
