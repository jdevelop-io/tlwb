import { describe, expect, it } from 'vitest'
import { createElement } from '../model/create'
import type { BoardStore, BoardStoreEvent } from './types'

/**
 * Behavioral contract every BoardStore implementation must satisfy.
 * Call it from a test file with a factory for the implementation.
 */
export function describeBoardStoreContract(
  name: string,
  createStore: () => BoardStore,
): void {
  describe(`BoardStore contract: ${name}`, () => {
    it('creates and reads an element', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])
      expect(store.getElement(element.id)).toEqual(element)
    })

    it('lists elements sorted by fractional index', () => {
      const store = createStore()
      const back = createElement('rectangle', { index: 'a0' })
      const front = createElement('rectangle', { index: 'a2' })
      const middle = createElement('rectangle', { index: 'a1' })
      store.applyChanges([
        { kind: 'create', element: front },
        { kind: 'create', element: back },
        { kind: 'create', element: middle },
      ])
      expect(store.listElements().map((el) => el.id)).toEqual([
        back.id,
        middle.id,
        front.id,
      ])
    })

    it('merges update props into an existing element', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])
      store.applyChanges([
        { kind: 'update', id: element.id, props: { x: 42, opacity: 0.5 } },
      ])
      const updated = store.getElement(element.id)
      expect(updated?.x).toBe(42)
      expect(updated?.opacity).toBe(0.5)
      expect(updated?.width).toBe(element.width)
    })

    it('deletes an element', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }])
      store.applyChanges([{ kind: 'delete', id: element.id }])
      expect(store.getElement(element.id)).toBeUndefined()
      expect(store.listElements()).toEqual([])
    })

    it('emits exactly one event per batch, with origin local by default', () => {
      const store = createStore()
      const events: BoardStoreEvent[] = []
      store.subscribe((event) => events.push(event))
      const a = createElement('rectangle', { index: 'a0' })
      const b = createElement('ellipse', { index: 'a1' })
      store.applyChanges([
        { kind: 'create', element: a },
        { kind: 'create', element: b },
      ])
      expect(events).toHaveLength(1)
      expect(events[0]?.origin).toBe('local')
      expect(events[0]?.changes).toHaveLength(2)
    })

    it('propagates the given origin to the event', () => {
      const store = createStore()
      const events: BoardStoreEvent[] = []
      store.subscribe((event) => events.push(event))
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }], 'remote')
      expect(events[0]?.origin).toBe('remote')
    })

    it('stops notifying after unsubscribe', () => {
      const store = createStore()
      const events: BoardStoreEvent[] = []
      const unsubscribe = store.subscribe((event) => events.push(event))
      unsubscribe()
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }])
      expect(events).toHaveLength(0)
    })

    it('updates board meta with a partial patch', () => {
      const store = createStore()
      store.setMeta({ name: 'payments architecture' })
      expect(store.getMeta().name).toBe('payments architecture')
      expect(typeof store.getMeta().createdAt).toBe('number')
    })
  })
}
