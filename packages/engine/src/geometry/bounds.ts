import type { BoardElement } from '../model/element'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

export function expandRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  }
}

/**
 * Axis-aligned bounding box of the element's rotated frame. Linear
 * elements keep `width`/`height` enclosing their points, so the frame
 * alone is enough for culling.
 */
export function getElementBounds(element: BoardElement): Rect {
  const { x, y, width, height, angle } = element
  if (angle === 0) {
    return { x, y, width, height }
  }
  const centerX = x + width / 2
  const centerY = y + height / 2
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const rotatedWidth = width * cos + height * sin
  const rotatedHeight = width * sin + height * cos
  return {
    x: centerX - rotatedWidth / 2,
    y: centerY - rotatedHeight / 2,
    width: rotatedWidth,
    height: rotatedHeight,
  }
}
