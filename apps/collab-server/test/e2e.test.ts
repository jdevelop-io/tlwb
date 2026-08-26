import { randomUUID } from 'node:crypto'
import { createElement } from '@tlwb/engine'
import { connectBoard, createYjsBoardStore } from '@tlwb/store-yjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { loadConfig } from '../src/config'
import {
  CLOSE,
  decodeMessage,
  encodeSyncStep1,
  encodeUpdate,
} from '../src/protocol'
import { startServer } from '../src/server'

let server: Awaited<ReturnType<typeof startServer>>
let base: string

beforeAll(async () => {
  server = await startServer(
    loadConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      CORS_ORIGIN: 'http://a',
      PORT: '0',
      ROOM_IDLE_MS: '50',
      COMPACT_AFTER_UPDATES: '2',
      // Every board here is created from the same address: the default
      // of 10 per minute would tip this file into 429 as it grows.
      CREATE_LIMIT_PER_MIN: '1000',
    }),
  )
  base = `localhost:${server.port}`
})

afterAll(async () => {
  await server.close()
})

async function createBoard() {
  const boardId = randomUUID()
  const response = await fetch(`http://${base}/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId }),
  })
  expect(response.status).toBe(201)
  const keys = (await response.json()) as { editKey: string; viewKey: string }
  return { boardId, ...keys }
}

function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (check()) {
        resolve()
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out'))
      } else {
        setTimeout(tick, 20)
      }
    }
    tick()
  })
}

/** A bare socket speaking the wire format, for close-code assertions. */
function rawClient(boardId: string, token: string, host = base) {
  const socket = new WebSocket(`ws://${host}/ws/${boardId}?token=${token}`)
  socket.binaryType = 'arraybuffer'
  const received: Uint8Array[] = []
  let closeCode: number | null = null
  let closeReason: string | null = null
  socket.addEventListener('message', (event) => {
    received.push(new Uint8Array(event.data as ArrayBuffer))
  })
  socket.addEventListener('close', (event) => {
    closeCode = event.code
    closeReason = event.reason
  })
  const open = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('socket error')))
  })
  return {
    socket,
    received,
    open,
    closeCode: () => closeCode,
    closeReason: () => closeReason,
    // `data.buffer` is typed `ArrayBufferLike` (it can be a
    // `SharedArrayBuffer`), while the lib.dom.d.ts `WebSocket.send`
    // overload wants a plain `ArrayBuffer`. `new Uint8Array(length)` is
    // typed to allocate a fresh `ArrayBuffer`, so copying through it
    // gives back the concrete type `.slice()` on `ArrayBufferLike` does
    // not.
    send: (data: Uint8Array) => {
      const copy = new Uint8Array(data.byteLength)
      copy.set(data)
      socket.send(copy.buffer)
    },
    close: () => socket.close(),
  }
}

