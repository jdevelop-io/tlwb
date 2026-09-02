import { createHash } from 'node:crypto'
import type { HttpBindings } from '@hono/node-server'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type Stripe from 'stripe'
import { z } from 'zod'
import { issueApiKey, revokeApiKey } from './accounts/api-keys'
import { type Auth, createAuth, sessionUser } from './accounts/auth'
import { monthOf, readUsage } from './accounts/quota'
import { createBillingApp } from './billing/routes'
import { readBoardStore } from './board-read'
import type { Config } from './config'
import { getAsset, putAsset } from './db/assets'
import {
  type BoardRecord,
  claimBoard,
  countOwnedBoards,
  deleteBoardRows,
  findBoard,
  listOwnedBoards,
} from './db/boards'
import type { Db } from './db/client'
import { issueBoard } from './issue-board'
import { type Role, resolveRole } from './keys'
import { log } from './log'
import { createMcpApp } from './mcp'
import { createIpLimiter, type IpLimiter } from './rate-limit'
import type { RoomRegistry } from './rooms'
import { boardThumbnail, ThumbnailBudgetExceededError } from './thumbnail'

export interface HttpDeps {
  db: Db
  config: Config
  rooms: RoomRegistry
  now?: () => number
  /** Shared with the MCP `create_board` tool; created here when absent. */
  createLimiter?: IpLimiter
  /** Created from config when absent; explicitly `null` to disable it. */
  auth?: Auth | null
  /** Injected by tests; created from config.billing when absent. */
  stripe?: Stripe
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
 * A session belonging to the board's owner always grants edit, no key
 * needed; anyone else falls back to the token the request presented.
 * Side effect free.
 */
export function roleFor(
  board: BoardRecord,
  token: string | null,
  userId: string | null,
): Role | null {
  if (userId && board.ownerId === userId) {
    return 'edit'
  }
  return token ? resolveRole(token, board) : null
}

export function createApp(deps: HttpDeps): Hono<Env> {
  const { db, config } = deps
  const now = deps.now ?? Date.now
  const app = new Hono<Env>()
  const createLimiter: IpLimiter =
    deps.createLimiter ?? createIpLimiter(config.createLimitPerMin, 60_000, now)
  const renderLimiter: IpLimiter = createIpLimiter(
    config.mcpRenderLimitPerMin,
    60_000,
    now,
  )
  const auth = deps.auth === undefined ? createAuth({ db, config }) : deps.auth
  if (auth) {
    // Reusing `createLimiter`'s budget for `/auth/*` is deliberate: both
    // are account-shaped write endpoints; a dedicated bucket is not
    // worth a new knob.
    app.use('/auth/*', async (c, next) => {
      if (!createLimiter.take(clientIp(c, config.trustProxy))) {
        return c.json({ error: 'too many requests' }, 429)
      }
      await next()
    })
    app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
  }

  if (config.billing) {
    app.route(
      '/billing',
      createBillingApp({ db, config, auth, stripe: deps.stripe }),
    )
  }

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

  app.post('/boards', async (c) => {
    if (!createLimiter.take(clientIp(c, config.trustProxy))) {
      return c.json({ error: 'too many boards created' }, 429)
    }
    const user = await sessionUser(auth, c.req.raw.headers)
    if (user && user.plan === 'free') {
      // ponytail: read-then-insert races can overshoot the cap by a
      // concurrent request or two; a serialized check is not worth it
      // for a fair-use limit.
      if ((await countOwnedBoards(db, user.id)) >= config.freeBoardCap) {
        return c.json({ error: 'board limit reached' }, 403)
      }
    }
    const issued = await issueBoard(db, user?.id)
    if (!issued) {
      return c.json({ error: 'internal error' }, 500)
    }
    return c.json(issued, 201)
  })

  const adoptBody = z.object({
    boards: z
      .array(
        z.object({
          boardId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
          editKey: z.string().min(1).max(128),
        }),
      )
      .max(50),
  })

  app.post('/boards/adopt', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    const parsed = adoptBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'invalid body' }, 400)
    }
    const adopted: string[] = []
    const skipped: string[] = []
    for (const entry of parsed.data.boards) {
      const board = await findBoard(db, entry.boardId)
      if (!board || resolveRole(entry.editKey, board) !== 'edit') {
        skipped.push(entry.boardId)
        continue
      }
      if (board.ownerId === user.id) {
        adopted.push(entry.boardId)
        continue
      }
      if (board.ownerId !== null) {
        skipped.push(entry.boardId)
        continue
      }
      const capped =
        user.plan === 'free' &&
        (await countOwnedBoards(db, user.id)) >= config.freeBoardCap
      if (capped) {
        skipped.push(entry.boardId)
        continue
      }
      if (await claimBoard(db, entry.boardId, user.id)) {
        adopted.push(entry.boardId)
      } else {
        skipped.push(entry.boardId)
      }
    }
    return c.json({ adopted, skipped })
  })

  app.get('/me', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    return c.json({
      user: {
        name: user.name,
        email: user.email,
        image: user.image,
        plan: user.plan,
      },
      billing: config.billing !== null,
    })
  })

  app.get('/me/boards', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    const owned = await listOwnedBoards(db, user.id)
    const result = []
    // ponytail: one doc replay per board per listing; cache names in a
    // column if dashboards ever hold hundreds of boards.
    for (const board of owned) {
      const read = await readBoardStore(db, board.id)
      result.push({
        id: board.id,
        name: read?.store.getMeta().name ?? 'Untitled',
        updatedAt: board.updatedAt.toISOString(),
        shared: board.sharedAt !== null,
        agent: board.agentAt !== null,
      })
    }
    return c.json({
      boards: result,
      cap: user.plan === 'free' ? config.freeBoardCap : null,
    })
  })

  app.get('/me/boards/:boardId/thumbnail', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    const board = await findBoard(db, c.req.param('boardId'))
    if (!board || board.ownerId !== user.id) {
      return c.json(
        { error: board ? 'not your board' : 'unknown board' },
        board ? 403 : 404,
      )
    }
    let png: Buffer | null
    try {
      png = await boardThumbnail(db, config, board.id, () =>
        renderLimiter.take(clientIp(c, config.trustProxy)),
      )
    } catch (error) {
      if (error instanceof ThumbnailBudgetExceededError) {
        return c.json({ error: 'too many renders, retry later' }, 429)
      }
      throw error
    }
    if (!png) {
      return c.body(null, 204)
    }
    return c.body(new Uint8Array(png), 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=60',
    })
  })

  app.post('/me/api-key', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    return c.json({ key: await issueApiKey(db, user.id) }, 201)
  })

  app.delete('/me/api-key', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    await revokeApiKey(db, user.id)
    return c.body(null, 204)
  })

  app.get('/me/usage', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    const month = monthOf(now())
    return c.json({
      month,
      count: await readUsage(db, user.id, month),
      limit: user.plan === 'pro' ? config.mcpQuotaPro : config.mcpQuotaFree,
    })
  })

  app.delete('/boards/:boardId', async (c) => {
    const user = await sessionUser(auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    const board = await findBoard(db, c.req.param('boardId'))
    if (!board) {
      return c.json({ error: 'unknown board' }, 404)
    }
    if (board.ownerId !== user.id) {
      return c.json({ error: 'not your board' }, 403)
    }
    await deps.rooms.evict(board.id)
    await deleteBoardRows(db, board.id)
    return c.body(null, 204)
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
    const user = await sessionUser(auth, c.req.raw.headers)
    return roleFor(board, token, user?.id ?? null)
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
