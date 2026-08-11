import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type {
  ArrowElement,
  BoardElement,
  TextElement,
} from '../../src/model/element'
import {
  bringForward,
  bringToFront,
  deleteElements,
  duplicateElements,
  groupElements,
  sendBackward,
  sendToBack,
  ungroupElements,
} from '../../src/model/operations'
import { sortByIndex } from '../../src/model/ordering'
import type { BoardChange } from '../../src/store/types'

function applyToList(
  elements: readonly BoardElement[],
  changes: readonly BoardChange[],
): BoardElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  for (const change of changes) {
    if (change.kind === 'create') {
      byId.set(change.element.id, change.element)
    } else if (change.kind === 'update') {
      const element = byId.get(change.id)
      if (element) {
        byId.set(change.id, { ...element, ...change.props } as BoardElement)
      }
    } else {
      byId.delete(change.id)
    }
  }
  return sortByIndex([...byId.values()])
}

describe('deleteElements', () => {
  it('cascades to bound labels and unbinds surviving arrows', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      width: 100,
      height: 100,
    })
    const label = createElement('text', {
      index: 'a1',
      text: 'label',
      containerId: shape.id,
    })
    const arrow = createElement('arrow', {
      index: 'a2',
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      startBinding: { elementId: shape.id },
      endBinding: null,
    })
    const elements = [shape, label, arrow]
    const after = applyToList(elements, deleteElements(elements, [shape.id]))
    expect(after.map((element) => element.id)).toEqual([arrow.id])
    expect((after[0] as ArrowElement).startBinding).toBeNull()
  })
})

describe('duplicateElements', () => {
  it('clones with fresh ids, offset, and top z-order', () => {
    const bottom = createElement('rectangle', { index: 'a0', x: 0, y: 0 })
    const top = createElement('ellipse', { index: 'a1', x: 10, y: 10 })
    const elements = [bottom, top]
    const { changes, newIds } = duplicateElements(elements, [bottom.id], {
      x: 10,
      y: 10,
    })
    const after = applyToList(elements, changes)
    expect(newIds).toHaveLength(1)
    const clone = after.find((element) => element.id === newIds[0])
    expect(clone?.x).toBe(10)
    expect(clone?.y).toBe(10)
    expect(after.map((element) => element.id)).toEqual([
      bottom.id,
      top.id,
      newIds[0],
    ])
  })

  it('remaps groups, bindings, and label containers among the clones', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      width: 100,
      height: 100,
      groupId: 'g1',
    })
    const label = createElement('text', {
      index: 'a1',
      text: 'label',
      containerId: shape.id,
      groupId: 'g1',
    })
    const arrow = createElement('arrow', {
      index: 'a2',
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      startBinding: { elementId: shape.id },
      endBinding: { elementId: 'missing-elsewhere' },
      groupId: 'g1',
    })
    const elements = [shape, label, arrow]
    const { changes, newIds } = duplicateElements(
      elements,
      [shape.id, label.id, arrow.id],
      { x: 0, y: 0 },
    )
    const after = applyToList(elements, changes)
    const clones = after.filter((element) => newIds.includes(element.id))
    expect(clones).toHaveLength(3)
    const [shapeClone, labelClone, arrowClone] = clones as [
      BoardElement,
      TextElement,
      ArrowElement,
    ]
    expect(shapeClone.groupId).not.toBe('g1')
    expect(labelClone.groupId).toBe(shapeClone.groupId)
    expect(labelClone.containerId).toBe(shapeClone.id)
    expect(arrowClone.startBinding).toEqual({ elementId: shapeClone.id })
    expect(arrowClone.endBinding).toBeNull()
  })
})

describe('groupElements / ungroupElements', () => {
  it('assigns one fresh shared group id and merges touched groups', () => {
    const a = createElement('rectangle', { index: 'a0', groupId: 'old' })
    const b = createElement('rectangle', { index: 'a1', groupId: 'old' })
    const c = createElement('rectangle', { index: 'a2' })
    const elements = [a, b, c]
    const after = applyToList(elements, groupElements(elements, [a.id, c.id]))
    const groups = new Set(after.map((element) => element.groupId))
    expect(groups.size).toBe(1)
    expect(groups.has('old')).toBe(false)
    expect(groups.has(null)).toBe(false)
  })

  it('does nothing with fewer than two targets', () => {
    const a = createElement('rectangle', { index: 'a0' })
    expect(groupElements([a], [a.id])).toEqual([])
  })

  it('clears the group id of every member of touched groups', () => {
    const a = createElement('rectangle', { index: 'a0', groupId: 'g1' })
    const b = createElement('rectangle', { index: 'a1', groupId: 'g1' })
    const elements = [a, b]
    const after = applyToList(elements, ungroupElements(elements, [a.id]))
    expect(after.every((element) => element.groupId === null)).toBe(true)
  })
})

describe('z-order', () => {
  function ids(elements: readonly BoardElement[]): string[] {
    return elements.map((element) => element.id)
  }

  it('brings a selection to the front preserving relative order', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    const c = createElement('rectangle', { index: 'a2' })
    const elements = [a, b, c]
    const after = applyToList(elements, bringToFront(elements, [a.id, b.id]))
    expect(ids(after)).toEqual([c.id, a.id, b.id])
  })

  it('sends a selection to the back preserving relative order', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    const c = createElement('rectangle', { index: 'a2' })
    const elements = [a, b, c]
    const after = applyToList(elements, sendToBack(elements, [b.id, c.id]))
    expect(ids(after)).toEqual([b.id, c.id, a.id])
  })

  it('steps the selection block over its nearest neighbors', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    const c = createElement('rectangle', { index: 'a2' })
    const elements = [a, b, c]
    expect(ids(applyToList(elements, bringForward(elements, [a.id])))).toEqual([
      b.id,
      a.id,
      c.id,
    ])
    expect(ids(applyToList(elements, sendBackward(elements, [c.id])))).toEqual([
      a.id,
      c.id,
      b.id,
    ])
  })

  it('is a no-op at the extremes', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    const elements = [a, b]
    expect(bringForward(elements, [b.id])).toEqual([])
    expect(sendBackward(elements, [a.id])).toEqual([])
  })
})
