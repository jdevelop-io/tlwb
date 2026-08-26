import type { HandleKind } from '../geometry/transform'
import type { GestureKind, ToolType } from '../tools/types'

export interface CursorContext {
  tool: ToolType
  gesture: GestureKind
  /** Temporary pan (space bar or middle button) in progress. */
  panning: boolean
  /** Space bar held, pan about to start on press. */
  panReady: boolean
  /** Primary button held. */
  pressed: boolean
  handle: HandleKind | null
  overSelected: boolean
  /** Angle of the single selected element, so handle cursors turn with it. */
  angle: number
}

const CREATION_TOOLS: ReadonlySet<ToolType> = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'draw',
  'text',
  'image',
  'eraser',
])

/** Clockwise from north, one entry per 45 degrees. */
const DIRECTIONS: readonly HandleKind[] = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
]
const RESIZE_CURSORS: readonly [string, string, string, string] = [
  'ns-resize',
  'nesw-resize',
  'ew-resize',
  'nwse-resize',
]

/** CSS cursor for the pointer's situation; pure so the table is testable. */
export function cursorFor(context: CursorContext): string {
  if (context.panning) {
    return 'grabbing'
  }
  if (context.panReady) {
    return 'grab'
  }
  if (context.tool === 'hand') {
    return context.pressed ? 'grabbing' : 'grab'
  }
  if (CREATION_TOOLS.has(context.tool)) {
    return 'crosshair'
  }
  if (context.gesture === 'moving') {
    return 'move'
  }
  if (context.handle === 'rotate') {
    return 'grab'
  }
  if (context.handle) {
    return resizeCursor(context.handle, context.angle)
  }
  return context.overSelected ? 'move' : 'default'
}

function resizeCursor(handle: HandleKind, angle: number): string {
  const base = DIRECTIONS.indexOf(handle)
  const turns = Math.round(angle / (Math.PI / 4))
  const direction = (((base + turns) % 8) + 8) % 8
  return RESIZE_CURSORS[resizeQuadrant(direction)]
}

/** Narrows a direction (0-7) to its opposing-axis quadrant (0-3), so the
 * lookup above lands on a precise tuple element instead of `string |
 * undefined`. */
function resizeQuadrant(direction: number): 0 | 1 | 2 | 3 {
  switch (direction % 4) {
    case 0:
      return 0
    case 1:
      return 1
    case 2:
      return 2
    default:
      return 3
  }
}
