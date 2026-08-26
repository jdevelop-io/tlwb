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
})
