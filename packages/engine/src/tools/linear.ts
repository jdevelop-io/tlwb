import { distance, normalizeLinearPoints } from '../geometry/points'
import { attachmentPoint, findBindTarget } from '../model/bindings'
import { createElement } from '../model/create'
import type { ElementId, ElementProps, Point } from '../model/element'
import type { Tool } from './types'
import { DRAG_THRESHOLD, HIT_TOLERANCE, topIndex } from './types'

const DIRECTION_STEP = Math.PI / 12

/** Keeps the segment length, snaps its direction to 15-degree steps. */
function snapDirection(start: Point, end: Point): Point {
  const length = distance(start, end)
  if (length === 0) {
    return end
  }
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const snapped = Math.round(angle / DIRECTION_STEP) * DIRECTION_STEP
  return {
    x: start.x + Math.cos(snapped) * length,
    y: start.y + Math.sin(snapped) * length,
  }
}

/**
 * Two-point drag for lines and arrows. Arrows bind their endpoints to
 * the topmost shape under them on release and anchor onto its outline.
 */
export function createLinearTool(type: 'line' | 'arrow'): Tool {
  let start: Point | null = null
  let end: Point | null = null
  let id: ElementId | null = null

  const reset = (): void => {
    start = null
    end = null
    id = null
  }

  return {
    type,
    onPointerDown(input, context) {
      context.store.stopCapturing()
      start = input.world
      end = input.world
      const element = createElement(type, {
        index: topIndex(context.store),
        ...context.getDefaults(),
        ...normalizeLinearPoints([start, end]),
      })
      context.store.applyChanges([{ kind: 'create', element }])
      id = element.id
    },
    onPointerMove(input, context) {
      if (!start || !id) {
        return
      }
      end = input.shiftKey ? snapDirection(start, input.world) : input.world
      context.store.applyChanges([
        { kind: 'update', id, props: normalizeLinearPoints([start, end]) },
      ])
    },
    onPointerUp(_input, context) {
      if (!start || !end || !id) {
        reset()
        return
      }
      const zoom = context.getCamera().zoom
      if (distance(start, end) < DRAG_THRESHOLD / zoom) {
        // A degenerate drag discards the whole capture entry.
        context.store.undo()
        reset()
        return
      }
      // Clear the gesture state before handing control back to the host:
      // setActiveTool can call onCancel back on this same tool instance,
      // and by then `id` must already be gone or onCancel would undo the
      // element this gesture just created. The arrow binding logic below
      // still needs `start`, `end`, and `id`, so it works off local
      // copies taken before the reset.
      const created = id
      const anchorStart = start
      const anchorEnd = end
      if (type === 'arrow') {
        const elements = context.store.listElements()
        const tolerance = HIT_TOLERANCE / zoom
        const exclude = new Set([created])
        const startTarget = findBindTarget(
          elements,
          anchorStart,
          tolerance,
          exclude,
        )
        const endTarget = findBindTarget(
          elements,
          anchorEnd,
          tolerance,
          exclude,
        )
        const anchoredStart = startTarget
          ? attachmentPoint(startTarget, anchorEnd)
          : anchorStart
        const anchoredEnd = endTarget
          ? attachmentPoint(endTarget, anchoredStart)
          : anchorEnd
        const props: ElementProps = {
          ...normalizeLinearPoints([anchoredStart, anchoredEnd]),
          startBinding: startTarget ? { elementId: startTarget.id } : null,
          endBinding: endTarget ? { elementId: endTarget.id } : null,
        }
        context.store.applyChanges([{ kind: 'update', id: created, props }])
      }
      reset()
      // Close the capture before the host callbacks, not after:
      // setActiveTool notifies host listeners synchronously, and a host
      // that writes to the store from that notification would otherwise
      // coalesce its write into this element's undo entry.
      context.store.stopCapturing()
      context.setSelection([created])
      context.setActiveTool('select')
    },
    onCancel(context) {
      if (id) {
        // The streamed element is exactly the open capture entry.
        context.store.undo()
      }
      reset()
    },
  }
}
