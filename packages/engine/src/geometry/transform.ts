import type { BoardElement, ElementProps, Point } from '../model/element'
import type { Rect } from './bounds'

export type HandleKind =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rotate'

export type ResizeHandleKind = Exclude<HandleKind, 'rotate'>

export interface Handle {
  kind: HandleKind
  x: number
  y: number
}

/** CSS pixels; divided by the camera zoom into world units. */
export const HANDLE_SIZE = 8
export const ROTATE_HANDLE_OFFSET = 24

/**
 * Handle positions for an axis-aligned selection box, in world
 * coordinates. Corners come first so they win over edge midpoints when
 * a tiny selection makes them overlap.
 */
export function getHandles(bounds: Rect, zoom: number): Handle[] {
  const { x, y, width, height } = bounds
  const midX = x + width / 2
  const midY = y + height / 2
  return [
    { kind: 'nw', x, y },
    { kind: 'ne', x: x + width, y },
    { kind: 'se', x: x + width, y: y + height },
    { kind: 'sw', x, y: y + height },
    { kind: 'n', x: midX, y },
    { kind: 'e', x: x + width, y: midY },
    { kind: 's', x: midX, y: y + height },
    { kind: 'w', x, y: midY },
    { kind: 'rotate', x: midX, y: y - ROTATE_HANDLE_OFFSET / zoom },
  ]
}

export function hitTestHandles(
  handles: readonly Handle[],
  point: Point,
  zoom: number,
): HandleKind | null {
  const radius = HANDLE_SIZE / zoom
  for (const handle of handles) {
    if (
      Math.abs(point.x - handle.x) <= radius &&
      Math.abs(point.y - handle.y) <= radius
    ) {
      return handle.kind
    }
  }
  return null
}

/**
 * Applies a pointer delta to the edges a handle owns and returns the
 * normalized rect, so dragging past the opposite edge flips the box.
 * With `lockAspect`, corner handles scale uniformly from the dominant
 * axis, anchored at the opposite corner.
 */
export function resizeRect(
  start: Rect,
  handle: ResizeHandleKind,
  delta: Point,
  lockAspect: boolean,
): Rect {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (handle.includes('w')) {
    left += delta.x
  }
  if (handle.includes('e')) {
    right += delta.x
  }
  if (handle.includes('n')) {
    top += delta.y
  }
  if (handle.includes('s')) {
    bottom += delta.y
  }
  if (
    lockAspect &&
    handle.length === 2 &&
    start.width > 0 &&
    start.height > 0
  ) {
    const anchorX = handle.includes('w') ? start.x + start.width : start.x
    const anchorY = handle.includes('n') ? start.y + start.height : start.y
    const movingX = handle.includes('w') ? left : right
    const movingY = handle.includes('n') ? top : bottom
    const scale = Math.max(
      Math.abs(movingX - anchorX) / start.width,
      Math.abs(movingY - anchorY) / start.height,
    )
    const width = start.width * scale
    const height = start.height * scale
    return {
      x: movingX >= anchorX ? anchorX : anchorX - width,
      y: movingY >= anchorY ? anchorY : anchorY - height,
      width,
      height,
    }
  }
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  }
}

/**
 * Maps an element frame from one rect to another, the way a selection
 * resize moves every selected element. Points of linear elements and
 * the font size of text scale along. The angle is untouched.
 */
export function scaleElement(
  element: BoardElement,
  from: Rect,
  to: Rect,
): ElementProps {
  const scaleX = from.width === 0 ? 1 : to.width / from.width
  const scaleY = from.height === 0 ? 1 : to.height / from.height
  const props: ElementProps = {
    x: to.x + (element.x - from.x) * scaleX,
    y: to.y + (element.y - from.y) * scaleY,
    width: element.width * scaleX,
    height: element.height * scaleY,
  }
  if (
    element.type === 'line' ||
    element.type === 'arrow' ||
    element.type === 'draw'
  ) {
    props.points = element.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    }))
  }
  if (element.type === 'text') {
    props.fontSize = element.fontSize * scaleY
  }
  return props
}

const ROTATION_STEP = Math.PI / 12

/**
 * Angle for the rotate handle: zero when the pointer sits straight
 * above the center, increasing clockwise. `snap` rounds to 15 degrees.
 */
export function rotationAngle(
  center: Point,
  pointer: Point,
  snap: boolean,
): number {
  const angle =
    Math.atan2(pointer.y - center.y, pointer.x - center.x) + Math.PI / 2
  if (!snap) {
    return angle
  }
  return Math.round(angle / ROTATION_STEP) * ROTATION_STEP
}
