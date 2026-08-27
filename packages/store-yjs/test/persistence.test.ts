import type { BoardStoreEvent } from '@tlwb/engine'
import { createElement } from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { persistBoard } from '../src/persistence'
import { createYjsBoardStore } from '../src/store'

describe('persistBoard', () => {
  it('reloads a board written by a previous document', async () => {
    const boardId = 'persist-reload'
    const first = new Y.Doc()
    const firstStore = createYjsBoardStore(first)
    const persistence = persistBoard(first, boardId)
    await persistence.whenLoaded
    const element = createElement('rectangle', { index: 'a0', x: 5 })
    firstStore.applyChanges([{ kind: 'create', element }])
    firstStore.setMeta({ name: 'kept' })
    // The writes above are still in flight: destroy() closes the
    // database, and IDBDatabase.close() lets open transactions finish.
    await persistence.destroy()

    const second = new Y.Doc()
    const secondStore = createYjsBoardStore(second)
    const events: BoardStoreEvent[] = []
    secondStore.subscribe((event) => events.push(event))
    const reopened = persistBoard(second, boardId)
    await reopened.whenLoaded

    expect(secondStore.getElement(element.id)).toEqual(element)
    expect(secondStore.getMeta().name).toBe('kept')
    expect(
      events.some((e) => e.kind === 'changes' && e.origin === 'remote'),
    ).toBe(true)
    expect(secondStore.canUndo()).toBe(false)
    await reopened.destroy()
  })

  it('keeps boards apart by identifier', async () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const persistence = persistBoard(doc, 'persist-a')
    await persistence.whenLoaded
    store.applyChanges([
      { kind: 'create', element: createElement('rectangle', { index: 'a0' }) },
    ])
    await persistence.destroy()

    const other = new Y.Doc()
    const otherStore = createYjsBoardStore(other)
    const otherPersistence = persistBoard(other, 'persist-b')
    await otherPersistence.whenLoaded
    expect(otherStore.listElements()).toEqual([])
    await otherPersistence.destroy()
  })

  it('rejects whenLoaded when the database cannot be opened', async () => {
    const available = globalThis.indexedDB
    // fake-indexeddb always opens, so private browsing is simulated by a
    // factory whose open request fails.
    globalThis.indexedDB = {
      open: () => {
        const request: Record<string, unknown> = {}
        queueMicrotask(() => {
          const onerror = request.onerror as
            | ((event: unknown) => void)
            | undefined
          onerror?.({ target: { error: 'IndexedDB is unavailable' } })
        })
        return request
      },
    } as unknown as IDBFactory
    const reportUnhandled = process.listeners('unhandledRejection')
    // y-indexeddb chains its own handler onto the open promise and never
    // catches it, so a failed open also produces an unhandled rejection
    // from inside the library. Swallow it for this test only.
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', () => undefined)
    try {
      const persistence = persistBoard(new Y.Doc(), 'persist-unavailable')
      await expect(persistence.whenLoaded).rejects.toThrow(
        'IndexedDB is unavailable',
      )
      // Node reports unhandled rejections at the end of the tick; give it
      // one while the swallowing listener is still the only one.
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      globalThis.indexedDB = available
      process.removeAllListeners('unhandledRejection')
      for (const listener of reportUnhandled) {
        process.on('unhandledRejection', listener)
      }
    }
  })

  it('clear deletes the database so a reopen starts empty', async () => {
    const boardId = 'persist-clear'
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const persistence = persistBoard(doc, boardId)
    await persistence.whenLoaded
    store.setMeta({ name: 'gone' })
    await persistence.clear()

    const again = new Y.Doc()
    const reopened = persistBoard(again, boardId)
    await reopened.whenLoaded
    expect(createYjsBoardStore(again).getMeta().name).toBe('Untitled')
    await reopened.clear()
  })
})
