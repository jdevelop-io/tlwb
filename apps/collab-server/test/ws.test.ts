import { randomUUID } from 'node:crypto'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createElement } from '@tlwb/engine'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket as WsClient } from 'ws'
import * as Y from 'yjs'
import { createAuth } from '../src/accounts/auth'
import { loadConfig } from '../src/config'
import { createBoard, loadBoard } from '../src/db/boards'
import { connectDatabase } from '../src/db/client'
import { boards, session as sessionTable, user } from '../src/db/schema'
import { generateKey, hashKey } from '../src/keys'
import { encodeUpdate } from '../src/protocol'
import { createRooms } from '../src/rooms'
import { attachWebSocket } from '../src/ws'
import { sessionCookie } from './session-cookie'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (check()) {
        resolve()
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out'))
      } else {
        setTimeout(tick, 10)
      }
    }
    tick()
  })
}

/** A server, a board, and the URL of that board's WebSocket endpoint. */
async function serve(overrides: Record<string, string> = {}, ping?: number) {
  const boardId = randomUUID()
  const editKey = generateKey()
  const viewKey = generateKey()
  await createBoard(database.db, boardId, {
    editKeyHash: hashKey(editKey),
    viewKeyHash: hashKey(viewKey),
  })
  const config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    ...overrides,
  })
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const rooms = createRooms({ db: database.db, config })
  // Null unless the caller's overrides supply AUTH_SECRET: every
  // existing call keeps today's token-only behaviour untouched.
  const auth = createAuth({ db: database.db, config })
  const wss = attachWebSocket(server, {
    db: database.db,
    config,
    rooms,
    auth,
    pingIntervalMs: ping,
  })
  const port = (server.address() as AddressInfo).port
  return {
    wss,
    boardId,
    port,
    config,
    viewKey,
    url: `ws://localhost:${port}/ws/${boardId}?token=${editKey}`,
    async close() {
      await rooms.shutdown()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** Polls an async condition, for state that lands via a DB write. */
function waitForAsync(
  check: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      check().then((done) => {
        if (done) {
          resolve()
        } else if (Date.now() - started > timeoutMs) {
          reject(new Error('timed out'))
        } else {
          setTimeout(tick, 10)
        }
      }, reject)
    }
    tick()
  })
}

describe('WebSocket keepalive', () => {
  it('pings an idle connection', async () => {
    const server = await serve({}, 30)
    try {
      const client = new WsClient(server.url)
      let pings = 0
      client.on('ping', () => {
        pings += 1
      })
      await new Promise((resolve) => client.on('open', resolve))
      await waitFor(() => pings >= 2)
      client.close()
    } finally {
      await server.close()
    }
  })

  it('terminates a connection that stops answering', async () => {
    const server = await serve({}, 30)
    try {
      const client = new WsClient(server.url)
      await new Promise((resolve) => client.on('open', resolve))
      await waitFor(() => server.wss.clients.size === 1)
      // A half-open connection (a NAT timeout, a peer that vanished
      // without a FIN) reads nothing and answers nothing. Without a
      // keepalive it stays in the room forever, so the room never goes
      // idle and never releases its document.
      client.pause()
      await waitFor(() => server.wss.clients.size === 0)
      client.terminate()
    } finally {
      await server.close()
    }
  })
})

describe('WebSocket payload cap', () => {
  it('does not buffer more than one message limit before authentication', async () => {
    const server = await serve({ MAX_MESSAGE_BYTES: '1024' })
    try {
      // The upgrade is accepted before the token is resolved by design,
      // so the transport cap is what an unauthenticated caller can make
      // the process hold. It must be the message limit, not a multiple
      // of it.
      expect(server.wss.options.maxPayload).toBe(1024)
      const client = new WsClient(server.url)
      await new Promise((resolve) => client.on('open', resolve))
      let closeCode: number | null = null
      client.on('close', (code) => {
        closeCode = code
      })
      client.send(new Uint8Array(2048))
      await waitFor(() => closeCode !== null)
      expect(closeCode).toBe(1009)
    } finally {
      await server.close()
    }
  })
})

