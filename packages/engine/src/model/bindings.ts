import {
  diamondPolygon,
  hitTestElementInterior,
  toLocalPoint,
  toWorldPoint,
} from '../geometry/hit'
import { normalizeLinearPoints, segmentsIntersection } from '../geometry/points'
import type { BoardChange, BoardStore } from '../store/types'
import type {
  BoardElement,
  DiamondElement,
  ElementId,
  EllipseElement,
  Point,
  RectangleElement,
} from './element'

export type BindableElement = RectangleElement | EllipseElement | DiamondElement

export function isBindable(element: BoardElement): element is BindableElement {
  return (
    element.type === 'rectangle' ||
    element.type === 'ellipse' ||
    element.type === 'diamond'
  )
}

/**
 * Topmost bindable shape whose interior, padded by `tolerance`,
 * contains the point. `elements` is sorted back to front, as
 * `BoardStore.listElements()` returns it.
 */
export function findBindTarget(
  elements: readonly BoardElement[],
  point: Point,
  tolerance: number,
  exclude?: ReadonlySet<ElementId>,
): BindableElement | null {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i] as BoardElement
    if (!isBindable(element) || element.opacity === 0) {
      continue
    }
    if (exclude?.has(element.id)) {
      continue
    }
    if (hitTestElementInterior(element, point, tolerance)) {
      return element
    }
  }
  return null
}

/**
 * Point on the shape outline where the segment from `from` toward the
 * shape center crosses it, in world coordinates. Falls back to `from`
 * when there is no crossing (the source is inside the shape).
 */
export function attachmentPoint(shape: BindableElement, from: Point): Point {
  const local = toLocalPoint(shape, from)
  const center = { x: shape.width / 2, y: shape.height / 2 }
  if (shape.type === 'ellipse') {
    const rx = shape.width / 2
    const ry = shape.height / 2
    if (rx <= 0 || ry <= 0) {
      return from
    }
    const dx = local.x - center.x
    const dy = local.y - center.y
    const norm = Math.hypot(dx / rx, dy / ry)
    if (norm === 0) {
      return from
    }
    return toWorldPoint(shape, {
      x: center.x + dx / norm,
      y: center.y + dy / norm,
    })
  }
  const corners: Point[] =
    shape.type === 'diamond'
      ? diamondPolygon(shape)
      : [
          { x: 0, y: 0 },
          { x: shape.width, y: 0 },
          { x: shape.width, y: shape.height },
          { x: 0, y: shape.height },
        ]
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i] as Point
    const b = corners[(i + 1) % corners.length] as Point
    const hit = segmentsIntersection(center, local, a, b)
    if (hit) {
      return toWorldPoint(shape, hit)
    }
  }
  return from
}

/**
 * Update batch re-anchoring every arrow bound to a moved element, from
 * the current element positions (call it after the move batch has been
 * applied). Arrows that moved themselves are skipped: moving an arrow
 * keeps its bindings, and the next shape move re-anchors it.
 *
 * An arrow bound at both ends is resolved in a single order-dependent
 * pass, by rule: the tail is aimed at the old head, then the head is
 * aimed at the new tail. Solving both against each other would need an
 * iteration whose extra precision no one can see at arrow width, so the
 * order is fixed rather than converged on.
 */
export function boundArrowUpdates(
  elements: readonly BoardElement[],
  movedIds: ReadonlySet<ElementId>,
): BoardChange[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const changes: BoardChange[] = []
  for (const element of elements) {
    if (element.type !== 'arrow' || movedIds.has(element.id)) {
      continue
    }
    if (element.points.length < 2) {
      continue
    }
    const startShape = element.startBinding
      ? byId.get(element.startBinding.elementId)
      : undefined
    const endShape = element.endBinding
      ? byId.get(element.endBinding.elementId)
      : undefined
    const follows =
      (startShape !== undefined && movedIds.has(startShape.id)) ||
      (endShape !== undefined && movedIds.has(endShape.id))
    if (!follows) {
      continue
    }
    const world = element.points.map((point) => ({
      x: element.x + point.x,
      y: element.y + point.y,
    }))
    const tail = world[0] as Point
    const head = world[world.length - 1] as Point
    const newTail =
      startShape && isBindable(startShape)
        ? attachmentPoint(startShape, head)
        : tail
    const newHead =
      endShape && isBindable(endShape)
        ? attachmentPoint(endShape, newTail)
        : head
    world[0] = newTail
    world[world.length - 1] = newHead
    changes.push({
      kind: 'update',
      id: element.id,
      props: normalizeLinearPoints(world),
    })
  }
  return changes
}

/**
 * Applies a batch, then re-anchors the arrows bound to the touched ids.
 * This is the whole re-anchor policy in one place: any change to an
 * element's position must re-anchor its bound arrows, so every caller
 * that moves elements goes through here rather than pairing
 * `applyChanges` with `boundArrowUpdates` on its own.
 */
export function applyWithArrows(
  store: BoardStore,
  changes: BoardChange[],
  touchedIds: ReadonlySet<ElementId>,
): void {
  store.applyChanges(changes)
  const arrows = boundArrowUpdates(store.listElements(), touchedIds)
  if (arrows.length > 0) {
    store.applyChanges(arrows)
  }
}
