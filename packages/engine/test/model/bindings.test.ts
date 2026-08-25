import { describe, expect, it } from 'vitest'
import {
  applyWithBindings,
  attachmentPoint,
  boundArrowUpdates,
  boundLabelUpdates,
  findBindTarget,
  isBindable,
  labelFrame,
} from '../../src/model/bindings'
import { createElement } from '../../src/model/create'
import type {
  ArrowElement,
  EllipseElement,
  Point,
  RectangleElement,
} from '../../src/model/element'
import { InMemoryBoardStore } from '../../src/store/memory'

const TOLERANCE = 12

describe('isBindable / findBindTarget', () => {
  it('only shapes are bindable', () => {
    expect(isBindable(createElement('rectangle', { index: 'a0' }))).toBe(true)
    expect(isBindable(createElement('ellipse', { index: 'a0' }))).toBe(true)
    expect(isBindable(createElement('diamond', { index: 'a0' }))).toBe(true)
    expect(isBindable(createElement('text', { index: 'a0' }))).toBe(false)
    expect(isBindable(createElement('draw', { index: 'a0' }))).toBe(false)
  })

  it('finds the topmost bindable shape near a point', () => {
    const back = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    const front = createElement('ellipse', {
      index: 'a1',
      x: 40,
      y: 40,
      width: 100,
      height: 100,
    })
    const text = createElement('text', {
      index: 'a2',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      text: 'not me',
    })
    const elements = [back, front, text]
    expect(findBindTarget(elements, { x: 90, y: 90 }, TOLERANCE)?.id).toBe(
      front.id,
    )
    expect(findBindTarget(elements, { x: 5, y: 5 }, TOLERANCE)?.id).toBe(
      back.id,
    )
    expect(findBindTarget(elements, { x: 300, y: 300 }, TOLERANCE)).toBeNull()
  })

  it('honors the exclusion set', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(
      findBindTarget([shape], { x: 50, y: 50 }, TOLERANCE, new Set([shape.id])),
    ).toBeNull()
  })
})

describe('attachmentPoint', () => {
  it('lands on a rectangle edge toward the source point', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }) as RectangleElement
    const point = attachmentPoint(shape, { x: 200, y: 50 })
    expect(point.x).toBeCloseTo(100)
    expect(point.y).toBeCloseTo(50)
  })

  it('lands on the ellipse outline along the direction', () => {
    const shape = createElement('ellipse', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    }) as EllipseElement
    const point = attachmentPoint(shape, { x: 50, y: 200 })
    expect(point.x).toBeCloseTo(50)
    expect(point.y).toBeCloseTo(50)
  })

  it('falls back to the source point when it is inside the shape', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }) as RectangleElement
    expect(attachmentPoint(shape, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 })
  })
})

describe('boundArrowUpdates', () => {
  function scene() {
    const left = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    const right = createElement('rectangle', {
      index: 'a1',
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    })
    const arrow = createElement('arrow', {
      index: 'a2',
      x: 100,
      y: 50,
      width: 200,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      startBinding: { elementId: left.id },
      endBinding: { elementId: right.id },
    }) as ArrowElement
    return { left, right, arrow }
  }

  it('re-anchors arrows bound to a moved shape', () => {
    const { left, right, arrow } = scene()
    const movedLeft = { ...left, y: 200 } as typeof left
    const elements = [movedLeft, right, arrow]
    const updates = boundArrowUpdates(elements, new Set([movedLeft.id]))
    expect(updates).toHaveLength(1)
    const props = (updates[0] as { props: Record<string, unknown> }).props
    const points = props.points as Point[]
    const x = props.x as number
    const y = props.y as number
    const worldStart = {
      x: x + (points[0] as Point).x,
      y: y + (points[0] as Point).y,
    }
    const worldEnd = {
      x: x + (points[1] as Point).x,
      y: y + (points[1] as Point).y,
    }
    // Start sits on the moved shape's outline, end on the other shape's.
    expect(worldStart.x).toBeGreaterThanOrEqual(0)
    expect(worldStart.x).toBeLessThanOrEqual(100)
    expect(worldStart.y).toBeGreaterThanOrEqual(200)
    expect(worldStart.y).toBeLessThanOrEqual(300)
    expect(worldEnd.x).toBeCloseTo(300)
  })

  it('leaves unbound arrows and moved arrows alone', () => {
    const { left, right, arrow } = scene()
    const elements = [left, right, arrow]
    expect(boundArrowUpdates(elements, new Set([arrow.id]))).toEqual([])
    const free = createElement('arrow', {
      index: 'a3',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    })
    expect(boundArrowUpdates([left, right, free], new Set([left.id]))).toEqual(
      [],
    )
  })
})

