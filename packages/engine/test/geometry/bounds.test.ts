import { describe, expect, it } from 'vitest'
import {
  expandRect,
  getElementBounds,
  rectsIntersect,
} from '../../src/geometry/bounds'
import { createElement } from '../../src/model/create'

describe('rectsIntersect', () => {
  it('detects overlap and separation', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(rectsIntersect(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
    expect(rectsIntersect(a, { x: 20, y: 0, width: 5, height: 5 })).toBe(false)
  })

  it('treats touching edges as separate', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(rectsIntersect(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false)
  })
})

describe('expandRect', () => {
  it('grows the rect on every side', () => {
    expect(expandRect({ x: 10, y: 20, width: 30, height: 40 }, 5)).toEqual({
      x: 5,
      y: 15,
      width: 40,
      height: 50,
    })
  })
})

describe('getElementBounds', () => {
  it('returns the frame of an unrotated element', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
    expect(getElementBounds(element)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
  })

  it('swaps extents for a quarter turn around the center', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      angle: Math.PI / 2,
    })
    const bounds = getElementBounds(element)
    expect(bounds.x).toBeCloseTo(50)
    expect(bounds.y).toBeCloseTo(-50)
    expect(bounds.width).toBeCloseTo(100)
    expect(bounds.height).toBeCloseTo(200)
  })
})
