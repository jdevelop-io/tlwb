import { type Canvas, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { createCamera } from '../../src/camera'
import { createElement } from '../../src/model/create'
import type { BoardElement } from '../../src/model/element'
import { renderScene } from '../../src/render/scene'

const VIEWPORT = { width: 100, height: 100 }

function render(
  elements: BoardElement[],
  overrides: Record<string, unknown> = {},
): Canvas {
  const canvas = createCanvas(100, 100)
  renderScene(canvas as unknown as HTMLCanvasElement, {
    elements,
    camera: createCamera(),
    viewport: VIEWPORT,
    ...overrides,
  })
  return canvas
}

function rgbaAt(canvas: Canvas, x: number, y: number): number[] {
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)
}

function redSquare(overrides: Record<string, unknown> = {}): BoardElement {
  return createElement('rectangle', {
    id: 'red-1',
    index: 'a0',
    seed: 5,
    x: 20,
    y: 20,
    width: 60,
    height: 60,
    strokeColor: '#FF0000',
    fillColor: '#FF0000',
    sketchiness: 0,
    ...overrides,
  })
}

describe('renderScene', () => {
  it('paints the background on an empty scene', () => {
    expect(rgbaAt(render([]), 50, 50)).toEqual([255, 255, 255, 255])
  })

  it('paints a filled shape', () => {
    expect(rgbaAt(render([redSquare()]), 50, 50)).toEqual([255, 0, 0, 255])
  })

  it('skips fully transparent elements', () => {
    expect(rgbaAt(render([redSquare({ opacity: 0 })]), 50, 50)).toEqual([
      255, 255, 255, 255,
    ])
  })

  it('applies the camera transform', () => {
    const canvas = render([redSquare()], {
      camera: { x: 0, y: 0, zoom: 2 },
    })
    // World (40, 40) is inside the square and lands on screen (80, 80).
    expect(rgbaAt(canvas, 80, 80)).toEqual([255, 0, 0, 255])
    // World (60, 60) lands outside the 100px viewport; screen (10, 10)
    // shows world (5, 5), which is background.
    expect(rgbaAt(canvas, 10, 10)).toEqual([255, 255, 255, 255])
  })

  it('sizes the backing store from the device pixel ratio', () => {
    const canvas = render([], { devicePixelRatio: 2 })
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(200)
  })

  it('culls elements outside the viewport without touching them', () => {
    const resolved: string[] = []
    const resolveImage = (assetHash: string) => {
      resolved.push(assetHash)
      return null
    }
    const inside = createElement('image', {
      id: 'img-in',
      index: 'a0',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      assetHash: 'inside',
    })
    const outside = createElement('image', {
      id: 'img-out',
      index: 'a1',
      x: 5000,
      y: 5000,
      width: 20,
      height: 20,
      assetHash: 'outside',
    })
    render([inside, outside], { resolveImage })
    expect(resolved).toEqual(['inside'])
  })

  it('paints a placeholder for unresolved images', () => {
    const image = createElement('image', {
      id: 'img-1',
      index: 'a0',
      x: 20,
      y: 20,
      width: 60,
      height: 60,
      assetHash: 'missing',
    })
    // #F7F7F5 placeholder fill.
    expect(rgbaAt(render([image]), 50, 50)).toEqual([247, 247, 245, 255])
  })

  it('draws resolved images', () => {
    const blue = createCanvas(20, 20)
    const blueCtx = blue.getContext('2d')
    blueCtx.fillStyle = '#0000FF'
    blueCtx.fillRect(0, 0, 20, 20)
    const image = createElement('image', {
      id: 'img-2',
      index: 'a0',
      x: 20,
      y: 20,
      width: 60,
      height: 60,
      assetHash: 'blue',
    })
    const canvas = render([image], {
      resolveImage: () => blue as unknown as CanvasImageSource,
    })
    expect(rgbaAt(canvas, 50, 50)).toEqual([0, 0, 255, 255])
  })

  it('clears stale pixels before painting a non-opaque background', () => {
    const canvas = createCanvas(100, 100)
    renderScene(canvas as unknown as HTMLCanvasElement, {
      elements: [redSquare()],
      camera: createCamera(),
      viewport: VIEWPORT,
    })
    expect(rgbaAt(canvas, 50, 50)).toEqual([255, 0, 0, 255])
    renderScene(canvas as unknown as HTMLCanvasElement, {
      elements: [],
      camera: createCamera(),
      viewport: VIEWPORT,
      background: 'rgba(0,0,0,0)',
    })
    expect(rgbaAt(canvas, 50, 50)).toEqual([0, 0, 0, 0])
  })

  it('paints a custom opaque background', () => {
    expect(rgbaAt(render([], { background: '#0000FF' }), 50, 50)).toEqual([
      0, 0, 255, 255,
    ])
  })

  it('fills free drawing strokes', () => {
    const draw = createElement('draw', {
      id: 'draw-1',
      index: 'a0',
      seed: 3,
      x: 10,
      y: 50,
      width: 80,
      height: 0,
      strokeColor: '#FF0000',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 80, y: 0 },
      ],
    })
    // The stroke passes through world (50, 50) with a 4px half-width.
    expect(rgbaAt(render([draw]), 50, 50)).toEqual([255, 0, 0, 255])
  })
})
