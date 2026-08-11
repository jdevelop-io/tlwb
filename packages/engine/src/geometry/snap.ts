import type { Rect } from './bounds'

/** CSS pixels; callers divide by the camera zoom. */
export const SNAP_THRESHOLD = 8

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal'
  position: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

interface AxisSnap {
  diff: number
  position: number
}

function stops(rect: Rect, vertical: boolean): number[] {
  return vertical
    ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    : [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
}

function bestAxisSnap(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
  vertical: boolean,
): AxisSnap | null {
  const movingStops = stops(moving, vertical)
  let best: AxisSnap | null = null
  for (const other of others) {
    for (const target of stops(other, vertical)) {
      for (const movingStop of movingStops) {
        const diff = target - movingStop
        if (
          Math.abs(diff) <= threshold &&
          (best === null || Math.abs(diff) < Math.abs(best.diff))
        ) {
          best = { diff, position: target }
        }
      }
    }
  }
  return best
}

/**
 * Light alignment snapping for a moving selection: edges and centers
 * against other elements' edges and centers, independently per axis.
 */
export function snapMovedBounds(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
): SnapResult {
  const vertical = bestAxisSnap(moving, others, threshold, true)
  const horizontal = bestAxisSnap(moving, others, threshold, false)
  const guides: SnapGuide[] = []
  if (vertical) {
    guides.push({ orientation: 'vertical', position: vertical.position })
  }
  if (horizontal) {
    guides.push({ orientation: 'horizontal', position: horizontal.position })
  }
  return { dx: vertical?.diff ?? 0, dy: horizontal?.diff ?? 0, guides }
}
