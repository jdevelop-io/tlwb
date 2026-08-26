import { randomUUID } from 'node:crypto'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket as WsClient } from 'ws'
import { loadConfig } from '../src/config'
import { createBoard } from '../src/db/boards'
import { connectDatabase } from '../src/db/client'
import { generateKey, hashKey } from '../src/keys'
import { createRooms } from '../src/rooms'
import { attachWebSocket } from '../src/ws'

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
  await createBoard(database.db, boardId, {
    editKeyHash: hashKey(editKey),
    viewKeyHash: hashKey(generateKey()),
  })
  const config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    ...overrides,
  })
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const rooms = createRooms({ db: database.db, config })
  const wss = attachWebSocket(server, {
    db: database.db,
    config,
    rooms,
    pingIntervalMs: ping,
  })
  const port = (server.address() as AddressInfo).port
  return {
    wss,
    url: `ws://localhost:${port}/ws/${boardId}?token=${editKey}`,
    async close() {
      await rooms.shutdown()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
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