const AUTH_ENV = {
  AUTH_SECRET: 'test-secret-at-least-32-characters!!',
  GITHUB_CLIENT_ID: 'gid',
  GITHUB_CLIENT_SECRET: 'gsec',
}

describe('WebSocket ownership', () => {
  it('grants the owning session edit access without a key', async () => {
    const server = await serve(AUTH_ENV)
    try {
      const ownerId = randomUUID()
      const token = randomUUID()
      await database.db.insert(user).values({
        id: ownerId,
        name: 'Owner',
        email: `${ownerId}@example.com`,
      })
      await database.db.insert(sessionTable).values({
        id: randomUUID(),
        token,
        userId: ownerId,
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      await database.db
        .update(boards)
        .set({ ownerId })
        .where(eq(boards.id, server.boardId))

      const cookie = sessionCookie(
        token,
        server.config.accounts?.secret as string,
      )

      // Verify the cookie format empirically against Better Auth's own
      // session endpoint before trusting it over the WebSocket upgrade.
      const auth = createAuth({ db: database.db, config: server.config })
      const liveSession = await auth?.api.getSession({
        headers: new Headers({ cookie }),
      })
      expect(liveSession?.user.id).toBe(ownerId)

      const client = new WsClient(
        `ws://localhost:${server.port}/ws/${server.boardId}`,
        { headers: { cookie } },
      )
      let closeCode: number | null = null
      client.on('close', (code) => {
        closeCode = code
      })
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve())
        client.on('error', reject)
      })

      const doc = new Y.Doc()
      const before = Y.encodeStateVector(doc)
      const element = createElement('rectangle', { index: 'a0', id: 'r1' })
      doc.transact(() => {
        doc.getMap('elements').set('r1', new Y.Map(Object.entries(element)))
      })
      client.send(encodeUpdate(Y.encodeStateAsUpdate(doc, before)))

      await waitForAsync(async () => {
        const loaded = await loadBoard(database.db, server.boardId)
        return (loaded?.updates.length ?? 0) > 0
      })
      // A read-only connection is closed by the room; the owner's
      // update landing without one is the edit role taking effect.
      expect(closeCode).toBeNull()

      // The owner visiting their own board is not the "someone else
      // used a share link" case: markShared must stay a no-op here. A
      // false positive is a silent write, not a timeout, so give the
      // fire-and-forget call a short grace period before checking.
      await new Promise((resolve) => setTimeout(resolve, 200))
      const [row] = await database.db
        .select({ sharedAt: boards.sharedAt })
        .from(boards)
        .where(eq(boards.id, server.boardId))
      expect(row?.sharedAt).toBeNull()

      client.close()
      doc.destroy()
    } finally {
      await server.close()
    }
  })

  it('marks a board shared when a key-based visitor connects to it', async () => {
    const server = await serve()
    try {
      const ownerId = randomUUID()
      await database.db.insert(user).values({
        id: ownerId,
        name: 'Owner',
        email: `${ownerId}@example.com`,
      })
      await database.db
        .update(boards)
        .set({ ownerId })
        .where(eq(boards.id, server.boardId))

      // The view key, not the owner's own session: exactly the "someone
      // else using a share link" case `foreignKey` exists to detect.
      const client = new WsClient(
        `ws://localhost:${server.port}/ws/${server.boardId}?token=${server.viewKey}`,
      )
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => resolve())
        client.on('error', reject)
      })

      // markShared fires fire-and-forget after the connection resolves,
      // so poll for the write instead of asserting right after connect.
      await waitForAsync(async () => {
        const [row] = await database.db
          .select({ sharedAt: boards.sharedAt })
          .from(boards)
          .where(eq(boards.id, server.boardId))
        return row?.sharedAt != null
      })

      client.close()
    } finally {
      await server.close()
    }
  })
})