describe('labelFrame', () => {
  it('centers the label in the container and copies its angle', () => {
    const container = createElement('rectangle', {
      index: 'a0',
      x: 100,
      y: 50,
      width: 200,
      height: 100,
      angle: Math.PI / 4,
    })
    expect(labelFrame(container, { width: 40, height: 20 })).toEqual({
      x: 180,
      y: 90,
      angle: Math.PI / 4,
    })
  })
})

describe('boundLabelUpdates', () => {
  const scene = () => {
    const container = createElement('ellipse', {
      id: 'shape',
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    })
    const label = createElement('text', {
      id: 'label',
      index: 'a1',
      x: 30,
      y: 20,
      width: 40,
      height: 20,
      text: 'hi',
      containerId: 'shape',
    })
    const loose = createElement('text', {
      id: 'loose',
      index: 'a2',
      x: 500,
      y: 500,
      width: 40,
      height: 20,
      text: 'free',
    })
    return [container, label, loose] as const
  }

  it('recenters the label when its container moved', () => {
    const [container, label, loose] = scene()
    const moved = {
      ...container,
      x: 200,
      y: 100,
      angle: 0.5,
    } as typeof container
    const updates = boundLabelUpdates([moved, label, loose], new Set(['shape']))
    expect(updates).toEqual([
      { kind: 'update', id: 'label', props: { x: 230, y: 120, angle: 0.5 } },
    ])
  })

  it('leaves a label alone when it moved with its container', () => {
    const elements = scene()
    expect(boundLabelUpdates(elements, new Set(['shape', 'label']))).toEqual([])
  })

  it('ignores text without a container and containers that did not move', () => {
    const elements = scene()
    expect(boundLabelUpdates(elements, new Set(['loose']))).toEqual([])
    expect(boundLabelUpdates(elements, new Set(['label']))).toEqual([])
  })
})

describe('applyWithBindings', () => {
  it('moves the label and re-anchors the arrow in the same second batch', () => {
    const store = new InMemoryBoardStore()
    const shape = createElement('rectangle', {
      id: 'shape',
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    const label = createElement('text', {
      id: 'label',
      index: 'a1',
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      text: 'a',
      containerId: 'shape',
    })
    const arrow = createElement('arrow', {
      id: 'arrow',
      index: 'a2',
      x: 100,
      y: 50,
      width: 100,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      startBinding: { elementId: 'shape' },
      endBinding: null,
    })
    store.applyChanges([
      { kind: 'create', element: shape },
      { kind: 'create', element: label },
      { kind: 'create', element: arrow },
    ])
    const batches: number[] = []
    store.subscribe((event) => {
      if (event.kind === 'changes') {
        batches.push(event.changes.length)
      }
    })
    applyWithBindings(
      store,
      [{ kind: 'update', id: 'shape', props: { x: 300 } }],
      new Set(['shape']),
    )
    expect(batches).toEqual([1, 2])
    expect(store.getElement('label')).toMatchObject({ x: 340, y: 40 })
    // The tail re-anchors on the moved shape's left edge (x = 300); the
    // arrow frame is normalized around its points.
    const moved = store.getElement('arrow') as ArrowElement
    expect(moved.x + (moved.points[0] as Point).x).toBe(300)
  })
})
