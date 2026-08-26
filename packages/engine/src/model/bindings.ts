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
 * Frame of a label centered in its container: the label's own center
 * sits on the container's center and it turns with the container, so
 * rotating either one keeps them concentric.
 */
export function labelFrame(
  container: BoardElement,
  size: { width: number; height: number },
): { x: number; y: number; angle: number } {
  return {
    x: container.x + (container.width - size.width) / 2,
    y: container.y + (container.height - size.height) / 2,
    angle: container.angle,
  }
}

/**
 * Update batch recentering every label whose container is in
 * `movedIds`, from the current element positions (call it after the
 * move batch has been applied). A label that moved itself is skipped,
 * exactly like an arrow that moved itself in `boundArrowUpdates`.
 */
export function boundLabelUpdates(
  elements: readonly BoardElement[],
  movedIds: ReadonlySet<ElementId>,
): BoardChange[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const changes: BoardChange[] = []
  for (const element of elements) {
    if (
      element.type !== 'text' ||
      element.containerId === null ||
      movedIds.has(element.id)
    ) {
      continue
    }
    const container = byId.get(element.containerId)
    if (!container || !movedIds.has(container.id)) {
      continue
    }
    changes.push({
      kind: 'update',
      id: element.id,
      props: labelFrame(container, element),
    })
  }
  return changes
}

/**
 * Applies a batch, then re-anchors the arrows and recenters the labels
 * bound to the touched ids. This is the whole follow policy in one
 * place: any change to an element's frame must update what is bound to
 * it, so every caller that moves, resizes, or rotates elements goes
 * through here rather than pairing `applyChanges` with the update
 * builders on its own.
 */
export function applyWithBindings(
  store: BoardStore,
  changes: BoardChange[],
  touchedIds: ReadonlySet<ElementId>,
): void {
  store.applyChanges(changes)
  const elements = store.listElements()
  const bound = [
    ...boundArrowUpdates(elements, touchedIds),
    ...boundLabelUpdates(elements, touchedIds),
  ]
  if (bound.length > 0) {
    store.applyChanges(bound)
  }
}
