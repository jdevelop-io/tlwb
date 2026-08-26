import type { BoardStore } from '@tlwb/engine'
import { createElement } from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createYjsBoardStore } from '../src/store'

/** Two collaborators on the same board with no network in between. */
function pair(): { a: Peer; b: Peer } {
  const a = peer()
  const b = peer()
  sync(a, b)
  return { a, b }
}

interface Peer {
  doc: Y.Doc
  store: BoardStore
}

function peer(): Peer {
  const doc = new Y.Doc()
  return { doc, store: createYjsBoardStore(doc) }
}

/** Exchanges the full state both ways, as a reconnection would. */
function sync(a: Peer, b: Peer): void {
  const fromA = Y.encodeStateAsUpdate(a.doc)
  const fromB = Y.encodeStateAsUpdate(b.doc)
  Y.applyUpdate(b.doc, fromA)
  Y.applyUpdate(a.doc, fromB)
}

function ids(store: BoardStore): string[] {
  return store.listElements().map((element) => element.id)
}

describe('two collaborators', () => {
  it('keeps both moves when each moves a different shape', () => {
    const { a, b } = pair()
    const left = createElement('rectangle', { index: 'a0', x: 0 })
    const right = createElement('rectangle', { index: 'a1', x: 100 })
    a.store.applyChanges([
      { kind: 'create', element: left },
      { kind: 'create', element: right },
    ])
    sync(a, b)

    a.store.applyChanges([{ kind: 'update', id: left.id, props: { x: 10 } }])
    b.store.applyChanges([{ kind: 'update', id: right.id, props: { x: 110 } }])
    sync(a, b)

    for (const store of [a.store, b.store]) {
      expect(store.getElement(left.id)?.x).toBe(10)
      expect(store.getElement(right.id)?.x).toBe(110)
    }
  })

  it('converges on the same value when both set the same property', () => {
    const { a, b } = pair()
    const shape = createElement('rectangle', { index: 'a0', x: 0 })
    a.store.applyChanges([{ kind: 'create', element: shape }])
    sync(a, b)

    a.store.applyChanges([{ kind: 'update', id: shape.id, props: { x: 1 } }])
    b.store.applyChanges([{ kind: 'update', id: shape.id, props: { x: 2 } }])
    sync(a, b)

    const fromA = a.store.getElement(shape.id)?.x
    const fromB = b.store.getElement(shape.id)?.x
    expect(fromA).toBe(fromB)
    expect([1, 2]).toContain(fromA)
  })

  it('converges after both edited offline', () => {
    const { a, b } = pair()
    for (let i = 0; i < 5; i += 1) {
      a.store.applyChanges([
        {
          kind: 'create',
          element: createElement('rectangle', { index: `a${i}` }),
        },
      ])
    }
    for (let i = 0; i < 3; i += 1) {
      b.store.applyChanges([
        {
          kind: 'create',
          element: createElement('ellipse', { index: `b${i}` }),
        },
      ])
    }
    sync(a, b)

    expect(ids(a.store)).toHaveLength(8)
    expect(ids(a.store)).toEqual(ids(b.store))
    expect(a.store.listElements()).toEqual(b.store.listElements())
  })

  it("reports the other collaborator's edits as remote and never undoes them", () => {
    const { a, b } = pair()
    const mine = createElement('rectangle', { index: 'a0' })
    a.store.applyChanges([{ kind: 'create', element: mine }])
    sync(a, b)

    const origins: string[] = []
    a.store.subscribe((event) => {
      if (event.kind === 'changes') origins.push(event.origin)
    })
    const theirs = createElement('ellipse', { index: 'a1' })
    b.store.applyChanges([{ kind: 'create', element: theirs }])
    sync(a, b)
    expect(origins).toEqual(['remote'])

    a.store.undo()
    expect(a.store.getElement(mine.id)).toBeUndefined()
    expect(a.store.getElement(theirs.id)).toBeDefined()
    expect(a.store.canUndo()).toBe(false)
  })

  it('undoes only the local property when both touched the same element', () => {
    const { a, b } = pair()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      fillColor: null,
    })
    a.store.applyChanges([{ kind: 'create', element: shape }])
    a.store.stopCapturing()
    sync(a, b)

    a.store.applyChanges([{ kind: 'update', id: shape.id, props: { x: 50 } }])
    b.store.applyChanges([
      { kind: 'update', id: shape.id, props: { fillColor: '#FFD166' } },
    ])
    sync(a, b)

    a.store.undo()
    sync(a, b)

    for (const store of [a.store, b.store]) {
      expect(store.getElement(shape.id)?.x).toBe(0)
      expect(store.getElement(shape.id)?.fillColor).toBe('#FFD166')
    }
  })
})
