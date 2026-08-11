import { describe, expect, it } from 'vitest'
import {
  getHandles,
  hitTestHandles,
  resizeRect,
  rotationAngle,
  scaleElement,
} from '../../src/geometry/transform'
import { createElement } from '../../src/model/create'
import type { LineElement, TextElement } from '../../src/model/element'

const bounds = { x: 100, y: 100, width: 200, height: 100 }

describe('getHandles', () => {
  it('places corners, edge midpoints, and the rotate handle', () => {
    const handles = getHandles(bounds, 1)
    const byKind = new Map(handles.map((handle) => [handle.kind, handle]))
    expect(handles).toHaveLength(9)
    expect(byKind.get('nw')).toMatchObject({ x: 100, y: 100 })
    expect(byKind.get('se')).toMatchObject({ x: 300, y: 200 })
    expect(byKind.get('e')).toMatchObject({ x: 300, y: 150 })
    expect(byKind.get('rotate')).toMatchObject({ x: 200, y: 76 })
  })

  it('keeps the rotate offset screen-fixed', () => {
    const handles = getHandles(bounds, 2)
    const rotate = handles.find((handle) => handle.kind === 'rotate')
    expect(rotate?.y).toBe(88)
  })
})

describe('hitTestHandles', () => {
  it('hits within a screen-fixed radius and misses beyond it', () => {
    const handles = getHandles(bounds, 1)
    expect(hitTestHandles(handles, { x: 302, y: 197 }, 1)).toBe('se')
    expect(hitTestHandles(handles, { x: 320, y: 220 }, 1)).toBeNull()
  })

  it('scales the radius with zoom', () => {
    const handles = getHandles(bounds, 4)
    expect(hitTestHandles(handles, { x: 303, y: 200 }, 4)).toBeNull()
    expect(hitTestHandles(handles, { x: 301, y: 200 }, 4)).toBe('se')
  })
})

describe('resizeRect', () => {
  it('moves only the edges the handle owns', () => {
    expect(resizeRect(bounds, 'se', { x: 20, y: 10 }, false)).toEqual({
      x: 100,
      y: 100,
      width: 220,
      height: 110,
    })
    expect(resizeRect(bounds, 'n', { x: 999, y: 10 }, false)).toEqual({
      x: 100,
      y: 110,
      width: 200,
      height: 90,
    })
  })

  it('normalizes when dragged past the opposite edge', () => {
    expect(resizeRect(bounds, 'e', { x: -250, y: 0 }, false)).toEqual({
      x: 50,
      y: 100,
      width: 50,
      height: 100,
    })
  })

  it('locks the aspect ratio from a corner, anchored opposite', () => {
    const resized = resizeRect(bounds, 'se', { x: 200, y: 0 }, true)
    expect(resized).toEqual({ x: 100, y: 100, width: 400, height: 200 })
  })
})

describe('scaleElement', () => {
  it('maps the frame proportionally into the new rect', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 150,
      y: 100,
      width: 100,
      height: 50,
    })
    const to = { x: 100, y: 100, width: 400, height: 200 }
    expect(scaleElement(element, bounds, to)).toMatchObject({
      x: 200,
      y: 100,
      width: 200,
      height: 100,
    })
  })

  it('scales points and font size', () => {
    const line = createElement('line', {
      index: 'a0',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 100 },
      ],
    }) as LineElement
    const text = createElement('text', {
      index: 'a1',
      x: 100,
      y: 100,
      width: 60,
      height: 24,
      text: 'hi',
      fontSize: 20,
    }) as TextElement
    const to = { x: 0, y: 0, width: 100, height: 50 }
    const lineProps = scaleElement(line, bounds, to)
    expect(lineProps.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ])
    const textProps = scaleElement(text, bounds, to)
    expect(textProps.fontSize).toBe(10)
  })
})

describe('rotationAngle', () => {
  it('is zero straight above and a quarter turn to the right', () => {
    const center = { x: 0, y: 0 }
    expect(rotationAngle(center, { x: 0, y: -10 }, false)).toBeCloseTo(0)
    expect(rotationAngle(center, { x: 10, y: 0 }, false)).toBeCloseTo(
      Math.PI / 2,
    )
  })

  it('snaps to 15-degree steps when asked', () => {
    const center = { x: 0, y: 0 }
    const loose = rotationAngle(center, { x: 3, y: -10 }, false)
    const snapped = rotationAngle(center, { x: 3, y: -10 }, true)
    expect(loose).not.toBeCloseTo(snapped)
    expect(snapped).toBeCloseTo(Math.PI / 12)
  })
})
