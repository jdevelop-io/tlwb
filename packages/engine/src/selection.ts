import { getElementBounds, type Rect, rectsIntersect } from './geometry/bounds'
import type { BoardElement, ElementId } from './model/element'

/**
 * Group ids touched by the given selection: the `groupId` of every
 * element in `ids` that belongs to a group. Shared by `expandToGroups`
 * and by `ungroupElements` in `src/model/operations.ts`, which both need
 * to know which groups a selection reaches into.
 */
export function touchedGroupIds(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): Set<string> {
  const wanted = new Set(ids)
  const groups = new Set<string>()
  for (const element of elements) {
    if (wanted.has(element.id) && element.groupId !== null) {
      groups.add(element.groupId)
    }
  }
  return groups
}

/**
 * Selecting any member of a group selects the whole group. Returns the
 * expanded id list in z-order (the order of `elements`), dropping ids
 * the board does not hold.
 */
export function expandToGroups(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): ElementId[] {
  const wanted = new Set(ids)
  const groups = touchedGroupIds(elements, ids)
  const expanded: ElementId[] = []
  for (const element of elements) {
    if (
      wanted.has(element.id) ||
      (element.groupId !== null && groups.has(element.groupId))
    ) {
      expanded.push(element.id)
    }
  }
  return expanded
}

/** Union of the rotated bounding boxes; null when nothing matches. */
export function selectionBounds(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): Rect | null {
  const wanted = new Set(ids)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let found = false
  for (const element of elements) {
    if (!wanted.has(element.id)) {
      continue
    }
    found = true
    const bounds = getElementBounds(element)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  if (!found) {
    return null
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Lasso semantics: caught when the element bounds intersect the rect. */
export function elementsInRect(
  elements: readonly BoardElement[],
  rect: Rect,
): ElementId[] {
  return elements
    .filter((element) => rectsIntersect(getElementBounds(element), rect))
    .map((element) => element.id)
}
