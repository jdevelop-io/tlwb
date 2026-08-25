import { type Canvas, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { createCamera } from '../../src/camera'
import { getHandles } from '../../src/geometry/transform'
import type { InteractionSnapshot } from '../../src/interaction/controller'
import { createElement } from '../../src/model/create'
import type { BoardElement } from '../../src/model/element'
import type { Peer } from '../../src/presence'
import { renderOverlay } from '../../src/render/overlay'
import { selectionBounds } from '../../src/selection'

const SIZE = 200

function square(): BoardElement {
  return createElement('rectangle', {
    id: 'sq',
    index: 'a0',
    seed: 1,
    x: 50,
    y: 50,
    width: 100,
    height: 100,
  })
}

function snapshotFor(
  elements: BoardElement[],
  selectedIds: string[],
  partial: Partial<InteractionSnapshot> = {},
): InteractionSnapshot {
  const bounds = selectionBounds(elements, selectedIds)
  return {
    activeTool: 'select',
    selectedIds,
    selectionBounds: bounds,
    handles: bounds ? getHandles(bounds, 1) : [],
    gesture: 'idle',
    lasso: null,
    guides: [],
    ...partial,
  }
}

function paint(
  elements: BoardElement[],
  snapshot: InteractionSnapshot,
): Canvas {
  const canvas = createCanvas(SIZE, SIZE)
  renderOverlay(canvas as unknown as HTMLCanvasElement, {
    elements,
    snapshot,
    camera: createCamera(),
    viewport: { width: SIZE, height: SIZE },
  })
  return canvas
}

function rgbaAt(
  canvas: Canvas,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const [r, g, b, a] = canvas.getContext('2d').getImageData(x, y, 1, 1).data
  return [r, g, b, a] as [number, number, number, number]
}

describe('renderOverlay', () => {
  it('paints nothing for an empty selection', () => {
    const canvas = paint([square()], snapshotFor([square()], []))
    expect(rgbaAt(canvas, 50, 100)[3]).toBe(0)
    expect(rgbaAt(canvas, 100, 100)[3]).toBe(0)
  })

  it('outlines the selected element and fills its handles white', () => {
    const elements = [square()]
    const canvas = paint(elements, snapshotFor(elements, ['sq']))
    expect(rgbaAt(canvas, 50, 100)[3]).toBeGreaterThan(0)
    expect(rgbaAt(canvas, 100, 100)[3]).toBe(0)
    expect(rgbaAt(canvas, 50, 50)).toEqual([255, 255, 255, 255])
    expect(rgbaAt(canvas, 100, 150)).toEqual([255, 255, 255, 255])
  })

  it('hides the handles while the selection moves', () => {
    const elements = [square()]
    const canvas = paint(
      elements,
      snapshotFor(elements, ['sq'], { gesture: 'moving' }),
    )
    expect(rgbaAt(canvas, 50, 50)).not.toEqual([255, 255, 255, 255])
    expect(rgbaAt(canvas, 50, 100)[3]).toBeGreaterThan(0)
  })

  it('fills the lasso rectangle translucently', () => {
    const canvas = paint(
      [],
      snapshotFor([], [], {
        gesture: 'lasso',
        lasso: { x: 20, y: 20, width: 60, height: 60 },
      }),
    )
    const inside = rgbaAt(canvas, 50, 50)
    expect(inside[3]).toBeGreaterThan(0)
    expect(inside[3]).toBeLessThan(255)
    expect(rgbaAt(canvas, 150, 150)[3]).toBe(0)
  })

  it('draws snap guides across the whole viewport', () => {
    const canvas = paint(
      [],
      snapshotFor([], [], {
        guides: [
          { orientation: 'vertical', position: 120 },
          { orientation: 'horizontal', position: 30 },
        ],
      }),
    )
    expect(rgbaAt(canvas, 120, 5)[3]).toBeGreaterThan(0)
    expect(rgbaAt(canvas, 120, 195)[3]).toBeGreaterThan(0)
    expect(rgbaAt(canvas, 5, 30)[3]).toBeGreaterThan(0)
    expect(rgbaAt(canvas, 60, 100)[3]).toBe(0)
  })

  it('projects through the camera', () => {
    const elements = [square()]
    const canvas = createCanvas(SIZE, SIZE)
    renderOverlay(canvas as unknown as HTMLCanvasElement, {
      elements,
      snapshot: snapshotFor(elements, ['sq']),
      camera: { x: 50, y: 50, zoom: 1 },
      viewport: { width: SIZE, height: SIZE },
    })
    expect(rgbaAt(canvas, 0, 0)).toEqual([255, 255, 255, 255])
  })
})

function peer(partial: Partial<Peer> = {}): Peer {
  return {
    id: 'p1',
    name: 'Ada',
    color: '#00AA00',
    cursor: { x: 100, y: 100 },
    selectedIds: [],
    isAgent: false,
    ...partial,
  }
}

function paintPeers(elements: BoardElement[], peers: Peer[]): Canvas {
  const canvas = createCanvas(SIZE, SIZE)
  renderOverlay(canvas as unknown as HTMLCanvasElement, {
    elements,
    snapshot: snapshotFor(elements, []),
    camera: createCamera(),
    viewport: { width: SIZE, height: SIZE },
    peers,
  })
  return canvas
}

describe('renderOverlay presence', () => {
  it('paints a cursor in the peer color at the projected position', () => {
    const canvas = paintPeers([], [peer()])
    expect(rgbaAt(canvas, 102, 108)).toEqual([0, 170, 0, 255])
    expect(rgbaAt(canvas, 60, 60)[3]).toBe(0)
  })

  it('paints nothing for a peer without a cursor', () => {
    const canvas = paintPeers([], [peer({ cursor: null })])
    expect(rgbaAt(canvas, 102, 108)[3]).toBe(0)
  })

  it('outlines the elements a peer selected in the peer color', () => {
    const canvas = paintPeers([square()], [peer({ selectedIds: ['sq'] })])
    const edge = rgbaAt(canvas, 50, 100)
    expect(edge[3]).toBeGreaterThan(0)
    expect(edge[1]).toBeGreaterThan(edge[0])
  })

  it('paints a label wider for an agent, which carries the badge', () => {
    const human = paintPeers([], [peer()])
    const agent = paintPeers([], [peer({ isAgent: true })])
    const painted = (canvas: Canvas): number => {
      const data = canvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data
      let count = 0
      for (let i = 3; i < data.length; i += 4) {
        if ((data[i] as number) > 0) {
          count += 1
        }
      }
      return count
    }
    expect(painted(agent)).toBeGreaterThan(painted(human))
  })
})
