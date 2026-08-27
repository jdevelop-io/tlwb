import { createElement } from '@tlwb/engine'
import type { BoardConnection } from '@tlwb/store-yjs'
import { createLocalAwareness } from '@tlwb/store-yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  download,
  duplicateBoard,
  removeBoard,
} from '../../src/board/session/board-actions'
import { openBoardSession } from '../../src/board/session/board-session'
import {
  readAlias,
  readKeys,
  writeAlias,
  writeKeys,
} from '../../src/board/session/keys'
import { listRecents } from '../../src/board/session/recents'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

// A hosted board dials out on open; the test never wants a real socket.
function fakeConnect(doc: Parameters<typeof createLocalAwareness>[0]) {
  return {
    provider: {} as never,
    awareness: createLocalAwareness(doc),
    getStatus: () => 'connecting',
    subscribeStatus: () => () => undefined,
    subscribeClose: () => () => undefined,
    reconnect: vi.fn(),
    destroy: vi.fn(),
  } satisfies BoardConnection
}

describe('board actions', () => {
  it('duplicates elements, assets, and name into a new local board', async () => {
    const session = await openBoardSession({
      boardId: 'dup',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    session.store.setMeta({ name: 'Plan' })
    const hash = await session
      .assets()
      .put(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    session.store.applyChanges([
      {
        kind: 'create',
        element: createElement('image', { index: 'a0', assetHash: hash }),
      },
    ])
    const newId = await duplicateBoard(session, 'dup-copy', () => 5)
    await session.destroy()

    const copy = await openBoardSession({
      boardId: newId,
      fresh: false,
      identity,
    })
    if (copy === 'not-found') throw new Error('unexpected')
    expect(copy.store.getMeta()).toEqual({ name: 'Plan copy', createdAt: 5 })
    expect(copy.store.listElements()).toHaveLength(1)
    expect(await copy.assets().get(hash)).toBeDefined()
    expect(copy.store.canUndo()).toBe(false)
    await copy.destroy()
  })

  it('removes every local trace of a board', async () => {
    writeKeys('gone', { editKey: 'e' })
    writeAlias('old', 'gone')
    const session = await openBoardSession({
      boardId: 'gone',
      fresh: true,
      identity,
      connect: fakeConnect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    await removeBoard(session)
    expect(readKeys('gone')).toBeNull()
    expect(readAlias('old')).toBeNull()
    expect(listRecents()).toEqual([])
    expect(
      await openBoardSession({ boardId: 'gone', fresh: false, identity }),
    ).toBe('not-found')
  })

  it('clears local traces even when the database teardown fails', async () => {
    writeKeys('bad', { editKey: 'e' })
    writeAlias('old2', 'bad')
    const session = await openBoardSession({
      boardId: 'bad',
      fresh: true,
      identity,
      connect: fakeConnect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const persistence = session.persistence()
    if (persistence) {
      persistence.clear = vi.fn().mockRejectedValue(new Error('boom'))
    }

    await expect(removeBoard(session)).rejects.toThrow('boom')

    expect(readKeys('bad')).toBeNull()
    expect(readAlias('old2')).toBeNull()
    expect(listRecents()).toEqual([])
  })
})

describe('download', () => {
  it('creates a downloadable anchor, clicks it, and revokes the object URL', () => {
    const anchor = { href: '', download: '', click: vi.fn() }
    const fakeDoc = {
      createElement: vi.fn(() => anchor),
    } as unknown as Document
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:fake')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const blob = new Blob(['hi'], { type: 'text/plain' })

    download(blob, 'notes.txt', fakeDoc)

    expect(fakeDoc.createElement).toHaveBeenCalledWith('a')
    expect(anchor.href).toBe('blob:fake')
    expect(anchor.download).toBe('notes.txt')
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')

    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })
})
