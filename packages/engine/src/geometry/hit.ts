import type { BoardElement, Point } from '../model/element'
import { distanceToSegment, pointInPolygon } from './points'

/** Maps a world point into the element's unrotated local frame. */
export function toLocalPoint(element: BoardElement, point: Point): Point {
  if (element.angle === 0) {
    return { x: point.x - element.x, y: point.y - element.y }
  }
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const cos = Math.cos(-element.angle)
  const sin = Math.sin(-element.angle)
  const dx = point.x - centerX
  const dy = point.y - centerY
  return {
    x: centerX + dx * cos - dy * sin - element.x,
    y: centerY + dx * sin + dy * cos - element.y,
  }
}

/** Maps a point in the element's unrotated local frame back to world. */
export function toWorldPoint(element: BoardElement, local: Point): Point {
  if (element.angle === 0) {
    return { x: element.x + local.x, y: element.y + local.y }
  }
  const centerX = element.width / 2
  const centerY = element.height / 2
  const cos = Math.cos(element.angle)
  const sin = Math.sin(element.angle)
  const dx = local.x - centerX
  const dy = local.y - centerY
  return {
    x: element.x + centerX + dx * cos - dy * sin,
    y: element.y + centerY + dx * sin + dy * cos,
  }
}

/**
 * Local-frame diamond outline of an element, in vertex order. Exported
 * because `src/model/bindings.ts` needs the same outline to route arrow
 * endpoints around a diamond; keeping a single definition avoids the two
 * modules drifting apart.
 */
export function diamondPolygon(element: BoardElement): Point[] {
  const { width, height } = element
  return [
    { x: width / 2, y: 0 },
    { x: width, y: height / 2 },
    { x: width / 2, y: height },
    { x: 0, y: height / 2 },
  ]
}

function withinBox(
  local: Point,
  width: number,
  height: number,
  pad: number,
): boolean {
  return (
    local.x >= -pad &&
    local.x <= width + pad &&
    local.y >= -pad &&
    local.y <= height + pad
  )
}

function hitPolyline(
  points: readonly Point[],
  local: Point,
  pad: number,
): boolean {
  if (points.length === 0) {
    return false
  }
  if (points.length === 1) {
    const only = points[0] as Point
    return distanceToSegment(local, only, only) <= pad
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i] as Point
    const b = points[i + 1] as Point
    if (distanceToSegment(local, a, b) <= pad) {
      return true
    }
  }
  return false
}

function hitEllipse(
  element: BoardElement,
  local: Point,
  pad: number,
  interior: boolean,
): boolean {
  const rx = element.width / 2
  const ry = element.height / 2
  if (rx <= 0 || ry <= 0) {
    return false
  }
  const dx = local.x - rx
  const dy = local.y - ry
  const outer = (dx / (rx + pad)) ** 2 + (dy / (ry + pad)) ** 2
  if (outer > 1) {
    return false
  }
  if (interior || element.fillColor !== null) {
    return true
  }
  const innerRx = rx - pad
  const innerRy = ry - pad
  if (innerRx <= 0 || innerRy <= 0) {
    return true
  }
  return (dx / innerRx) ** 2 + (dy / innerRy) ** 2 >= 1
}

function hitShape(
  element: BoardElement,
  local: Point,
  pad: number,
  interior: boolean,
): boolean {
  switch (element.type) {
    case 'rectangle': {
      if (!withinBox(local, element.width, element.height, pad)) {
        return false
      }
      if (interior || element.fillColor !== null) {
        return true
      }
      const insideInner =
        local.x > pad &&
        local.x < element.width - pad &&
        local.y > pad &&
        local.y < element.height - pad
      return !insideInner
    }
    case 'ellipse':
      return hitEllipse(element, local, pad, interior)
    case 'diamond': {
      const polygon = diamondPolygon(element)
      if (
        (interior || element.fillColor !== null) &&
        pointInPolygon(local, polygon)
      ) {
        return true
      }
      return hitPolyline([...polygon, polygon[0] as Point], local, pad)
    }
    default:
      return false
  }
}

function hitTest(
  element: BoardElement,
  point: Point,
  tolerance: number,
  interior: boolean,
): boolean {
  const local = toLocalPoint(element, point)
  const pad = tolerance + element.strokeWidth / 2
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
      return hitShape(element, local, pad, interior)
    case 'line':
    case 'arrow':
    case 'draw':
      return hitPolyline(element.points, local, pad)
    case 'text':
    case 'image':
      return withinBox(local, element.width, element.height, tolerance)
  }
}

/**
 * True when the point touches the element as drawn: the outline (within
 * `tolerance` plus half the stroke width) for hollow shapes, anywhere
 * inside for filled shapes, near any segment for linear elements, and
 * anywhere in the box for text and images. `tolerance` is in world
 * units; callers divide a screen-space constant by the camera zoom.
 */
export function hitTestElement(
  element: BoardElement,
  point: Point,
  tolerance: number,
): boolean {
  return hitTest(element, point, tolerance, false)
}

/** Same as hitTestElement, but hollow shapes count as filled. */
export function hitTestElementInterior(
  element: BoardElement,
  point: Point,
  tolerance: number,
): boolean {
  return hitTest(element, point, tolerance, true)
}

/**
 * Topmost hit in a scene sorted back to front, as
 * `BoardStore.listElements()` returns it. Invisible elements
 * (`opacity === 0`) are not hittable.
 */
export function hitTestScene(
  elements: readonly BoardElement[],
  point: Point,
  tolerance: number,
): BoardElement | null {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i] as BoardElement
    if (element.opacity === 0) {
      continue
    }
    if (hitTestElement(element, point, tolerance)) {
      return element
    }
  }
  return null
}
