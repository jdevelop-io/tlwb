import type { Rect } from './geometry/bounds'
import type { Point } from './model/element'

/** `(x, y)` is the world point rendered at the screen origin. */
export interface Camera {
  x: number
  y: number
  zoom: number
}

/** Viewport size in CSS pixels. */
export interface Viewport {
  width: number
  height: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 64

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 }
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function screenToWorld(camera: Camera, point: Point): Point {
  return {
    x: camera.x + point.x / camera.zoom,
    y: camera.y + point.y / camera.zoom,
  }
}

export function worldToScreen(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  }
}

/** Pans by a screen-space delta, as produced by pointer or wheel events. */
export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    x: camera.x - dx / camera.zoom,
    y: camera.y - dy / camera.zoom,
  }
}

/**
 * Zooms toward `anchor` (screen coordinates): the world point under the
 * anchor stays under it, which is what wheel-zoom and pinch expect.
 */
export function zoomCamera(
  camera: Camera,
  anchor: Point,
  nextZoom: number,
): Camera {
  const zoom = clampZoom(nextZoom)
  const fixed = screenToWorld(camera, anchor)
  return {
    x: fixed.x - anchor.x / zoom,
    y: fixed.y - anchor.y / zoom,
    zoom,
  }
}

export function visibleRect(camera: Camera, viewport: Viewport): Rect {
  return {
    x: camera.x,
    y: camera.y,
    width: viewport.width / camera.zoom,
    height: viewport.height / camera.zoom,
  }
}
