import { createHash } from 'node:crypto'
import type { HttpBindings } from '@hono/node-server'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import type { Config } from './config'
import { getAsset, putAsset } from './db/assets'
import { createBoard, findBoard } from './db/boards'
import type { Db } from './db/client'
import { generateKey, hashKey, type Role, resolveRole } from './keys'
import { log } from './log'
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
 * Behind a reverse proxy that appends to (or replaces)
 * X-Forwarded-For, only the LAST entry is proxy-supplied: a client can
 * prepend any forged address before it. With no proxy in front, every
 * entry is the client's own writing, so the header is ignored and the
 * socket address is the only trustworthy key.
 */
function clientIp(c: Context<Env>, trustProxy: boolean): string {
  if (trustProxy) {
    const parts = c.req.header('x-forwarded-for')?.split(',')
    const last = parts?.[parts.length - 1]?.trim()
    if (last) {
      return last
    }
  }
  // `env` is undefined when the app is driven by `app.request()` in tests.
  return c.env?.incoming?.socket?.remoteAddress || 'unknown'
}

// Raster types only, matched exactly: `image/svg+xml` is a document
// that runs script when opened on this origin, and a prefix match
// would admit it along with every future scriptable image format.
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])

/** Parameters stripped and lowercased, then checked against the raster
 * allowlist. Applied on write and, defensively, on read again: a row
 * written before this normalisation existed (or by any other path than
 * this module's own `PUT`) must never be served back with whatever type
 * it happens to carry. */
function normalizeMime(mime: string): string | null {
  const cleaned = mime.split(';')[0]?.trim().toLowerCase()
  return cleaned && IMAGE_TYPES.has(cleaned) ? cleaned : null
}

export function createApp(deps: HttpDeps): Hono<Env> {
  const { db, config } = deps
  const now = deps.now ?? Date.now
  const app = new Hono<Env>()
  let creationBuckets = new Map<string, BucketEntry>()

  app.use('/boards', cors({ origin: config.corsOrigin }))
  app.use('/boards/*', cors({ origin: config.corsOrigin }))

  // Every route answers the JSON error shape, a failed query included,
  // and every failure leaves one JSON log line rather than a stack.
  app.onError((error, c) => {
    log({ event: 'request failed', path: c.req.path, error: String(error) })
    return c.json({ error: 'internal error' }, 500)
  })

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
    const ip = clientIp(c, config.trustProxy)
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

  const HASH = /^[a-f0-9]{64}$/

  async function roleFromBearer(
    c: Context<Env>,
    boardId: string,
  ): Promise<Role | null> {
    const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
    if (!token) {
      return null
    }
    const board = await findBoard(db, boardId)
    return board ? resolveRole(token, board) : null
  }

  app.put(
    '/boards/:boardId/assets/:hash',
    bodyLimit({
      maxSize: config.maxAssetBytes,
      onError: (c) => c.json({ error: 'asset too large' }, 413),
    }),
    async (c) => {
      const { boardId, hash } = c.req.param()
      if ((await roleFromBearer(c, boardId)) !== 'edit') {
        return c.json({ error: 'edit key required' }, 401)
      }
      // Stored without the client's parameters, so nothing it wrote is
      // ever echoed back in a response header.
      const mime = normalizeMime(c.req.header('content-type') ?? '')
      if (!mime) {
        return c.json({ error: 'only raster images are accepted' }, 415)
      }
      const bytes = new Uint8Array(await c.req.arrayBuffer())
      if (bytes.byteLength > config.maxAssetBytes) {
        return c.json({ error: 'asset too large' }, 413)
      }
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (!HASH.test(hash) || actual !== hash) {
        return c.json({ error: 'hash does not match the content' }, 400)
      }
      const outcome = await putAsset(db, { boardId, hash, mime, bytes })
      return c.json({ hash }, outcome === 'created' ? 201 : 200)
    },
  )

  app.get('/boards/:boardId/assets/:hash', async (c) => {
    const { boardId, hash } = c.req.param()
    if ((await roleFromBearer(c, boardId)) === null) {
      return c.json({ error: 'a board key is required' }, 401)
    }
    const asset = await getAsset(db, boardId, hash)
    if (!asset) {
      return c.json({ error: 'unknown asset' }, 404)
    }
    return c.body(new Uint8Array(asset.bytes), 200, {
      'Content-Type': normalizeMime(asset.mime) ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      // The stored type is an allowlisted raster one, but a cached
      // response lives for a year: never let a sniffing browser
      // reinterpret those bytes as something scriptable.
      'X-Content-Type-Options': 'nosniff',
    })
  })

  return app
}
