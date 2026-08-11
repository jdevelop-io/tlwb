import { type Canvas, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { MAX_ZOOM } from '../../src/camera'
import { createElement } from '../../src/model/create'
import { createRenderer } from '../../src/render/renderer'
import { InMemoryBoardStore } from '../../src/store/memory'

function harness() {
  const frames: (() => void)[] = []
  const store = new InMemoryBoardStore()
  const canvas = createCanvas(100, 100)
  const renderer = createRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    store,
    width: 100,
    height: 100,
    requestFrame: (callback) => {
      frames.push(callback)
    },
  })
  const flush = () => {
    for (const frame of frames.splice(0)) {
      frame()
    }
  }
  return { canvas, frames, flush, renderer, store }
}

function rgbaAt(canvas: Canvas, x: number, y: number): number[] {
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)
}

const redSquare = () =>
  createElement('rectangle', {
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
  })

describe('createRenderer', () => {
  it('schedules one initial frame and paints the store on flush', () => {
    const { canvas, frames, flush, store } = harness()
    expect(frames).toHaveLength(1)
    store.applyChanges([{ kind: 'create', element: redSquare() }])
    flush()
    expect(rgbaAt(canvas, 50, 50)).toEqual([255, 0, 0, 255])
  })

  it('coalesces store events into a single pending frame', () => {
    const { frames, flush, store } = harness()
    flush()
    store.applyChanges([{ kind: 'create', element: redSquare() }])
    store.applyChanges([{ kind: 'update', id: 'red-1', props: { x: 30 } }])
    store.applyChanges([{ kind: 'update', id: 'red-1', props: { y: 30 } }])
    expect(frames).toHaveLength(1)
    flush()
    store.applyChanges([{ kind: 'update', id: 'red-1', props: { x: 40 } }])
    expect(frames).toHaveLength(1)
  })

  it('clamps the camera zoom', () => {
    const { renderer } = harness()
    renderer.setCamera({ x: 0, y: 0, zoom: 1000 })
    expect(renderer.getCamera().zoom).toBe(MAX_ZOOM)
  })

  it('repaints through the camera on flush', () => {
    const { canvas, flush, renderer, store } = harness()
    store.applyChanges([{ kind: 'create', element: redSquare() }])
    renderer.setCamera({ x: 0, y: 0, zoom: 2 })
    flush()
    expect(rgbaAt(canvas, 80, 80)).toEqual([255, 0, 0, 255])
  })

  it('resizes the canvas backing store on the next flush', () => {
    const { canvas, flush, renderer } = harness()
    flush()
    expect(canvas.width).toBe(100)
    expect(canvas.height).toBe(100)
    renderer.resize(200, 200)
    flush()
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(200)
  })

  it('stops scheduling after destroy', () => {
    const { frames, flush, renderer, store } = harness()
    flush()
    renderer.destroy()
    store.applyChanges([{ kind: 'create', element: redSquare() }])
    renderer.markDirty()
    expect(frames).toHaveLength(0)
  })
})
