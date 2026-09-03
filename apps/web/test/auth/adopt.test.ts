import { createElement } from '@tlwb/engine'
import {
  createAssetStore,
  createBoardDoc,
  createYjsBoardStore,
  persistBoard,
} from '@tlwb/store-yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptBrowserBoards,
  collectAdoptables,
  hostLocalBoard,
} from '../../src/auth/adopt'
import { readAlias, readKeys, writeKeys } from '../../src/board/session/keys'
import { listRecents, touchRecent } from '../../src/board/session/recents'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

/**
 * Writes a board straight into IndexedDB the way a never-hosted board
 * lives there, without going through a live BoardSession.
 */
async function seedLocalBoard(
  id: string,
  options: { name?: string; withImage?: boolean } = {},
): Promise<string | null> {
  const doc = createBoardDoc()
  const store = createYjsBoardStore(doc)
  store.setMeta({ name: options.name ?? 'Local', createdAt: 1 })
  let hash: string | null = null
  if (options.withImage) {
    const assets = createAssetStore(id)
    hash = await assets.put(
      new Blob([new Uint8Array([9])], { type: 'image/png' }),
    )
    store.applyChanges([
      {
        kind: 'create',
        element: createElement('image', { index: 'a0', assetHash: hash }),
      },
    ])
    await assets.destroy()
  }
  const persistence = persistBoard(doc, id)
  await persistence.whenLoaded
  await persistence.destroy()
  return hash
}

describe('collectAdoptables', () => {
  it('collects only boards holding both keys, most recent first', () => {
    touchRecent({ id: 'p', name: 'P', updatedAt: 5 })
    touchRecent({ id: 'b', name: 'B', updatedAt: 4 })
    touchRecent({ id: 'a', name: 'A', updatedAt: 3 })
    touchRecent({ id: 'c', name: 'C', updatedAt: 2 })
    touchRecent({ id: 'd', name: 'D', updatedAt: 1 })
    writeKeys('p', { editKey: 'ep', viewKey: 'vp' })
    writeKeys('a', { editKey: 'ea', viewKey: 'va' })
    writeKeys('b', { editKey: 'eb' })
    writeKeys('c', { viewKey: 'vc' })
    // d has no keys stored at all.

    expect(collectAdoptables()).toEqual([
      { boardId: 'p', editKey: 'ep' },
      { boardId: 'a', editKey: 'ea' },
    ])
  })
})

describe('hostLocalBoard', () => {
  it('hosts a local board then reports it adoptable', async () => {
    const hash = await seedLocalBoard('local001', {
      name: 'My Board',
      withImage: true,
    })
    touchRecent({ id: 'local001', name: 'My Board', updatedAt: 1 })

    const createHostedBoard = vi.fn(async () => ({
      boardId: 'srv001xx',
      editKey: 'hostedE',
      viewKey: 'hostedV',
    }))
    const uploadAsset = vi.fn(async () => undefined)

    const result = await hostLocalBoard('local001', {
      createHostedBoard,
      uploadAsset,
      now: () => 42,
    })

    expect(result).toEqual({ boardId: 'srv001xx', editKey: 'hostedE' })
    expect(uploadAsset).toHaveBeenCalledWith(
      'srv001xx',
      hash,
      expect.any(Blob),
      'hostedE',
    )
    expect(readKeys('srv001xx')).toEqual({
      editKey: 'hostedE',
      viewKey: 'hostedV',
    })
    expect(readAlias('local001')).toBe('srv001xx')
    expect(listRecents()).toEqual([
      { id: 'srv001xx', name: 'My Board', updatedAt: 42 },
    ])
  })

  it('refuses to host a board with nothing worth adopting', async () => {
    const createHostedBoard = vi.fn(async () => ({
      boardId: 'srv002xx',
      editKey: 'e',
      viewKey: 'v',
    }))
    const result = await hostLocalBoard('nonexistent01', {
      createHostedBoard,
    })
    expect(result).toBeNull()
    expect(createHostedBoard).not.toHaveBeenCalled()
  })

  it('returns null rather than throwing when hosting fails', async () => {
    await seedLocalBoard('local002', { name: 'Boom' })
    touchRecent({ id: 'local002', name: 'Boom', updatedAt: 1 })

    const createHostedBoard = vi.fn(async () => {
      throw new Error('503')
    })
    const result = await hostLocalBoard('local002', { createHostedBoard })
    expect(result).toBeNull()
  })
})

describe('adoptBrowserBoards', () => {
  it('posts hosted and local boards together', async () => {
    touchRecent({ id: 'hosted01', name: 'H', updatedAt: 5 })
    writeKeys('hosted01', { editKey: 'eh', viewKey: 'vh' })

    await seedLocalBoard('local010', { name: 'L' })
    touchRecent({ id: 'local010', name: 'L', updatedAt: 3 })

    let adoptBody: unknown
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/boards') {
        return new Response(
          JSON.stringify({ boardId: 'srv010xx', editKey: 'el', viewKey: 'vl' }),
          { status: 201 },
        )
      }
      adoptBody = JSON.parse(init?.body as string)
      return new Response(
        JSON.stringify({ adopted: ['hosted01', 'srv010xx'], skipped: [] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchFn)

    const result = await adoptBrowserBoards({ fetchFn })

    expect(adoptBody).toEqual({
      boards: [
        { boardId: 'hosted01', editKey: 'eh' },
        { boardId: 'srv010xx', editKey: 'el' },
      ],
    })
    expect(result).toEqual({ adopted: ['hosted01', 'srv010xx'], skipped: [] })
  })

  it('a signed-out response adopts nothing and touches nothing', async () => {
    touchRecent({ id: 'hosted02', name: 'H2', updatedAt: 1 })
    writeKeys('hosted02', { editKey: 'e2', viewKey: 'v2' })

    const fetchFn = vi.fn(async () => new Response(null, { status: 401 }))
    const result = await adoptBrowserBoards({ fetchFn })

    expect(result).toEqual({ adopted: [], skipped: [] })
    expect(readKeys('hosted02')).toEqual({ editKey: 'e2', viewKey: 'v2' })
    expect(listRecents().map((r) => r.id)).toEqual(['hosted02'])
  })

  it('does nothing and never calls fetch when there is nothing to adopt', async () => {
    const fetchFn = vi.fn()
    const result = await adoptBrowserBoards({ fetchFn })
    expect(result).toEqual({ adopted: [], skipped: [] })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('caps the adoption request at 50 boards', async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      id: `b${i.toString().padStart(2, '0')}xxxxx`,
      name: 'x',
      updatedAt: i,
    }))
    localStorage.setItem('tlwb:recents', JSON.stringify(entries))
    for (const entry of entries) {
      writeKeys(entry.id, { editKey: `e${entry.id}`, viewKey: `v${entry.id}` })
    }

    let sentCount = 0
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { boards: unknown[] }
      sentCount = body.boards.length
      return new Response(JSON.stringify({ adopted: [], skipped: [] }), {
        status: 200,
      })
    }) as unknown as typeof fetch

    await adoptBrowserBoards({ fetchFn })
    expect(sentCount).toBe(50)
  })
})
