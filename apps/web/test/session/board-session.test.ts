import { createElement } from '@tlwb/engine'
import type { BoardConnection, ConnectOptions } from '@tlwb/store-yjs'
import { createLocalAwareness } from '@tlwb/store-yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openBoardSession } from '../../src/board/session/board-session'
import { writeKeys } from '../../src/board/session/keys'
import { listRecents } from '../../src/board/session/recents'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

function fakeConnect() {
  const calls: ConnectOptions[] = []
  const closeListeners = new Set<(code: number | null) => void>()
  const connect = vi.fn((doc, options: ConnectOptions): BoardConnection => {
    calls.push(options)
    return {
      provider: {} as never,
      awareness: createLocalAwareness(doc),
      getStatus: () => 'connecting',
      subscribeStatus: () => () => undefined,
      subscribeClose: (listener) => {
        closeListeners.add(listener)
        return () => closeListeners.delete(listener)
      },
      reconnect: vi.fn(),
      destroy: vi.fn(),
    }
  })
  return {
    connect,
    calls,
    close: (code: number) => {
      for (const listener of closeListeners) listener(code)
    },
  }
}

describe('openBoardSession', () => {
  it('creates a fresh local board with meta, presence, and a recents entry', async () => {
    const session = await openBoardSession({
      boardId: 'fresh1',
      fresh: true,
      identity,
      now: () => 42,
    })
    if (session === 'not-found') throw new Error('unexpected')
    expect(session.getSnapshot()).toEqual({
      boardId: 'fresh1',
      role: 'local',
      storage: 'persistent',
      status: 'local',
      closeCode: null,
    })
    expect(session.store.getMeta()).toEqual({ name: 'Untitled', createdAt: 42 })
    expect(session.presence().getPeers()).toEqual([])
    expect(listRecents()[0]).toMatchObject({ id: 'fresh1', name: 'Untitled' })
    await session.destroy()
  })

  it('reopens a board from IndexedDB and answers not-found for an unknown one', async () => {
    const first = await openBoardSession({
      boardId: 'again',
      fresh: true,
      identity,
    })
    if (first === 'not-found') throw new Error('unexpected')
    first.store.applyChanges([
      { kind: 'create', element: createElement('rectangle', { index: 'a0' }) },
    ])
    await first.destroy()

    const second = await openBoardSession({
      boardId: 'again',
      fresh: false,
      identity,
    })
    if (second === 'not-found') throw new Error('unexpected')
    expect(second.store.listElements()).toHaveLength(1)
    await second.destroy()

    expect(
      await openBoardSession({ boardId: 'nowhere', fresh: false, identity }),
    ).toBe('not-found')
  })

  it('connects a hosted board with its token and the view role', async () => {
    writeKeys('hosted', { viewKey: 'v' })
    const fake = fakeConnect()
    const session = await openBoardSession({
      boardId: 'hosted',
      fresh: false,
      identity,
      connect: fake.connect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    expect(fake.calls[0]).toMatchObject({ boardId: 'hosted', token: 'v' })
    expect(fake.calls[0]?.url).toMatch(/^wss?:\/\/.+\/ws$/)
    expect(session.getSnapshot().role).toBe('view')
    expect(session.getSnapshot().status).toBe('connecting')
    await session.destroy()
  })

  it('reports close codes, demotes to viewer on 4403, and forgets keys', async () => {
    writeKeys('hosted2', { editKey: 'e', viewKey: 'v' })
    const fake = fakeConnect()
    const session = await openBoardSession({
      boardId: 'hosted2',
      fresh: false,
      identity,
      connect: fake.connect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const seen: number[] = []
    session.subscribe(() => {
      const code = session.getSnapshot().closeCode
      if (code !== null) seen.push(code)
    })
    fake.close(4422)
    expect(seen).toEqual([4422])

    const connectionBeforeDemotion = session.connection()
    session.becomeViewer()
    expect(session.getSnapshot().role).toBe('view')
    expect(session.keys()).toEqual({ viewKey: 'e' })
    expect(session.getSnapshot().closeCode).toBeNull()
    expect(session.connection()).not.toBe(connectionBeforeDemotion)

    session.forgetKeys()
    expect(session.keys()).toBeNull()
    expect(session.getSnapshot().role).toBe('local')
    expect(session.connection()).toBeNull()
    await session.destroy()
  })

  it('adopts a hosting handoff and starts the connection', async () => {
    const session = await openBoardSession({
      boardId: 'pre',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const fake = fakeConnect()
    const hosted = await openBoardSession({
      boardId: 'other',
      fresh: true,
      identity,
      connect: fake.connect,
    })
    if (hosted === 'not-found') throw new Error('unexpected')
    const persistence = hosted.persistence()
    const assets = hosted.assets()
    if (!persistence)
      throw new Error('unexpected')
      // Reuse another session's databases as a stand-in for the migration's.
    ;(session as unknown as { connectFn: typeof fake.connect }).connectFn =
      fake.connect
    session.adoptHosting({
      boardId: 'new1',
      keys: { editKey: 'e', viewKey: 'v' },
      persistence,
      assets,
    })
    expect(session.getSnapshot()).toMatchObject({
      boardId: 'new1',
      role: 'edit',
      status: 'connecting',
    })
    expect(fake.calls.at(-1)).toMatchObject({ boardId: 'new1', token: 'e' })
    await session.destroy()
    await hosted.destroy()
  })
})
