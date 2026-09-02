import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { type RawData, type WebSocket, WebSocketServer } from 'ws'
import type { Auth } from './accounts/auth'
import { sessionUser } from './accounts/auth'
import type { Config } from './config'
import { findBoard, markShared } from './db/boards'
import type { Db } from './db/client'
import { roleFor } from './http'
import type { Role } from './keys'
import { log } from './log'
import { CLOSE } from './protocol'
import { createTokenBucket } from './rate-limit'
import type { RoomConnection } from './room'
import type { RoomRegistry } from './rooms'

export interface WsDeps {
  db: Db
  config: Config
  rooms: RoomRegistry
  auth: Auth | null
  /** Overridden by the tests only; production runs on PING_INTERVAL_MS. */
  pingIntervalMs?: number
}

const PATH = /^\/ws\/([A-Za-z0-9_-]{8,64})$/

// The socket starts flowing the instant the upgrade completes, but the
// board lookup and the room load are two sequential database round
// trips: a message arriving in that window is buffered here rather than
// dropped, and replayed in order once the room is ready. A generous
// handful covers that window; a peer that floods it before authenticating
// is rate limited rather than allowed to grow the buffer without bound.
const MAX_PENDING_MESSAGES = 8

// A connection that misses one ping is gone. Without this, a half-open
// socket (a NAT timeout, a peer that vanished without a FIN) is never
// detected: the room keeps a connection that will never speak again, so
// its idle timer never arms and it holds its document for the lifetime
// of the process. Also keeps the wire warm for clients that give up on
// a silent server. Matches what y-websocket's own server does.
const PING_INTERVAL_MS = 30_000

interface Upgrade {
  boardId: string
  token: string
}

function parseUpgrade(request: IncomingMessage): Upgrade | null {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const match = PATH.exec(url.pathname)
  if (!match?.[1]) {
    return null
  }
  return { boardId: match[1], token: url.searchParams.get('token') ?? '' }
}

/** Node's raw header map, reshaped into the `Headers` `sessionUser` reads. */
function nodeHeaders(request: IncomingMessage): Headers {
  return new Headers(
    Object.entries(request.headers).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[key, value]]
        : (value ?? []).map((entry) => [key, entry]),
    ),
  )
}

function toBytes(data: RawData): Uint8Array {
  return Array.isArray(data)
    ? new Uint8Array(Buffer.concat(data))
    : new Uint8Array(data as ArrayBuffer | Buffer)
}

/** Byte length without copying: checked before `toBytes` allocates. */
function rawByteLength(data: RawData): number {
  return Array.isArray(data)
    ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
    : data.byteLength
}

/**
 * Accepts every upgrade on /ws/:boardId, then closes with an
 * application code when the board or the token is wrong: a close code
 * needs a completed handshake, and the client reads it.
 */
