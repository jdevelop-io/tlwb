import type { BoardStoreEvent, LineElement } from '@tlwb/engine'
import { createElement } from '@tlwb/engine'
import { describeBoardStoreContract } from '@tlwb/engine/testing'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createYjsBoardStore } from '../src/store'

type ChangesEvent = Extract<BoardStoreEvent, { kind: 'changes' }>

function expectChangesEvent(event: BoardStoreEvent | undefined): ChangesEvent {
  if (event?.kind !== 'changes') {
    throw new Error(`expected a 'changes' event, got ${event?.kind ?? 'none'}`)
  }
  return event
}

describe('createYjsBoardStore', () => {
  it('writes a created element into the elements map', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const element = createElement('rectangle', { index: 'a0', x: 5 })
    store.applyChanges([{ kind: 'create', element }])
    const map = doc.getMap<Y.Map<unknown>>('elements').get(element.id)
    expect(map?.get('x')).toBe(5)
    expect(map?.get('type')).toBe('rectangle')
  })

  it('reads an element written directly into the document', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const element = createElement('ellipse', { index: 'a0', y: 7 })
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>('elements')
        .set(element.id, new Y.Map(Object.entries(element)))
    })
    expect(store.getElement(element.id)).toEqual(element)
    expect(store.listElements()).toEqual([element])
  })

  it('reports a foreign transaction as a remote batch with only the changed props', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const element = createElement('rectangle', { index: 'a0', x: 5 })
    store.applyChanges([{ kind: 'create', element }])
    const events: BoardStoreEvent[] = []
    store.subscribe((event) => events.push(event))
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>('elements').get(element.id)?.set('x', 42)
    })
    expect(events).toHaveLength(1)
    const event = expectChangesEvent(events[0])
    expect(event.origin).toBe('remote')
    expect(event.changes).toEqual([
      { kind: 'update', id: element.id, props: { x: 42 } },
    ])
    expect(store.getElement(element.id)?.x).toBe(42)
  })

  it("keeps the identity of an element another one's remote update did not touch", () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    store.applyChanges([
      { kind: 'create', element: a },
      { kind: 'create', element: b },
    ])
    const aBefore = store.getElement(a.id)
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>('elements').get(b.id)?.set('x', 1)
    })
    expect(store.getElement(a.id)).toBe(aBefore)
    expect(store.getElement(b.id)?.x).toBe(1)
  })

  it('freezes elements read back from the document', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const element = createElement('line', {
      index: 'a0',
      points: [{ x: 0, y: 0 }],
    })
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>('elements')
        .set(element.id, new Y.Map(Object.entries(element)))
    })
    const read = store.getElement(element.id) as LineElement
    expect(Object.isFrozen(read)).toBe(true)
    expect(Object.isFrozen(read.points[0])).toBe(true)
  })

  it('emits no event for a batch that changes nothing', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const events: BoardStoreEvent[] = []
    store.subscribe((event) => events.push(event))
    const element = createElement('rectangle', { index: 'a0' })
    store.applyChanges([])
    store.applyChanges([{ kind: 'update', id: 'missing', props: { x: 1 } }])
    store.applyChanges([
      { kind: 'create', element },
      { kind: 'delete', id: element.id },
    ])
    expect(events).toHaveLength(0)
  })

  it('folds a create and an update of the same element into one create', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const events: BoardStoreEvent[] = []
    store.subscribe((event) => events.push(event))
    const element = createElement('rectangle', { index: 'a0', x: 0 })
    store.applyChanges([
      { kind: 'create', element },
      { kind: 'update', id: element.id, props: { x: 42 } },
    ])

    expect(events).toHaveLength(1)
    expect(expectChangesEvent(events[0]).changes).toEqual([
      { kind: 'create', element: { ...element, x: 42 } },
    ])
  })

  it('hands out a list a caller cannot mutate', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    store.applyChanges([
      { kind: 'create', element: createElement('rectangle', { index: 'a0' }) },
    ])
    const listed = store.listElements()

    expect(Object.isFrozen(listed)).toBe(true)
    expect(() => {
      listed.push(createElement('ellipse', { index: 'a1' }))
    }).toThrow(TypeError)
    expect(store.listElements()).toHaveLength(1)
  })

  it('ignores a value written under an element id that is not a map', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const element = createElement('rectangle', { index: 'a0', x: 5 })
    store.applyChanges([{ kind: 'create', element }])
    const events: BoardStoreEvent[] = []
    store.subscribe((event) => events.push(event))

    const peer = new Y.Doc()
    const malformed = new Y.Array<number>()
    peer.getMap<unknown>('elements').set('malformed', malformed)
    malformed.push([1])
    expect(() => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer))
    }).not.toThrow()

    // The same value changing again must not crash the observer either.
    const received = doc.getMap<unknown>('elements').get('malformed')
    expect(() => {
      doc.transact(() => {
        ;(received as Y.Array<number>).push([2])
      })
    }).not.toThrow()

    expect(store.getElement('malformed')).toBeUndefined()
    expect(store.getElement(element.id)).toEqual(element)
    expect(store.listElements()).toEqual([element])
    expect(events).toEqual([])
  })

  it('reads default meta from an empty document', () => {
    const store = createYjsBoardStore(new Y.Doc())
    expect(store.getMeta()).toEqual({ name: 'Untitled', createdAt: 0 })
  })
})

describeBoardStoreContract('yjs', () => createYjsBoardStore(new Y.Doc()))
