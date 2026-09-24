import { createHash } from 'node:crypto'
import type { HttpBindings } from '@hono/node-server'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type { Config } from './config'
import { getAsset, putAsset } from './db/assets'
import { type BoardRecord, findBoard } from './db/boards'
import type { Db } from './db/client'
import { type Extension, identify } from './extension'
import { issueBoard } from './issue-board'
import { type Role, resolveRole } from './keys'
import { log } from './log'
import { createMcpApp } from './mcp'
import { createIpLimiter, type IpLimiter } from './rate-limit'
import type { RoomRegistry } from './rooms'

export interface HttpDeps {
  db: Db
  config: Config
  rooms: RoomRegistry
  now?: () => number
  /** Shared with the MCP `create_board` tool; created here when absent. */
  createLimiter?: IpLimiter
  /** What the deployment adds on top; nothing by default. */
  extension?: Extension
}

type Env = { Bindings: HttpBindings }

/**
 * Behind a reverse proxy that appends to (or replaces)
 * X-Forwarded-For, only the LAST entry is proxy-supplied: a client can
 * prepend any forged address before it. With no proxy in front, every
 * entry is the client's own writing, so the header is ignored and the
 * socket address is the only trustworthy key.
 */
export function clientIp(c: Context<Env>, trustProxy: boolean): string {
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

/**
 * The board's owner (whoever the extension identified) always edits, no
 * key needed; anyone else falls back to the token the request presented.
 * Side effect free.
 */
export function roleFor(
  board: BoardRecord,
  token: string | null,
  principalId: string | null,
): Role | null {
  if (principalId && board.ownerId === principalId) {
    return 'edit'
  }
  return token ? resolveRole(token, board) : null
}

export function createApp(deps: HttpDeps): Hono<Env> {
  const { db, config } = deps
  const now = deps.now ?? Date.now
  const extension = deps.extension ?? {}
  const app = new Hono<Env>()
  const createLimiter: IpLimiter =
    deps.createLimiter ?? createIpLimiter(config.createLimitPerMin, 60_000, now)
  const renderLimiter: IpLimiter = createIpLimiter(
    config.mcpRenderLimitPerMin,
    60_000,
    now,
  )

  app.use('/boards', cors({ origin: config.corsOrigin }))
  app.use('/boards/*', cors({ origin: config.corsOrigin }))

  // Every route answers the JSON error shape, a failed query included,
  // and every failure leaves one JSON log line rather than a stack.
  // An `HTTPException` (raised by `/mcp`'s transport for a protocol
  // violation such as a malformed body or a bad Accept header) already
  // carries the correct status and body: honour it, the same way
  // Hono's own default error handler does, instead of flattening it
  // into a generic 500.
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse()
    }
    log({ event: 'request failed', path: c.req.path, error: String(error) })
    return c.json({ error: 'internal error' }, 500)
  })

  app.get('/health', (c) => c.json({ ok: true }))

  extension.mount?.(app, {
    db,
    config,
    rooms: deps.rooms,
    clientIp: (c) => clientIp(c, config.trustProxy),
    createIpLimiter: (perMinute) => createIpLimiter(perMinute, 60_000, now),
  })

  app.post('/boards', async (c) => {
    if (!createLimiter.take(clientIp(c, config.trustProxy))) {
      return c.json({ error: 'too many boards created' }, 429)
    }
    const principal = await identify(extension, c.req.raw.headers)
    if (
      principal &&
      extension.canCreateBoard &&
      !(await extension.canCreateBoard(principal.id))
    ) {
      return c.json({ error: 'board limit reached' }, 403)
    }
    const issued = await issueBoard(db, principal?.id)
    if (!issued) {
      return c.json({ error: 'internal error' }, 500)
    }
    return c.json(issued, 201)
  })

  const HASH = /^[a-f0-9]{64}$/

  async function requestRole(
    c: Context<Env>,
    boardId: string,
  ): Promise<Role | null> {
    const board = await findBoard(db, boardId)
    if (!board) {
      return null
    }
    const token =
      c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? null
    const principal = await identify(extension, c.req.raw.headers)
    return roleFor(board, token, principal?.id ?? null)
  }

  app.put(
    '/boards/:boardId/assets/:hash',
    bodyLimit({
      maxSize: config.maxAssetBytes,
      onError: (c) => c.json({ error: 'asset too large' }, 413),
    }),
    async (c) => {
      const { boardId, hash } = c.req.param()
      if ((await requestRole(c, boardId)) !== 'edit') {
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
    if ((await requestRole(c, boardId)) === null) {
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

  const mcpApp = createMcpApp({
    db,
    config,
    rooms: deps.rooms,
    createLimiter,
    renderLimiter,
    extension,
    now,
    trustProxy: config.trustProxy,
  })
  // `app.route('/mcp', ...)` alone answers `/mcp` but 404s on
  // `/mcp/`, and mounting at `/mcp/` instead flips which one is
  // unmatched: the same sub-app is routed at both so a client that
  // normalises the trailing slash still reaches it.
  app.route('/mcp', mcpApp)
  app.route('/mcp/', mcpApp)

  return app
}
