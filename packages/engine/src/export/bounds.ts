import { expandRect, type Rect } from '../geometry/bounds'
import type { BoardElement, ElementId } from '../model/element'
import { selectionBounds } from '../selection'

/** World units of white space around an exported scene. */
export const EXPORT_MARGIN = 16

/** All elements when `ids` is absent or empty, else the listed ones in scene order. */
export function selectExportElements(
  elements: readonly BoardElement[],
  ids?: readonly ElementId[],
): BoardElement[] {
  if (!ids || ids.length === 0) {
    return [...elements]
  }
  const wanted = new Set(ids)
  return elements.filter((element) => wanted.has(element.id))
}

/** Union of the element bounds plus the margin; one pixel when empty. */
export function exportBounds(elements: readonly BoardElement[]): Rect {
  const bounds = selectionBounds(
    elements,
    elements.map((element) => element.id),
  )
  if (!bounds) {
    return { x: 0, y: 0, width: 1, height: 1 }
  }
  return expandRect(bounds, EXPORT_MARGIN)
}
