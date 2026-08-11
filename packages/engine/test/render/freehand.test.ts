import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { DrawElement, Point } from '../../src/model/element'
import { getFreehandPath } from '../../src/render/freehand'

function draw(points: Point[]): DrawElement {
  return createElement('draw', {
    id: 'draw-1',
    index: 'a0',
    seed: 9,
    points,
  }) as DrawElement
}

const wave: Point[] = Array.from({ length: 20 }, (_, i) => ({
  x: i * 10,
  y: Math.sin(i / 3) * 40,
}))

describe('getFreehandPath', () => {
  it('returns an empty path for an element without points', () => {
    expect(getFreehandPath(draw([]))).toBe('')
  })

  it('returns a closed path', () => {
    const path = getFreehandPath(draw(wave))
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('is deterministic for identical elements', () => {
    expect(getFreehandPath(draw(wave))).toBe(getFreehandPath(draw(wave)))
  })

  it('caches per element object', () => {
    const element = draw(wave)
    const first = getFreehandPath(element)
    expect(getFreehandPath(element)).toBe(first)
  })
})
