import { randomUUID } from 'node:crypto'
import { createElement } from '@tlwb/engine'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { loadConfig } from '../src/config'
import { createBoard, loadBoard } from '../src/db/boards'
import { connectDatabase, type Db } from '../src/db/client'
import { generateKey, hashKey } from '../src/keys'
import { encodeUpdate } from '../src/protocol'
import type { RoomConnection } from '../src/room'
import { createRooms } from '../src/rooms'

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

async function board(): Promise<string> {
  const boardId = randomUUID()
  await createBoard(database.db, boardId, {
    editKeyHash: hashKey(generateKey()),
    viewKeyHash: hashKey(generateKey()),
  })
  return boardId
}

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

/** The board rebuilt from Postgres alone, as a cold start would see it. */
async function coldLoad(boardId: string): Promise<{
  elements: string[]
  residual: number
}> {
  const loaded = await loadBoard(database.db, boardId)
  if (!loaded) {
    throw new Error('board not found')
  }
  const doc = new Y.Doc()
  if (loaded.snapshot) {
    Y.applyUpdate(doc, loaded.snapshot)
  }
  for (const row of loaded.updates) {
    Y.applyUpdate(doc, row.update)
  }
  const elements = [...doc.getMap('elements').keys()].sort()
  doc.destroy()
  return { elements, residual: loaded.updates.length }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('threshold compaction', () => {
  it('keeps the update that triggered it: a cold load equals the live document', async () => {
    const boardId = await board()
    const rooms = createRooms({
      db: database.db,
      config: config({ COMPACT_AFTER_UPDATES: '2' }),
    })
    const room = await rooms.acquire(boardId)
    if (!room) {
      throw new Error('expected a room')
    }
    const alice = editor()
    room.join(alice)
    // Exactly the threshold, and nothing after it: the update that
    // triggers the compaction is the last one the room ever sees, so
    // no later eviction snapshot can paper over its loss.
    for (const id of ['r1', 'r2']) {
      await room.handleMessage(alice, encodeUpdate(elementUpdate(id)))
    }
    const live = [...room.doc.getMap('elements').keys()].sort()
    expect(live).toEqual(['r1', 'r2'])
    expect(alice.closed).toBeNull()

    const cold = await coldLoad(boardId)
    expect(cold.elements).toEqual(live)
    // Every update is covered by the snapshot, so board_updates holds
    // nothing: the tail is empty at exactly the threshold.
    expect(cold.residual).toBe(0)

    await rooms.shutdown()
  })

  it('leaves only the tail in board_updates past the threshold', async () => {
    const boardId = await board()
    const rooms = createRooms({
      db: database.db,
      config: config({ COMPACT_AFTER_UPDATES: '2' }),
    })
    const room = await rooms.acquire(boardId)
    if (!room) {
      throw new Error('expected a room')
    }
    const alice = editor()
    room.join(alice)
    for (const id of ['r1', 'r2', 'r3']) {
      await room.handleMessage(alice, encodeUpdate(elementUpdate(id)))
    }
    const live = [...room.doc.getMap('elements').keys()].sort()

    const cold = await coldLoad(boardId)
    expect(cold.elements).toEqual(live)
    expect(cold.residual).toBe(1)

    await rooms.shutdown()
  })
})

describe('shutdown while an update is in flight', () => {
  it('drains the room before compacting, and loses nothing', async () => {
    const boardId = await board()
    const gate = deferred()
    // The real database, with the update insert held open: the room is
    // suspended inside persist() when shutdown starts.
    const slow = new Proxy(database.db, {
      get(target, property, receiver) {
        if (property !== 'insert') {
          return Reflect.get(target, property, receiver)
        }
        return (table: unknown) => {
          const insert = (target.insert as (t: unknown) => unknown)(table)
          return {
            values: (row: unknown) => {
              const values = (
                insert as { values: (r: unknown) => { returning: unknown } }
              ).values(row)
              return {
                returning: async (columns: unknown) => {
                  await gate.promise
                  return (
                    values as {
                      returning: (c: unknown) => Promise<unknown>
                    }
                  ).returning(columns)
                },
              }
            },
          }
        }
      },
    }) as Db

    const rooms = createRooms({ db: slow, config: config() })
    const room = await rooms.acquire(boardId)
    if (!room) {
      throw new Error('expected a room')
    }
    const alice = editor()
    room.join(alice)

    const order: string[] = []
    const inFlight = room
      .handleMessage(alice, encodeUpdate(elementUpdate('r1')))
      .then(() => {
        order.push('message')
      })
    // Let the message reach the gated insert before shutting down.
    await new Promise((resolve) => setTimeout(resolve, 20))

    const shutdown = rooms.shutdown().then(() => {
      order.push('shutdown')
    })
    gate.resolve()
    await Promise.all([inFlight, shutdown])

    // Shutdown must not finish before the message it interrupted: the
    // compaction it runs would otherwise encode a document missing an
    // update the database already holds.
    expect(order).toEqual(['message', 'shutdown'])
    const cold = await coldLoad(boardId)
    expect(cold.elements).toEqual(['r1'])
  })
})

describe('idle eviction while an update is in flight', () => {
  it('drains the room before compacting, and loses nothing', async () => {
    const boardId = await board()
    const gate = deferred()
    const order: string[] = []
    // The real database, with the update insert held open (as above) and
    // every transaction call recorded: `compactBoard` is the only thing
    // that calls `transaction` once the room is loaded, so a mark here
    // pins the moment eviction actually reaches compaction.
    const slow = new Proxy(database.db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return (...args: unknown[]) => {
            order.push('compact-start')
            return (target.transaction as (...a: unknown[]) => unknown)(...args)
          }
        }
        if (property !== 'insert') {
          return Reflect.get(target, property, receiver)
        }
        return (table: unknown) => {
          const insert = (target.insert as (t: unknown) => unknown)(table)
          return {
            values: (row: unknown) => {
              const values = (
                insert as { values: (r: unknown) => { returning: unknown } }
              ).values(row)
              return {
                returning: async (columns: unknown) => {
                  await gate.promise
                  return (
                    values as {
                      returning: (c: unknown) => Promise<unknown>
                    }
                  ).returning(columns)
                },
              }
            },
          }
        }
      },
    }) as Db

    const rooms = createRooms({
      db: slow,
      config: config({ ROOM_IDLE_MS: '10' }),
    })
    const room = await rooms.acquire(boardId)
    if (!room) {
      throw new Error('expected a room')
    }
    // Discard the load's own `transaction` call, tracked from here on.
    order.length = 0
    const alice = editor()
    room.join(alice)

    const inFlight = room
      .handleMessage(alice, encodeUpdate(elementUpdate('r1')))
      .then(() => {
        order.push('message')
      })
    // Let the message reach the gated insert before the connection
    // leaves, exactly as the shutdown test does above.
    await new Promise((resolve) => setTimeout(resolve, 20))

    room.leave(alice)
    rooms.release(boardId)
    // Long enough for the 10ms idle timer to fire: eviction should now
    // be suspended draining the still-gated message, not compacting
    // ahead of it.
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(order).toEqual([])

    gate.resolve()
    await inFlight
    // The eviction that the idle timer started is fire-and-forget: give
    // it room to reach compaction once the gate is released.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(order).toEqual(['message', 'compact-start'])
    const cold = await coldLoad(boardId)
    expect(cold.elements).toEqual(['r1'])
    expect(cold.residual).toBe(0)
  })
})
