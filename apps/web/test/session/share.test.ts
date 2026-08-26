import { createElement } from '@tlwb/engine'
import type { BoardConnection } from '@tlwb/store-yjs'
import { createAssetStore, createLocalAwareness } from '@tlwb/store-yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openBoardSession } from '../../src/board/session/board-session'
import { readAlias, readKeys } from '../../src/board/session/keys'
import { listRecents } from '../../src/board/session/recents'
import { shareBoard } from '../../src/board/session/share'

const identity = { name: 'Ada', color: '#1971C2' }
const hosted = { boardId: 'srv1', editKey: 'e', viewKey: 'v' }

beforeEach(() => localStorage.clear())

const connect = vi.fn(
  (doc): BoardConnection => ({
    provider: {} as never,
    awareness: createLocalAwareness(doc),
    getStatus: () => 'connecting',
    subscribeStatus: () => () => undefined,
    subscribeClose: () => () => undefined,
    reconnect: () => undefined,
    destroy: () => undefined,
  }),
)

async function localBoard(id: string) {
  const session = await openBoardSession({
    boardId: id,
    fresh: true,
    identity,
    connect,
  })
  if (session === 'not-found') throw new Error('unexpected')
  const hash = await session
    .assets()
    .put(new Blob([new Uint8Array([9])], { type: 'image/png' }))
  session.store.applyChanges([
    {
      kind: 'create',
      element: createElement('image', { index: 'a0', assetHash: hash }),
    },
  ])
  return { session, hash }
}

describe('shareBoard', () => {
  it('moves the board to the server id, uploads assets, and rewrites local state', async () => {
    const { session, hash } = await localBoard('loc1')
    const history = { replaceState: vi.fn() }
    const uploadAsset = vi.fn(async () => undefined)
    const keys = await shareBoard(session, {
      createHostedBoard: async () => hosted,
      uploadAsset,
      history,
      now: () => 7,
    })

    expect(keys).toEqual({ editKey: 'e', viewKey: 'v' })
    expect(uploadAsset).toHaveBeenCalledWith(
      'srv1',
      hash,
      expect.any(Blob),
      'e',
    )
    expect(session.getSnapshot()).toMatchObject({
      boardId: 'srv1',
      role: 'edit',
    })
    expect(readKeys('srv1')).toEqual(keys)
    expect(readAlias('loc1')).toBe('srv1')
    expect(listRecents().map((r) => r.id)).toEqual(['srv1'])
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/b/srv1')
    expect(await session.assets().get(hash)).toBeDefined()
    expect(connect).toHaveBeenCalled()
    await session.destroy()

    // The hosted database holds the board; the local one is gone.
    const reopened = await openBoardSession({
      boardId: 'srv1',
      fresh: false,
      identity,
      connect,
    })
    if (reopened === 'not-found') throw new Error('unexpected')
    expect(reopened.store.listElements()).toHaveLength(1)
    await reopened.destroy()
    expect(
      await openBoardSession({ boardId: 'loc1', fresh: false, identity }),
    ).toBe('not-found')
  })

  it('leaves everything intact when the server refuses', async () => {
    const { session } = await localBoard('loc2')
    await expect(
      shareBoard(session, {
        createHostedBoard: async () => {
          throw new Error('429')
        },
        history: { replaceState: vi.fn() },
      }),
    ).rejects.toThrow('429')
    expect(session.getSnapshot()).toMatchObject({
      boardId: 'loc2',
      role: 'local',
    })
    expect(readAlias('loc2')).toBeNull()
    await session.destroy()
  })

  it('rolls back the hosted databases when an upload fails', async () => {
    const { session, hash } = await localBoard('loc3')
    await expect(
      shareBoard(session, {
        createHostedBoard: async () => ({ ...hosted, boardId: 'srv3' }),
        uploadAsset: async () => {
          throw new Error('415')
        },
        history: { replaceState: vi.fn() },
      }),
    ).rejects.toThrow('415')
    expect(session.getSnapshot()).toMatchObject({
      boardId: 'loc3',
      role: 'local',
    })
    expect(readKeys('srv3')).toBeNull()
    const leftover = createAssetStore('srv3')
    expect(await leftover.get(hash)).toBeUndefined()
    await leftover.delete()
    await session.destroy()
  })
})
