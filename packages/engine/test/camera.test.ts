import { describe, expect, it } from 'vitest'
import {
  clampZoom,
  createCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  panCamera,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomCamera,
} from '../src/camera'

describe('clampZoom', () => {
  it('clamps to the 10 percent to 6400 percent range', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(2)).toBe(2)
  })
})

describe('coordinate transforms', () => {
  it('round-trips between screen and world', () => {
    const camera = { x: 100, y: 50, zoom: 2 }
    const screen = { x: 30, y: 40 }
    expect(worldToScreen(camera, screenToWorld(camera, screen))).toEqual(screen)
  })

  it('maps the camera position to the screen origin', () => {
    const camera = { x: 100, y: 50, zoom: 2 }
    expect(worldToScreen(camera, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 })
  })
})

describe('panCamera', () => {
  it('moves the world opposite to the screen drag, scaled by zoom', () => {
    const camera = panCamera({ x: 0, y: 0, zoom: 2 }, 10, -20)
    expect(camera).toEqual({ x: -5, y: 10, zoom: 2 })
  })
})

describe('zoomCamera', () => {
  it('keeps the world point under the anchor fixed', () => {
    const camera = createCamera()
    const anchor = { x: 200, y: 150 }
    const before = screenToWorld(camera, anchor)
    const zoomed = zoomCamera(camera, anchor, 4)
    expect(zoomed.zoom).toBe(4)
    const after = screenToWorld(zoomed, anchor)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('clamps the requested zoom', () => {
    expect(zoomCamera(createCamera(), { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM)
  })
})

describe('visibleRect', () => {
  it('converts the viewport to world coordinates', () => {
    expect(
      visibleRect({ x: 100, y: 50, zoom: 2 }, { width: 800, height: 600 }),
    ).toEqual({ x: 100, y: 50, width: 400, height: 300 })
  })
})
