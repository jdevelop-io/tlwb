import { describe, expect, it } from 'vitest'
import { createElement } from '../src/model/create'
import {
  elementsInRect,
  expandToGroups,
  selectionBounds,
} from '../src/selection'

const groupA = 'group-a'

function sampleElements() {
  const first = createElement('rectangle', {
    index: 'a0',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    groupId: groupA,
  })
  const second = createElement('ellipse', {
    index: 'a1',
    x: 200,
    y: 0,
    width: 50,
    height: 50,
    groupId: groupA,
  })
  const loner = createElement('rectangle', {
    index: 'a2',
    x: 400,
    y: 400,
    width: 10,
    height: 10,
  })
  return { first, second, loner, all: [first, second, loner] }
}

describe('expandToGroups', () => {
  it('pulls in every member of a touched group, in z-order', () => {
    const { first, second, loner, all } = sampleElements()
    expect(expandToGroups(all, [second.id])).toEqual([first.id, second.id])
    expect(expandToGroups(all, [loner.id])).toEqual([loner.id])
  })

  it('keeps ungrouped ids untouched', () => {
    const { loner, all } = sampleElements()
    expect(expandToGroups(all, [loner.id, 'unknown'])).toEqual([loner.id])
  })
})

describe('selectionBounds', () => {
  it('unions the bounds of the selected elements', () => {
    const { first, second, all } = sampleElements()
    expect(selectionBounds(all, [first.id, second.id])).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 50,
    })
  })

  it('returns null for an empty or unknown selection', () => {
    const { all } = sampleElements()
    expect(selectionBounds(all, [])).toBeNull()
    expect(selectionBounds(all, ['unknown'])).toBeNull()
  })

  it('uses the rotated bounding box', () => {
    const rotated = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 10,
      angle: Math.PI / 2,
    })
    const bounds = selectionBounds([rotated], [rotated.id])
    expect(bounds?.width).toBeCloseTo(10)
    expect(bounds?.height).toBeCloseTo(100)
  })
})

describe('elementsInRect', () => {
  it('catches elements whose bounds intersect the rect', () => {
    const { first, second, loner, all } = sampleElements()
    const caught = elementsInRect(all, { x: 90, y: 0, width: 130, height: 50 })
    expect(caught).toEqual([first.id, second.id])
    expect(
      elementsInRect(all, { x: 300, y: 300, width: 200, height: 200 }),
    ).toEqual([loner.id])
  })
})
