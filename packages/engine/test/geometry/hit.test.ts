import { describe, expect, it } from 'vitest'
import {
  hitTestElement,
  hitTestElementInterior,
  hitTestScene,
  toLocalPoint,
  toWorldPoint,
} from '../../src/geometry/hit'
import { createElement } from '../../src/model/create'

const TOLERANCE = 4

describe('toLocalPoint / toWorldPoint', () => {
  it('round-trips through a rotated frame', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 100,
      y: 100,
      width: 40,
      height: 20,
      angle: Math.PI / 3,
    })
    const world = { x: 117, y: 93 }
    expect(toWorldPoint(element, toLocalPoint(element, world)).x).toBeCloseTo(
      world.x,
    )
    expect(toWorldPoint(element, toLocalPoint(element, world)).y).toBeCloseTo(
      world.y,
    )
  })
})

describe('hitTestElement', () => {
  it('hits a hollow rectangle on its border, not in its middle', () => {
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    })
    expect(hitTestElement(rectangle, { x: 50, y: 1 }, TOLERANCE)).toBe(true)
    expect(hitTestElement(rectangle, { x: 50, y: 40 }, TOLERANCE)).toBe(false)
  })

  it('hits a filled rectangle anywhere inside', () => {
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      fillColor: '#FFD8CF',
    })
    expect(hitTestElement(rectangle, { x: 50, y: 40 }, TOLERANCE)).toBe(true)
  })

  it('misses the bounding-box corner of an ellipse', () => {
    const ellipse = createElement('ellipse', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    expect(hitTestElement(ellipse, { x: 6, y: 6 }, TOLERANCE)).toBe(false)
    expect(hitTestElement(ellipse, { x: 50, y: 2 }, TOLERANCE)).toBe(true)
  })

  it('misses the bounding-box corner of a diamond but hits its edge', () => {
    const diamond = createElement('diamond', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(hitTestElement(diamond, { x: 8, y: 8 }, TOLERANCE)).toBe(false)
    expect(hitTestElement(diamond, { x: 26, y: 26 }, TOLERANCE)).toBe(true)
  })

  it('hits a line near any of its segments', () => {
    const line = createElement('line', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    })
    expect(hitTestElement(line, { x: 102, y: 50 }, TOLERANCE)).toBe(true)
    expect(hitTestElement(line, { x: 50, y: 50 }, TOLERANCE)).toBe(false)
  })

  it('hits text and image anywhere in their box', () => {
    const text = createElement('text', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 60,
      height: 24,
      text: 'hello',
    })
    expect(hitTestElement(text, { x: 30, y: 12 }, TOLERANCE)).toBe(true)
    expect(hitTestElement(text, { x: 30, y: 40 }, TOLERANCE)).toBe(false)
  })

  it('respects rotation', () => {
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 10,
      angle: Math.PI / 2,
    })
    // Rotated 90 degrees around (50, 5): now spans x in [45, 55], y in [-45, 55].
    expect(hitTestElement(rectangle, { x: 50, y: -40 }, TOLERANCE)).toBe(true)
    expect(hitTestElement(rectangle, { x: 5, y: 5 }, TOLERANCE)).toBe(false)
  })
})

describe('hitTestElementInterior', () => {
  it('treats hollow shapes as filled', () => {
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    })
    expect(hitTestElementInterior(rectangle, { x: 50, y: 40 }, TOLERANCE)).toBe(
      true,
    )
    expect(
      hitTestElementInterior(rectangle, { x: 120, y: 40 }, TOLERANCE),
    ).toBe(false)
  })
})

describe('hitTestScene', () => {
  it('returns the topmost hit and skips invisible elements', () => {
    const back = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    const front = createElement('rectangle', {
      index: 'a1',
      x: 25,
      y: 25,
      width: 50,
      height: 50,
      fillColor: '#D9F2E5',
    })
    const invisible = createElement('rectangle', {
      index: 'a2',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFF9C9',
      opacity: 0,
    })
    const elements = [back, front, invisible]
    expect(hitTestScene(elements, { x: 50, y: 50 }, TOLERANCE)?.id).toBe(
      front.id,
    )
    expect(hitTestScene(elements, { x: 5, y: 5 }, TOLERANCE)?.id).toBe(back.id)
    expect(hitTestScene(elements, { x: 200, y: 200 }, TOLERANCE)).toBeNull()
  })
})
