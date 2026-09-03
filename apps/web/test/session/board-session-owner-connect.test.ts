import type {
  BoardConnection,
  ConnectionStatus,
  ConnectOptions,
} from '@tlwb/store-yjs'
import { createLocalAwareness } from '@tlwb/store-yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openBoardSession } from '../../src/board/session/board-session'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

/**
 * Unlike the `fakeConnect` in board-session.test.ts, this one can fire
 * the status transition its caller is waiting on: the owner-connect
 * path awaits the very first outcome of the dial before deciding
 * whether to hand back a session.
 */
function fakeConnect() {
  const calls: ConnectOptions[] = []
  const statusListeners = new Set<(status: ConnectionStatus) => void>()
  const closeListeners = new Set<(code: number | null) => void>()
  const connect = vi.fn((doc, options: ConnectOptions): BoardConnection => {
    calls.push(options)
    return {
      provider: {} as never,
      awareness: createLocalAwareness(doc),
      getStatus: () => 'connecting',
      subscribeStatus: (listener) => {
        statusListeners.add(listener)
        return () => statusListeners.delete(listener)
      },
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
    status: (next: ConnectionStatus) => {
      for (const listener of statusListeners) listener(next)
    },
    close: (code: number | null) => {
      for (const listener of closeListeners) listener(code)
    },
  }
}

describe('openBoardSession: a signed-in visitor with no key', () => {
  it('dials a keyless connection and gets the edit role once the server grants it', async () => {
    const fake = fakeConnect()
    const pending = openBoardSession({
      boardId: 'owned-elsewhere',
      fresh: false,
      identity,
      signedIn: true,
      connect: fake.connect,
    })
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
    expect(fake.calls[0]).toMatchObject({
      boardId: 'owned-elsewhere',
      token: undefined,
    })

    fake.status('connected')
    const session = await pending
    if (session === 'not-found') throw new Error('unexpected')
    expect(session.getSnapshot().role).toBe('edit')
    expect(session.getSnapshot().status).toBe('connected')
    // There never was a key to hand out; nothing pretends otherwise.
    expect(session.keys()).toBeNull()
    await session.destroy()
  })

  it('falls back to the same not-found an anonymous visitor gets when the server refuses', async () => {
    const fake = fakeConnect()
    const pending = openBoardSession({
      boardId: 'not-mine',
      fresh: false,
      identity,
      signedIn: true,
      connect: fake.connect,
    })
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))

    fake.close(4401)
    expect(await pending).toBe('not-found')
  })

  it('keeps waiting through a transient close instead of treating it as a refusal', async () => {
    const fake = fakeConnect()
    const pending = openBoardSession({
      boardId: 'flaky',
      fresh: false,
      identity,
      signedIn: true,
      connect: fake.connect,
    })
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))

    let settled: 'not-found' | 'session' | null = null
    void pending.then((result) => {
      settled = result === 'not-found' ? 'not-found' : 'session'
    })

    // 1006 (abnormal closure) is not in PERMANENT_CLOSE_CODES: a network
    // blip or a server restart, the same shape of event the provider's
    // own `shouldReconnect` already retries on its own.
    fake.close(1006)
    // A (wrongly) settled promise above still has to run through the
    // abandon path's IndexedDB teardown before `pending` resolves, so a
    // couple of microtask ticks are not a reliable enough flush; give it
    // a real macrotask turn instead.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBeNull()

    fake.status('connected')
    const session = await pending
    if (session === 'not-found') throw new Error('unexpected')
    expect(session.getSnapshot().role).toBe('edit')
    await session.destroy()
  })

  it('falls back to not-found after a timeout instead of waiting forever', async () => {
    const fake = fakeConnect()
    const pending = openBoardSession({
      boardId: 'unreachable',
      fresh: false,
      identity,
      signedIn: true,
      connect: fake.connect,
      // A short override: proves the fallback actually fires without a
      // real multi-second wait in the suite.
      ownerConnectTimeoutMs: 300,
    })
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))

    let settled: 'not-found' | 'session' | null = null
    void pending.then((result) => {
      settled = result === 'not-found' ? 'not-found' : 'session'
    })

    // Neither 'connected' nor a permanent close ever arrives (the
    // server is unreachable, or every close the provider gets is one it
    // keeps retrying): still unsettled well short of the timeout.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(settled).toBeNull()

    expect(await pending).toBe('not-found')
  })
})

describe('openBoardSession: an anonymous visitor with no key', () => {
  it('never attempts a connection: still the plain not-found', async () => {
    const fake = fakeConnect()
    const result = await openBoardSession({
      boardId: 'nowhere-anon',
      fresh: false,
      identity,
      connect: fake.connect,
    })
    expect(result).toBe('not-found')
    expect(fake.calls).toHaveLength(0)
  })
})