/** An update creating one rectangle under its own id (default `r1`). */
function elementUpdate(overrides: Record<string, unknown> = {}): Uint8Array {
  const doc = new Y.Doc()
  const element = createElement('rectangle', { index: 'a0', id: 'r1' })
  const merged = { ...element, ...overrides }
  doc
    .getMap('elements')
    .set(String(merged.id), new Y.Map(Object.entries(merged)))
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

/**
 * Asks the server for its state until every id is there. Re-sending
 * step 1 on each poll makes the check independent of how fast a
 * previous write landed. Backs off after the first probe: each one
 * sent before the room is ready counts against its pre-ready buffer
 * bound (8 messages), so polling every 20 ms without limit could
 * exhaust it waiting on an unusually slow board lookup.
 */
async function waitForElements(
  client: ReturnType<typeof rawClient>,
  ids: string[],
): Promise<void> {
  const doc = new Y.Doc()
  let seen = 0
  let attempt = 0
  try {
    await waitFor(() => {
      for (const data of client.received.slice(seen)) {
        const message = decodeMessage(data)
        if (message.kind === 'sync-update') {
          Y.applyUpdate(doc, message.update)
        }
      }
      seen = client.received.length
      if (ids.every((id) => doc.getMap('elements').has(id))) {
        return true
      }
      attempt += 1
      if (attempt === 1 || attempt % 5 === 0) {
        const probe = new Y.Doc()
        client.send(encodeSyncStep1(probe))
        probe.destroy()
      }
      return false
    })
  } finally {
    doc.destroy()
  }
}

describe('collaboration server', () => {
  it('converges two editors through connectBoard', async () => {
    const { boardId, editKey } = await createBoard()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const storeA = createYjsBoardStore(docA)
    const storeB = createYjsBoardStore(docB)
    const a = connectBoard(docA, {
      url: `ws://${base}/ws`,
      boardId,
      token: editKey,
    })
    const b = connectBoard(docB, {
      url: `ws://${base}/ws`,
      boardId,
      token: editKey,
    })
    await waitFor(
      () => a.getStatus() === 'connected' && b.getStatus() === 'connected',
    )

    storeA.applyChanges([
      {
        kind: 'create',
        element: createElement('ellipse', { index: 'a0', id: 'e1', x: 5 }),
      },
    ])
    await waitFor(() => storeB.getElement('e1')?.x === 5)
    storeB.applyChanges([{ kind: 'update', id: 'e1', props: { x: 9 } }])
    await waitFor(() => storeA.getElement('e1')?.x === 9)

    a.destroy()
    b.destroy()
    a.awareness.destroy()
    b.awareness.destroy()
    docA.destroy()
    docB.destroy()
  })

  it('closes a read-only client that writes, after it received the state', async () => {
    const { boardId, editKey, viewKey } = await createBoard()
    const editor = rawClient(boardId, editKey)
    await editor.open
    editor.send(encodeUpdate(elementUpdate()))

    const viewer = rawClient(boardId, viewKey)
    await viewer.open
    await waitForElements(viewer, ['r1'])
    viewer.send(encodeUpdate(elementUpdate({ id: 'r2' })))
    await waitFor(() => viewer.closeCode() === CLOSE.readOnly)
    editor.close()
  })

  it('closes a client sending a malformed element and never relays it', async () => {
    const { boardId, editKey } = await createBoard()
    const bad = rawClient(boardId, editKey)
    const good = rawClient(boardId, editKey)
    await Promise.all([bad.open, good.open])
    const before = good.received.length
    bad.send(encodeUpdate(elementUpdate({ x: 'oops' })))
    await waitFor(() => bad.closeCode() === CLOSE.invalid)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(
      good.received
        .slice(before)
        .filter((d) => decodeMessage(d).kind === 'sync-update'),
    ).toHaveLength(0)
    good.close()
  })

  it('rejects an unknown board and a wrong token with close codes', async () => {
    const { boardId } = await createBoard()
    const unknown = rawClient(randomUUID(), 'whatever')
    await unknown.open
    await waitFor(() => unknown.closeCode() === CLOSE.unknownBoard)
    const wrong = rawClient(boardId, 'not-a-key')
    await wrong.open
    await waitFor(() => wrong.closeCode() === CLOSE.unauthorized)
  })

  it('compacts, evicts the idle room, and reloads the persisted state', async () => {
    const { boardId, editKey } = await createBoard()
    const writer = rawClient(boardId, editKey)
    await writer.open
    for (const id of ['r1', 'r2', 'r3']) {
      writer.send(encodeUpdate(elementUpdate({ id })))
    }
    await waitForElements(writer, ['r1', 'r2', 'r3'])
    writer.close()
    await waitFor(() => writer.closeCode() !== null)
    await new Promise((resolve) => setTimeout(resolve, 150)) // past ROOM_IDLE_MS

    const reader = rawClient(boardId, editKey)
    await reader.open
    await waitForElements(reader, ['r1', 'r2', 'r3'])
    reader.close()
  })

  it('processes a message sent the instant the socket opens, before the room is ready', async () => {
    // Pins the handshake/room-ready race: the socket starts flowing the
    // moment the upgrade completes, well before the board lookup and the
    // room load (two database round trips) resolve. A message sent this
    // early must still reach the room once it is ready, not be dropped.
    const { boardId, editKey } = await createBoard()
    const editor = rawClient(boardId, editKey)
    await editor.open
    editor.send(encodeUpdate(elementUpdate()))
    await waitForElements(editor, ['r1'])
    editor.close()
  })

  it('closes with the rate-limit code when flooded before the room is ready', async () => {
    // The pre-ready buffer is bounded: a peer that floods it before the
    // board lookup resolves is closed rather than allowed to grow it
    // without limit. Sent immediately on open, well within the window
    // the previous test pins, so the bound is what triggers the close.
    // Asserted by reason, not just code: the live rate limiter closes
    // with the same CLOSE.rateLimited code for a different reason, and
    // 20 messages is comfortably under its live limit, so only the
    // buffered-path reason pins this specific bound rather than the race
    // between them happening to resolve the way this test expects.
    const { boardId, editKey } = await createBoard()
    const flooder = rawClient(boardId, editKey)
    await flooder.open
    for (let i = 0; i < 20; i += 1) {
      flooder.send(encodeUpdate(elementUpdate({ id: `flood-${i}` })))
    }
    await waitFor(() => flooder.closeCode() === CLOSE.rateLimited)
    expect(flooder.closeReason()).toBe('too many messages before ready')
  })

  it('closes an oversized message before the room is ready, without ever joining the room', async () => {
    // The transport cap is the message limit itself, so an oversized
    // frame never reaches the application at all: `ws` closes it with
    // 1009 while the board lookup is still in flight. What this pins is
    // that nothing oversized is buffered on the way in: whether
    // `room.join` ever ran says so, since it only runs after both the
    // board lookup and the room load resolve, so an early rejection
    // never logs a 'connection open' line for this board.
    const { boardId, editKey } = await createBoard()
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })
    let closeCode: number | null
    try {
      const client = rawClient(boardId, editKey)
      await client.open
      const huge = new Uint8Array(2 * 1024 * 1024) // over the 1 MiB default maxMessageBytes
      client.send(encodeUpdate(huge))
      await waitFor(() => client.closeCode() !== null)
      closeCode = client.closeCode()
    } finally {
      spy.mockRestore()
    }
    expect(closeCode).toBe(1009)
    const joined = lines.some((line) => {
      try {
        const parsed = JSON.parse(line) as { event?: string; boardId?: string }
        return parsed.event === 'connection open' && parsed.boardId === boardId
      } catch {
        return false // a non-JSON console.log in the spy window is not this signal
      }
    })
    expect(joined).toBe(false)
  })

  it('stops accepting new connections the instant close() starts draining', async () => {
    // close()'s very first statement removes the 'upgrade' listener,
    // synchronously, before any await: an upgrade that arrives after
    // close() was called must never create a room the drain already
    // finished with. A dedicated server, not the shared one, since this
    // test shuts it down mid-test. A board with a live connection gives
    // rooms.shutdown() real (database-bound) work, so the underlying
    // HTTP server naturally stops listening only well after this test's
    // own connection attempt would have landed; without the explicit,
    // synchronous listener removal, that attempt would otherwise race a
    // fast, empty drain and pass for the wrong reason.
    const isolated = await startServer(
      loadConfig({
        DATABASE_URL: process.env.DATABASE_URL,
        CORS_ORIGIN: 'http://a',
        PORT: '0',
      }),
    )
    const isolatedBase = `localhost:${isolated.port}`
    const boardId = randomUUID()
    const response = await fetch(`http://${isolatedBase}/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardId }),
    })
    const { editKey } = (await response.json()) as { editKey: string }
    const writer = rawClient(boardId, editKey, isolatedBase)
    await writer.open
    // Waiting only for the handshake is not enough: the room itself is
    // only ready after two database round trips, and an empty registry
    // drains just as fast whether or not the listener was removed.
    // Round-tripping an update through the room proves it actually
    // joined, so the registry has real (database-bound) work to do.
    writer.send(encodeUpdate(elementUpdate()))
    await waitForElements(writer, ['r1'])

    const closing = isolated.close()
    try {
      const socket = new WebSocket(
        `ws://${isolatedBase}/ws/${randomUUID()}?token=whatever`,
      )
      const rejected = await new Promise<boolean>((resolve) => {
        socket.addEventListener('open', () => resolve(false))
        socket.addEventListener('error', () => resolve(true))
        socket.addEventListener('close', () => resolve(true))
      })
      expect(rejected).toBe(true)
    } finally {
      // A failing assertion above must not skip draining the isolated
      // server: without it, a failed run leaks a listening socket.
      await closing
    }
  })
})
