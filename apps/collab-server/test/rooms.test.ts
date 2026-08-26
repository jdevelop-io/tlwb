import { randomUUID } from 'node:crypto'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createElement } from '@tlwb/engine'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { loadConfig } from '../src/config'
import { createBoard } from '../src/db/boards'
import { connectDatabase, type Db } from '../src/db/client'
import * as schema from '../src/db/schema'
import { generateKey, hashKey } from '../src/keys'
import { CLOSE, encodeUpdate } from '../src/protocol'
import type { RoomConnection } from '../src/room'
import { createRooms, type RoomRegistry } from '../src/rooms'
import { attachWebSocket } from '../src/ws'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function config(overrides: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    ...overrides,
  })
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

/** A board with a random valid edit key, ready to use as a WebSocket token. */
async function board(): Promise<{ boardId: string; editKey: string }> {
  const boardId = randomUUID()
  const editKey = generateKey()
  await createBoard(database.db, boardId, {
    editKeyHash: hashKey(editKey),
    viewKeyHash: hashKey(generateKey()),
  })
  return { boardId, editKey }
}

/** A valid Yjs update, for a stub `loadBoard` residual row. */
function validUpdate(): Uint8Array {
  const doc = new Y.Doc()
  doc.getMap('elements').set('seed', 1)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

/**
 * A `Db` whose `transaction` call ignores the callback it is given and
 * instead returns (or throws) the next configured response in order.
 * `loadBoard` and `compactBoard` each do nothing but `return
 * db.transaction(...)`, so this fully controls their outcome without
 * needing to stub Drizzle's query builder.
 */
function stubDb(responses: Array<() => unknown>): Db {
  let i = 0
  return {
    transaction: async () => {
      const respond = responses[i]
      i += 1
      if (!respond) {
        throw new Error(`stubDb: no response configured for call ${i}`)
      }
      return respond()
    },
  } as unknown as Db
}

describe('loadBoard isolation level', () => {
  it('runs both selects inside a REPEATABLE READ transaction', async () => {
    const { boardId } = await board()
    const queries: string[] = []
    const sql = postgres(url)
    const logged = drizzle(sql, {
      schema,
      logger: { logQuery: (query) => queries.push(query) },
    }) as unknown as Db
    try {
      const { loadBoard } = await import('../src/db/boards')
      await loadBoard(logged, boardId)
    } finally {
      await sql.end()
    }
    const isolationIndex = queries.findIndex((query) =>
      query
        .toLowerCase()
        .startsWith('set transaction isolation level repeatable read'),
    )
    expect(isolationIndex).toBeGreaterThanOrEqual(0)
    const selectIndexes = queries
      .map((query, index) =>
        query.toLowerCase().startsWith('select') ? index : -1,
      )
      .filter((index) => index >= 0)
    // Both selects (board, then updates) must come after the isolation
    // level is set: this guards against a drizzle upgrade quietly
    // dropping the transaction config, which would restore the
    // silent-data-loss window a concurrent compaction could open.
    expect(selectIndexes.length).toBeGreaterThanOrEqual(2)
    for (const index of selectIndexes) {
      expect(index).toBeGreaterThan(isolationIndex)
    }
  })
})

describe('attachWebSocket against a failing registry', () => {
  it('closes with 1011 when rooms.acquire rejects, and the process keeps running', async () => {
    const { boardId, editKey } = await board()
    const rooms: RoomRegistry = {
      acquire: async () => {
        throw new Error('boom')
      },
      release: () => {},
      shutdown: async () => {},
    }
    const server = http.createServer()
    await new Promise<void>((resolve) => server.listen(0, resolve))
    attachWebSocket(server, { db: database.db, config: config(), rooms })
    const port = (server.address() as AddressInfo).port

    let unhandled: unknown = null
    const onUnhandled = (reason: unknown) => {
      unhandled = reason
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      const socket = new WebSocket(
        `ws://localhost:${port}/ws/${boardId}?token=${editKey}`,
      )
      let closeCode: number | null = null
      socket.addEventListener('close', (event) => {
        closeCode = event.code
      })
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve())
        socket.addEventListener('error', () =>
          reject(new Error('socket error')),
        )
      })
      await waitFor(() => closeCode !== null)
      expect(closeCode).toBe(CLOSE.storage)
      // A rejected `rooms.acquire` must not become an unhandled
      // rejection: give it a moment to surface if it were going to.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(unhandled).toBeNull()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('room registry resilience', () => {
  it('does not poison a board after a failed load; a later acquire retries', async () => {
    let fail = true
    const db = {
      transaction: async () => {
        if (fail) {
          throw new Error('boom')
        }
        return { snapshot: null, snapshotSeq: 0, updates: [] }
      },
    } as unknown as Db
    const rooms = createRooms({ db, config: config() })
    await expect(rooms.acquire('board-1')).rejects.toThrow('boom')
    fail = false
    const room = await rooms.acquire('board-1')
    expect(room).toBeDefined()
    await rooms.shutdown()
  })

  it('shutdown reaches every room even when one failed to load', async () => {
    let loadBadCalled = false
    let loadGoodCalled = false
    let compactedGood = false
    const db = stubDb([
      () => {
        loadBadCalled = true
        throw new Error('boom')
      },
      () => {
        loadGoodCalled = true
        return {
          snapshot: null,
          snapshotSeq: 0,
          updates: [{ seq: 1, update: validUpdate() }],
        }
      },
      () => {
        compactedGood = true
        return undefined
      },
    ])
    const rooms = createRooms({ db, config: config() })

    // Neither is awaited before shutdown: both are still pending
    // promises in the registry's map when shutdown captures its
    // snapshot, which is exactly the scenario its own try/catch (rather
    // than acquire's) must handle.
    const badAcquire = rooms.acquire('bad')
    badAcquire.catch(() => {})
    const goodAcquire = rooms.acquire('good')
    goodAcquire.catch(() => {})

    await rooms.shutdown()

    expect(loadBadCalled).toBe(true)
    expect(loadGoodCalled).toBe(true)
    expect(compactedGood).toBe(true)
    await expect(badAcquire).rejects.toThrow('boom')
  })
})

function editor(): RoomConnection & { closed: number | null } {
  return {
    role: 'edit',
    closed: null,
    send: () => {},
    close(code) {
      this.closed = code
    },
  }
}

/** An update creating one rectangle under its own id, from its own client. */
function elementUpdate(id: string): Uint8Array {
  const doc = new Y.Doc()
  const element = createElement('rectangle', { index: 'a0', id })
  doc.getMap('elements').set(id, new Y.Map(Object.entries(element)))
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

describe('compaction retry after a failure', () => {
  it('does not retry on every later message; waits for another full window', async () => {
    // Call 1 is the room load. Call 2 is the first compaction attempt,
    // at residual 2 (the threshold): it fails. Call 3 is the second
    // attempt: it must not happen until residual reaches 4 (another
    // full COMPACT_AFTER_UPDATES window), and it succeeds.
    let currentMessage = 0
    const compactAttempts: number[] = []
    let transactionCall = 0
    let seq = 0
    const db = {
      insert: () => ({
        values: () => ({
          returning: async () => {
            seq += 1
            return [{ seq }]
          },
        }),
      }),
      transaction: async () => {
        transactionCall += 1
        if (transactionCall === 1) {
          return { snapshot: null, snapshotSeq: 0, updates: [] }
        }
        compactAttempts.push(currentMessage)
        if (transactionCall === 2) {
          throw new Error('lock timeout')
        }
        return undefined
      },
    } as unknown as Db

    const rooms = createRooms({
      db,
      config: config({ COMPACT_AFTER_UPDATES: '2' }),
    })
    const room = await rooms.acquire('board-1')
    if (!room) {
      throw new Error('expected a room')
    }
    const alice = editor()
    room.join(alice)

    for (let i = 1; i <= 4; i += 1) {
      currentMessage = i
      await room.handleMessage(alice, encodeUpdate(elementUpdate(`r${i}`)))
    }
    expect(alice.closed).toBeNull()
    // A compaction attempt at message 2 (fails) and message 4 (a full
    // window later, succeeds) -- never at message 3, which the bug
    // retried immediately.
    expect(compactAttempts).toEqual([2, 4])

    await rooms.shutdown()
  })
})

/** A promise this test settles from the outside, on its own schedule. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('idle timer vs shutdown race', () => {
  // A single board cannot isolate the `stopped` guard: `shutdown()`'s
  // `stopped = true` is its first synchronous statement, so a
  // `release()` issued before `shutdown()` always has its `.then`
  // callback observed and cleared by shutdown's own pre-existing
  // per-entry `clearTimeout`, by Promise callback FIFO ordering on that
  // board's one shared, already-resolved promise (confirmed earlier by
  // instrumenting both sides). Two boards break that: `shutdown()`'s
  // loop is a `for` over its own snapshot, awaiting one entry's
  // `compact()` before moving to the next, so gating `slow`'s compact
  // suspends the loop entirely -- before it ever reaches `fast` -- while
  // `fast`'s own idle timer, armed earlier, is free to fire on its own.
  it('does not evict a second time when an idle timer fires while shutdown is suspended on another room', async () => {
    vi.useFakeTimers()
    try {
      const slowCompact = deferred<undefined>()
      let call = 0
      const db = {
        transaction: async () => {
          const current = call
          call += 1
          if (current === 0) {
            // load('slow'): one residual update, so its compact() below
            // genuinely reaches the database instead of short-circuiting.
            return {
              snapshot: null,
              snapshotSeq: 0,
              updates: [{ seq: 1, update: validUpdate() }],
            }
          }
          if (current === 1) {
            // load('fast'): nothing residual, so its compact() -- called
            // once by evict() and once by shutdown()'s own loop -- is
            // harmless either time regardless of how many times it runs.
            return { snapshot: null, snapshotSeq: 0, updates: [] }
          }
          // compactBoard('slow', ...): held open until this test resolves it.
          return slowCompact.promise
        },
      } as unknown as Db
      const rooms = createRooms({ db, config: config({ ROOM_IDLE_MS: '50' }) })

      // Inserted in this order so shutdown's snapshot processes `slow`
      // first and suspends there, before ever reaching `fast`.
      const slowRoom = await rooms.acquire('slow')
      const fastRoom = await rooms.acquire('fast')
      if (!slowRoom || !fastRoom) {
        throw new Error('expected both rooms')
      }
      const fastDestroySpy = vi.spyOn(fastRoom, 'destroy')

      rooms.release('fast')
      // Let release's `.then` callback arm fast's idle timer before
      // shutdown starts: real microtasks, not fake time.
      await Promise.resolve()

      const shutdown = rooms.shutdown()
      // shutdown() is now suspended awaiting slowCompact.promise, having
      // never reached `fast`. Firing fast's already-armed timer here is
      // the only thing that can evict it before shutdown does.
      await vi.advanceTimersByTimeAsync(100)
      slowCompact.resolve(undefined)
      await shutdown

      expect(fastDestroySpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
