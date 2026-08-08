import { describe, expect, it } from 'vitest'
import { createElement } from '../src/model/create'
import { exportSnapshot, importSnapshot, parseSnapshot } from '../src/snapshot'
import { InMemoryBoardStore } from '../src/store/memory'

/** Wraps a single (possibly invalid) element into a full snapshot payload. */
function toSnapshotPayload(element: unknown) {
  return {
    schema: 1,
    meta: { name: 'x', createdAt: 1 },
    elements: [element],
  }
}

describe('board snapshot', () => {
  it('round-trips a board through export, JSON, parse, and import', () => {
    const source = new InMemoryBoardStore()
    source.setMeta({ name: 'payments architecture' })
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 10,
      width: 120,
      height: 80,
    })
    const label = createElement('text', {
      index: 'a1',
      text: 'API gateway',
      containerId: rectangle.id,
    })
    source.applyChanges([
      { kind: 'create', element: rectangle },
      { kind: 'create', element: label },
    ])

    const snapshot = parseSnapshot(
      JSON.parse(JSON.stringify(exportSnapshot(source))),
    )

    const target = new InMemoryBoardStore()
    importSnapshot(target, snapshot)
    expect(target.getMeta().name).toBe('payments architecture')
    expect(target.listElements()).toEqual(source.listElements())
  })

  it('replaces existing content on import', () => {
    const store = new InMemoryBoardStore()
    const old = createElement('ellipse', { index: 'a0' })
    store.applyChanges([{ kind: 'create', element: old }])
    importSnapshot(store, {
      schema: 1,
      meta: { name: 'fresh', createdAt: 1 },
      elements: [],
    })
    expect(store.listElements()).toEqual([])
    expect(store.getMeta().name).toBe('fresh')
  })

  it('import is not undoable', () => {
    const store = new InMemoryBoardStore()
    importSnapshot(store, {
      schema: 1,
      meta: { name: 'imported', createdAt: 1 },
      elements: [createElement('rectangle', { index: 'a0' })],
    })
    expect(store.canUndo()).toBe(false)
  })

  it('drops the previous board history on import', () => {
    const store = new InMemoryBoardStore()
    const rectangle = createElement('rectangle', { index: 'a0' })
    store.applyChanges([{ kind: 'create', element: rectangle }])
    store.applyChanges([{ kind: 'delete', id: rectangle.id }])

    const ellipse = createElement('ellipse', { index: 'a0' })
    importSnapshot(store, {
      schema: 1,
      meta: { name: 'imported', createdAt: 1 },
      elements: [ellipse],
    })

    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)
    store.undo()
    expect(store.listElements().map((element) => element.id)).toEqual([
      ellipse.id,
    ])
  })

  it('rejects data with an unknown schema version', () => {
    expect(() =>
      parseSnapshot({
        schema: 2,
        meta: { name: 'x', createdAt: 1 },
        elements: [],
      }),
    ).toThrow()
  })

  it('rejects an element with a missing required property', () => {
    expect(() =>
      parseSnapshot({
        schema: 1,
        meta: { name: 'x', createdAt: 1 },
        elements: [{ type: 'rectangle', id: 'e1' }],
      }),
    ).toThrow()
  })

  it('strips properties belonging to another variant', () => {
    const rectangle = createElement('rectangle', { index: 'a0' })
    const contaminated = { ...rectangle, points: [{ x: 1, y: 2 }] }

    const parsed = parseSnapshot(toSnapshotPayload(contaminated))

    expect(parsed.elements[0]).not.toHaveProperty('points')
  })

  it('rejects an invalid enum member', () => {
    const rectangle = createElement('rectangle', { index: 'a0' })
    const invalid = { ...rectangle, strokeStyle: 'dotted' }

    expect(() => parseSnapshot(toSnapshotPayload(invalid))).toThrow()
  })

  it('rejects an unknown element type', () => {
    const rectangle = createElement('rectangle', { index: 'a0' })
    const invalid = { ...rectangle, type: 'hexagon' }

    expect(() => parseSnapshot(toSnapshotPayload(invalid))).toThrow()
  })
})
