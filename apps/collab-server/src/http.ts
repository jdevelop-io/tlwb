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
      const mime = c.req.header('content-type') ?? ''
      if (!mime.startsWith('image/')) {
        return c.json({ error: 'only images are accepted' }, 415)
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
      'Content-Type': asset.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
  })

  return app
}