export function attachWebSocket(
  server: HttpServer,
  deps: WsDeps,
): WebSocketServer {
  const { db, config, rooms } = deps
  const pingIntervalMs = deps.pingIntervalMs ?? PING_INTERVAL_MS
  const wss = new WebSocketServer({
    noServer: true,
    // The upgrade completes before the token is resolved, by design, so
    // this is what an unauthenticated caller can make the process
    // buffer: a backstop at the application's own limit rather than an
    // amplifier above it.
    maxPayload: config.maxMessageBytes,
  })

  async function resolve(
    upgrade: Upgrade,
    headers: Headers,
  ): Promise<{ role: Role; foreignKey: boolean } | number> {
    const board = await findBoard(db, upgrade.boardId)
    if (!board) {
      return CLOSE.unknownBoard
    }
    const user = await sessionUser(deps.auth, headers)
    const role = roleFor(board, upgrade.token || null, user?.id ?? null)
    if (!role) {
      return CLOSE.unauthorized
    }
    // A key-based connection on an owned board is someone else using a
    // share link: that is what the dashboard's "shared" badge reports.
    const foreignKey = board.ownerId !== null && user?.id !== board.ownerId
    return { role, foreignKey }
  }

  async function connect(
    ws: WebSocket,
    upgrade: Upgrade,
    role: Role,
    pending: Uint8Array[],
    setDeliver: (deliver: (bytes: Uint8Array) => void) => void,
    closedBeforeReady: () => number | null,
  ): Promise<void> {
    const room = await rooms.acquire(upgrade.boardId)
    if (!room) {
      ws.close(CLOSE.unknownBoard, 'unknown board')
      log({
        event: 'connection rejected',
        boardId: upgrade.boardId,
        code: CLOSE.unknownBoard,
      })
      return
    }
    const closedCode = closedBeforeReady()
    if (closedCode !== null) {
      // The client disconnected while the board/room lookup was in
      // flight: it never joined, so only release what acquire reserved,
      // starting the room's idle timer instead of leaking it forever.
      rooms.release(upgrade.boardId)
      log({
        event: 'connection closed before ready',
        boardId: upgrade.boardId,
        code: closedCode,
      })
      return
    }
    const bucket = createTokenBucket(config.rateLimitPer10s, 10_000)
    const connection: RoomConnection = {
      role,
      send: (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data)
        }
      },
      close: (code, reason) => ws.close(code, reason),
    }
    room.join(connection)
    log({ event: 'connection open', boardId: upgrade.boardId, role })

    const deliver = (bytes: Uint8Array): void => {
      if (!bucket.take()) {
        ws.close(CLOSE.rateLimited, 'rate limit exceeded')
        return
      }
      void room.handleMessage(connection, bytes)
    }

    ws.on('close', (code) => {
      room.leave(connection)
      rooms.release(upgrade.boardId)
      log({ event: 'connection closed', boardId: upgrade.boardId, code })
    })

    // Replay what arrived before the room was ready, in order, then go
    // live: `deliver` below is used both for this drain and for every
    // message from here on, so ordering and rate limiting are identical
    // either way.
    for (const bytes of pending) {
      if (ws.readyState !== ws.OPEN) {
        break
      }
      deliver(bytes)
    }
    setDeliver(deliver)
  }

  server.on(
    'upgrade',
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const upgrade = parseUpgrade(request)
      if (!upgrade) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        // Everything below is wired synchronously, before any await: the
        // socket already flows data the moment handleUpgrade returns, so a
        // message can arrive before the board/room lookup below resolves.
        const pending: Uint8Array[] = []
        let deliver: ((bytes: Uint8Array) => void) | null = null
        let closedCode: number | null = null

        ws.on('message', (data, isBinary) => {
          if (!isBinary) {
            return
          }
          if (deliver) {
            deliver(toBytes(data))
            return
          }
          // Bounded by bytes as well as count: without this, a peer can
          // park up to MAX_PENDING_MESSAGES frames each, before the board
          // lookup even resolves. The WebSocket server's own `maxPayload`
          // is set to `config.maxMessageBytes` above, so a real socket
          // cannot actually reach this branch with an oversized frame:
          // `ws` refuses the frame itself and closes with 1009 before
          // `message` ever fires, and this check becomes a backstop. It
          // stays in place for the day the transport cap and this limit
          // diverge again.
          // The room applies this same check (same code, same reason) to
          // every live message once ready; this is that check run early,
          // against what would otherwise sit unchecked in memory for the
          // resolve window. Checked against the raw data before `toBytes`
          // copies it, so an oversized frame is rejected without a second
          // allocation.
          if (rawByteLength(data) > config.maxMessageBytes) {
            ws.close(CLOSE.tooLarge, 'message too large')
            return
          }
          if (pending.length >= MAX_PENDING_MESSAGES) {
            ws.close(CLOSE.rateLimited, 'too many messages before ready')
            return
          }
          pending.push(toBytes(data))
        })
        let alive = true
        ws.on('pong', () => {
          alive = true
        })
        const heartbeat = setInterval(() => {
          if (!alive) {
            ws.terminate()
            return
          }
          alive = false
          try {
            ws.ping()
          } catch {
            ws.terminate()
          }
        }, pingIntervalMs)

        ws.on('close', (code) => {
          clearInterval(heartbeat)
          closedCode = code
        })
        ws.on('error', (error) => {
          log({
            event: 'connection error',
            boardId: upgrade.boardId,
            error: String(error),
          })
        })

        void resolve(upgrade, nodeHeaders(request))
          .then((outcome) => {
            if (typeof outcome === 'number') {
              ws.close(
                outcome,
                outcome === CLOSE.unknownBoard
                  ? 'unknown board'
                  : 'unauthorized',
              )
              log({
                event: 'connection rejected',
                boardId: upgrade.boardId,
                code: outcome,
              })
              return
            }
            if (outcome.foreignKey) {
              void markShared(db, upgrade.boardId).catch(() => {})
            }
            return connect(
              ws,
              upgrade,
              outcome.role,
              pending,
              (fn) => {
                deliver = fn
              },
              () => closedCode,
            )
          })
          .catch((error) => {
            // A transient failure resolving the board or acquiring the
            // room (a flaky query, a dropped connection) must not become
            // an unhandled rejection: with no `unhandledRejection`
            // handler installed, Node's default would terminate the
            // whole process over one board's failed lookup.
            log({
              event: 'connection failed',
              boardId: upgrade.boardId,
              error: String(error),
            })
            ws.close(CLOSE.storage, 'storage failure')
          })
      })
    },
  )

  return wss
}
