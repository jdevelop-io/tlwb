import { describe, expect, it } from 'vitest'
import { createElement } from '../model/create'
import type { LineElement } from '../model/element'
import type { BoardChange, BoardStore, BoardStoreEvent } from './types'

type ChangesEvent = Extract<BoardStoreEvent, { kind: 'changes' }>
type MetaEvent = Extract<BoardStoreEvent, { kind: 'meta' }>

/** Narrows to a 'changes' event, failing the test when it is not one. */
function expectChangesEvent(event: BoardStoreEvent | undefined): ChangesEvent {
  if (event?.kind !== 'changes') {
    throw new Error(`expected a 'changes' event, got ${event?.kind ?? 'none'}`)
  }
  return event
}

/** Narrows to a 'meta' event, failing the test when it is not one. */
function expectMetaEvent(event: BoardStoreEvent | undefined): MetaEvent {
  if (event?.kind !== 'meta') {
    throw new Error(`expected a 'meta' event, got ${event?.kind ?? 'none'}`)
  }
  return event
}

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
      expect(expectChangesEvent(events[0]).origin).toBe('local')
      expect(expectChangesEvent(events[0]).changes).toHaveLength(2)
    })

    it('propagates the given origin to the event', () => {
      const store = createStore()
      const events: BoardStoreEvent[] = []
      store.subscribe((event) => events.push(event))
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }], 'remote')
      expect(expectChangesEvent(events[0]).origin).toBe('remote')
    })

    it('emits a snapshot of the batch, not the caller array', () => {
      const store = createStore()
      const events: BoardStoreEvent[] = []
      store.subscribe((event) => events.push(event))
      const element = createElement('rectangle', { index: 'a0' })
      const batch: BoardChange[] = [{ kind: 'create', element }]
      store.applyChanges(batch)
      batch.push({ kind: 'delete', id: element.id })
      expect(expectChangesEvent(events[0]).changes).toHaveLength(1)
    })

    it('ignores an update or a delete naming an unknown element', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])
      expect(() =>
        store.applyChanges([
          { kind: 'update', id: 'nonexistent', props: { x: 1 } },
          { kind: 'delete', id: 'nonexistent' },
        ]),
      ).not.toThrow()
      expect(store.listElements().map((el) => el.id)).toEqual([element.id])
      expect(store.getElement(element.id)?.x).toBe(5)
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

    it('emits a meta event carrying the merged meta', () => {
      const store = createStore()
      const events: BoardStoreEvent[] = []
      store.subscribe((event) => events.push(event))
      store.setMeta({ name: 'payments architecture' })
      expect(events).toHaveLength(1)
      const meta = expectMetaEvent(events[0]).meta
      expect(meta.name).toBe('payments architecture')
      expect(typeof meta.createdAt).toBe('number')
    })

    it('undoes the newest local batch and emits an undo event', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])
      const events: BoardStoreEvent[] = []
      store.subscribe((event) => events.push(event))
      expect(store.canUndo()).toBe(true)
      store.undo()
      expect(store.getElement(element.id)).toBeUndefined()
      expect(expectChangesEvent(events[0]).origin).toBe('undo')
    })

    it('undoes an update by restoring the prior property values', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])
      store.applyChanges([{ kind: 'update', id: element.id, props: { x: 42 } }])
      store.undo()
      expect(store.getElement(element.id)?.x).toBe(5)
    })

    it('redoes an undone batch', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }])
      store.undo()
      expect(store.canRedo()).toBe(true)
      store.redo()
      expect(store.getElement(element.id)).toBeDefined()
      expect(store.canRedo()).toBe(false)
      expect(store.canUndo()).toBe(true)
    })

    it('does not undo remote batches', () => {
      const store = createStore()
      const local = createElement('rectangle', { index: 'a0' })
      const remote = createElement('ellipse', { index: 'a1' })
      store.applyChanges([{ kind: 'create', element: local }])
      store.applyChanges([{ kind: 'create', element: remote }], 'remote')
      store.undo()
      expect(store.getElement(local.id)).toBeUndefined()
      expect(store.getElement(remote.id)).toBeDefined()
      expect(store.canUndo()).toBe(false)
    })

    it('clears the redo stack on a new local batch', () => {
      const store = createStore()
      const first = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element: first }])
      store.undo()
      const second = createElement('ellipse', { index: 'a1' })
      store.applyChanges([{ kind: 'create', element: second }])
      expect(store.canRedo()).toBe(false)
    })

    it('does not create an undo entry for a batch that inverts to nothing', () => {
      const store = createStore()
      store.applyChanges([])
      expect(store.canUndo()).toBe(false)
      store.applyChanges([
        { kind: 'update', id: 'nonexistent', props: { x: 1 } },
        { kind: 'delete', id: 'nonexistent' },
      ])
      expect(store.canUndo()).toBe(false)
    })

    it('drops undo and redo history on clearHistory', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }])
      store.applyChanges([{ kind: 'delete', id: element.id }])
      store.undo()
      expect(store.canUndo()).toBe(true)
      expect(store.canRedo()).toBe(true)

      store.clearHistory()

      expect(store.canUndo()).toBe(false)
      expect(store.canRedo()).toBe(false)
      const listed = store.listElements().map((el) => el.id)
      store.undo()
      store.redo()
      expect(store.listElements().map((el) => el.id)).toEqual(listed)
    })

    it('does not resurrect replaced content when history is cleared', () => {
      const store = createStore()
      const rectangle = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element: rectangle }])
      store.applyChanges([{ kind: 'delete', id: rectangle.id }])

      const ellipse = createElement('ellipse', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element: ellipse }], 'remote')
      store.clearHistory()

      expect(store.canUndo()).toBe(false)
      store.undo()
      expect(store.listElements().map((el) => el.id)).toEqual([ellipse.id])
    })

    it('is a no-op to undo or redo with empty stacks', () => {
      const store = createStore()
      expect(store.canUndo()).toBe(false)
      expect(store.canRedo()).toBe(false)
      store.undo()
      store.redo()
      expect(store.listElements()).toEqual([])
    })

    it('does not expose its internal element state to callers', () => {
      const store = createStore()
      const element = createElement('line', {
        index: 'a0',
        x: 5,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      })
      store.applyChanges([{ kind: 'create', element }])

      const fromGetElement = store.getElement(element.id) as LineElement
      expect(() => {
        ;(fromGetElement as unknown as Record<string, unknown>).x = 999
      }).toThrow(TypeError)
      expect(store.getElement(element.id)?.x).toBe(5)

      const fromListElements = store.listElements()[0] as LineElement
      expect(fromListElements.points).toHaveLength(2)
      expect(() => {
        ;(fromListElements.points[0] as unknown as Record<string, unknown>).x =
          999
      }).toThrow(TypeError)
      expect((store.getElement(element.id) as LineElement).points[0]?.x).toBe(0)
    })

    it('does not let the caller mutate an element after applying it', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])

      expect(() => {
        ;(element as unknown as Record<string, unknown>).x = 999
      }).toThrow(TypeError)
      expect(store.getElement(element.id)?.x).toBe(5)
    })
  })
}
