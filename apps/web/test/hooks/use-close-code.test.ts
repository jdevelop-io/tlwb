import { act, renderHook } from '@testing-library/react'
import type { BoardConnection, ConnectOptions } from '@tlwb/store-yjs'
import { createLocalAwareness } from '@tlwb/store-yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCloseCode } from '../../src/board/hooks/use-close-code'
import { openBoardSession } from '../../src/board/session/board-session'
import { writeKeys } from '../../src/board/session/keys'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

/** Every connection it hands out closes together, as a real one would. */
function fakeConnect() {
  const closeListeners = new Set<(code: number | null) => void>()
  const connect = (doc: unknown, _options: ConnectOptions): BoardConnection =>
    ({
      provider: {} as never,
      awareness: createLocalAwareness(
        doc as Parameters<typeof createLocalAwareness>[0],
      ),
      getStatus: () => 'connecting',
      subscribeStatus: () => () => undefined,
      subscribeClose: (listener) => {
        closeListeners.add(listener)
        return () => closeListeners.delete(listener)
      },
      reconnect: () => undefined,
      destroy: () => undefined,
    }) satisfies BoardConnection
  return {
    connect,
    close: (code: number) => {
      act(() => {
        for (const listener of closeListeners) listener(code)
      })
    },
  }
}

describe('useCloseCode', () => {
  it('demotes on the first refusal and explains the second', async () => {
    writeKeys('cc1', { editKey: 'e', viewKey: 'v' })
    const fake = fakeConnect()
    const session = await openBoardSession({
      boardId: 'cc1',
      fresh: false,
      identity,
      connect: fake.connect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const transient = vi.fn()
    const { result } = renderHook(() => useCloseCode(session, transient))

    fake.close(4403)
    expect(session.getSnapshot().role).toBe('view')
    expect(result.current.editRefused).toBe(false)

    // The refused change is still in the document, so the fresh
    // connection pushes it again and the server closes again. There is
    // no key left to give up: without a notice the user would sit
    // disconnected with nothing on screen to explain it.
    fake.close(4403)
    expect(result.current.editRefused).toBe(true)
    expect(transient).not.toHaveBeenCalled()
    await session.destroy()
  })

  it('forgets the keys on a dead link and toasts a transient refusal', async () => {
    writeKeys('cc2', { editKey: 'e' })
    const fake = fakeConnect()
    const session = await openBoardSession({
      boardId: 'cc2',
      fresh: false,
      identity,
      connect: fake.connect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const transient = vi.fn()
    const { result } = renderHook(() => useCloseCode(session, transient))

    fake.close(4429)
    expect(transient).toHaveBeenCalledWith('Change refused by the server')
    expect(result.current.linkDead).toBe(false)

    fake.close(4404)
    expect(result.current.linkDead).toBe(true)
    expect(session.keys()).toBeNull()
    await session.destroy()
  })
})
