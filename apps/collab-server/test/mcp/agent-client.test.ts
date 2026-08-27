import { createElement } from '@tlwb/engine'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createBoard } from '../../src/db/boards'
import { connectDatabase } from '../../src/db/client'
import { generateKey, hashKey } from '../../src/keys'
import { AGENT_COLOR, withBoard } from '../../src/mcp/agent-client'
import { ToolError } from '../../src/mcp/tool-error'
import { decodeMessage } from '../../src/protocol'
import { createRoom, type Room, type RoomConnection } from '../../src/room'
import type { RoomRegistry } from '../../src/rooms'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

interface FakeConnection extends RoomConnection {
  received: Uint8Array[]
}

function observer(room: Room): FakeConnection {
  const fake: FakeConnection = {
    role: 'view',
    received: [],
    send: (data) => fake.received.push(data),
    close: () => {},
  }
  room.join(fake)
  return fake
}

/** Awareness states an observer saw, decoded to their JSON. */
function awarenessStates(connection: FakeConnection): unknown[] {
  const doc = new Y.Doc()
  const { Awareness, applyAwarenessUpdate } = awarenessModule
  const awareness = new Awareness(doc)
  // Its own constructor publishes `{}` for its own clientID; the room
  // clears that the same way (see room.ts) so it never shows up as a
  // remote state.
  awareness.setLocalState(null)
  for (const data of connection.received) {
    const message = decodeMessage(data)
    if (message.kind === 'awareness') {
      applyAwarenessUpdate(awareness, message.update, null)
    }
  }
  const states = [...awareness.getStates().values()]
  awareness.destroy()
  doc.destroy()
  return states
}

const awarenessModule = await import('y-protocols/awareness')

async function setup(options: { maxDocBytes?: number } = {}) {
  const boardId = `agent${Date.now()}${Math.floor(Math.random() * 1000)}`
  const editKey = generateKey()
  const viewKey = generateKey()
  await createBoard(database.db, boardId, {
    editKeyHash: hashKey(editKey),
    viewKeyHash: hashKey(viewKey),
  })
  const doc = new Y.Doc()
  const persisted: Uint8Array[] = []
  const room = createRoom(doc, {
    maxMessageBytes: 1_000_000,
    maxDocBytes: options.maxDocBytes ?? 1_000_000,
    maxAwarenessBytes: 16_384,
    persist: async (update) => {
      persisted.push(update)
      return persisted.length
    },
    applied: async () => {},
  })
  const released: string[] = []
  const rooms: RoomRegistry = {
    acquire: async (id) => (id === boardId ? room : undefined),
    release: (id) => {
      released.push(id)
    },
    shutdown: async () => {},
  }
  const deps = { db: database.db, rooms, presenceMs: 0 }
  return { boardId, editKey, viewKey, doc, room, persisted, released, deps }
}

describe('withBoard', () => {
  it('mirrors a non-empty room and applies an accepted mutation to it', async () => {
    const { boardId, editKey, doc, room, persisted, released, deps } =
      await setup()
    doc
      .getMap('elements')
      .set(
        'r1',
        new Y.Map(
          Object.entries(createElement('rectangle', { index: 'a0', id: 'r1' })),
        ),
      )
    const watcher = observer(room)

    const seen = await withBoard(
      deps,
      { boardId, key: editKey },
      'edit',
      async (client) => {
        const before = client.store.listElements().map((e) => e.id)
        await client.mutate((store) =>
          store.applyChanges(
            [
              {
                kind: 'create',
                element: createElement('ellipse', { index: 'a1', id: 'e1' }),
              },
            ],
            'remote',
          ),
        )
        return before
      },
    )

    expect(seen).toEqual(['r1'])
    expect(persisted).toHaveLength(1)
    expect(doc.getMap('elements').has('e1')).toBe(true)
    expect(
      watcher.received.some((d) => decodeMessage(d).kind === 'sync-update'),
    ).toBe(true)
    expect(room.connectionCount()).toBe(1) // the watcher only
    expect(released).toEqual([boardId])
  })

  it('surfaces the room reason when the mutation is rejected', async () => {
    const { boardId, editKey, doc, room, deps } = await setup()
    await expect(
      withBoard(deps, { boardId, key: editKey }, 'edit', (client) =>
        client.mutate((store) =>
          store.applyChanges(
            [
              {
                kind: 'create',
                element: {
                  ...createElement('rectangle', { index: 'a0', id: 'bad' }),
                  width: Number.NaN,
                },
              },
            ],
            'remote',
          ),
        ),
      ),
    ).rejects.toThrow(new ToolError('elements rejected: element bad'))
    expect(doc.getMap('elements').has('bad')).toBe(false)
    expect(room.connectionCount()).toBe(0)
  })

  it('maps the size limit to its own message', async () => {
    const { boardId, editKey, deps } = await setup({ maxDocBytes: 10 })
    await expect(
      withBoard(deps, { boardId, key: editKey }, 'edit', (client) =>
        client.mutate((store) =>
          store.applyChanges(
            [
              {
                kind: 'create',
                element: createElement('rectangle', { index: 'a0', id: 'r' }),
              },
            ],
            'remote',
          ),
        ),
      ),
    ).rejects.toThrow(new ToolError(`board ${boardId} exceeds the size limit`))
  })

  it('refuses a view key when edit is needed, before joining', async () => {
    const { boardId, viewKey, room, deps } = await setup()
    await expect(
      withBoard(deps, { boardId, key: viewKey }, 'edit', async () => 1),
    ).rejects.toThrow(
      new ToolError(`board ${boardId} is view-only with this link`),
    )
    expect(room.connectionCount()).toBe(0)
  })

  it('lets a view key read', async () => {
    const { boardId, viewKey, deps } = await setup()
    await expect(
      withBoard(
        deps,
        { boardId, key: viewKey },
        'view',
        async (client) => client.role,
      ),
    ).resolves.toBe('view')
  })

  it('publishes the agent presence, then removes it after presenceMs', async () => {
    // Only setTimeout/clearTimeout are faked: postgres.js schedules its
    // socket writes with a real setImmediate, and this test still runs
    // withBoard's role resolution against the real database.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { boardId, editKey, room, released, deps } = await setup()
      const watcher = observer(room)
      await withBoard(
        { ...deps, presenceMs: 5000 },
        { boardId, key: editKey },
        'edit',
        async (client) => {
          client.present({
            name: 'Claude',
            cursor: { x: 10, y: 20 },
            selectedIds: ['r1'],
          })
        },
      )
      await room.drain()
      expect(awarenessStates(watcher)).toEqual([
        {
          name: 'Claude',
          color: AGENT_COLOR,
          isAgent: true,
          cursor: { x: 10, y: 20 },
          selectedIds: ['r1'],
        },
      ])
      expect(room.connectionCount()).toBe(2)
      expect(released).toEqual([])

      vi.advanceTimersByTime(5000)
      expect(room.connectionCount()).toBe(1)
      expect(released).toEqual([boardId])
      expect(awarenessStates(watcher)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
