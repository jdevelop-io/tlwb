import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { ArrowElement, RectangleElement } from '../../src/model/element'
import { getShapeDrawables } from '../../src/render/shapes'

function rectangle(overrides = {}): RectangleElement {
  return createElement('rectangle', {
    id: 'rect-1',
    index: 'a0',
    seed: 42,
    width: 100,
    height: 60,
    ...overrides,
  }) as RectangleElement
}

describe('getShapeDrawables', () => {
  it('is deterministic for identical elements', () => {
    const first = getShapeDrawables(rectangle())
    const second = getShapeDrawables(rectangle())
    expect(JSON.parse(JSON.stringify(second))).toEqual(
      JSON.parse(JSON.stringify(first)),
    )
  })

  it('returns the cached array for the same element object', () => {
    const element = rectangle()
    expect(getShapeDrawables(element)).toBe(getShapeDrawables(element))
  })

  it('changes output when the seed changes', () => {
    const first = getShapeDrawables(rectangle({ seed: 1 }))
    const second = getShapeDrawables(rectangle({ seed: 2 }))
    expect(JSON.stringify(second)).not.toEqual(JSON.stringify(first))
  })

  it('never passes the randomizing seed 0 to rough.js', () => {
    const drawable = getShapeDrawables(rectangle({ seed: 0 }))[0]
    expect(drawable?.options.seed).toBe(1)
  })

  it('maps stroke style and solid fill onto rough options', () => {
    const drawable = getShapeDrawables(
      rectangle({ strokeStyle: 'dashed', fillColor: '#FADDD8' }),
    )[0]
    expect(drawable?.options.strokeLineDash).toEqual([8, 8])
    expect(drawable?.options.fill).toBe('#FADDD8')
    expect(drawable?.options.fillStyle).toBe('solid')
  })

  it('adds an arrowhead at the tip of an arrow', () => {
    const arrow = createElement('arrow', {
      id: 'arrow-1',
      index: 'a0',
      seed: 7,
      width: 100,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    }) as ArrowElement
    // Shaft plus two arrowhead wings.
    expect(getShapeDrawables(arrow)).toHaveLength(3)
  })

  it('returns no drawables for an arrow without enough points', () => {
    const arrow = createElement('arrow', {
      id: 'arrow-2',
      index: 'a0',
      seed: 7,
    }) as ArrowElement
    expect(getShapeDrawables(arrow)).toHaveLength(0)
  })
})
