import { distance } from '../geometry/points'
import { createElement } from '../model/create'
import type { ElementId, ElementProps, Point } from '../model/element'
import type { Tool, ToolContext, ToolOverlay } from './types'
import { DRAG_THRESHOLD, topIndex } from './types'

function frameProps(
  origin: Point,
  current: Point,
  square: boolean,
): ElementProps {
  let width = Math.abs(current.x - origin.x)
  let height = Math.abs(current.y - origin.y)
  if (square) {
    width = Math.max(width, height)
    height = width
  }
  return {
    x: current.x >= origin.x ? origin.x : origin.x - width,
    y: current.y >= origin.y ? origin.y : origin.y - height,
    width,
    height,
  }
}

/**
 * Drag-to-create state machine for rectangle, ellipse, and diamond.
 * Nothing exists until the pointer travels DRAG_THRESHOLD screen
 * pixels, so a plain click creates nothing. On release the shape is
 * selected and the editor falls back to the select tool.
 */
export function createShapeTool(
  type: 'rectangle' | 'ellipse' | 'diamond',
): Tool {
  let origin: Point | null = null
  let id: ElementId | null = null

  const reset = (): void => {
    origin = null
    id = null
  }

  return {
    type,
    onPointerDown(input, context) {
      context.store.stopCapturing()
      origin = input.world
    },
    onPointerMove(input, context) {
      if (!origin) {
        return
      }
      const props = frameProps(origin, input.world, input.shiftKey)
      if (!id) {
        const threshold = DRAG_THRESHOLD / context.getCamera().zoom
        if (distance(origin, input.world) < threshold) {
          return
        }
        const element = createElement(type, {
          index: topIndex(context.store),
          ...context.getDefaults(),
          ...props,
        })
        context.store.applyChanges([{ kind: 'create', element }])
        id = element.id
        return
      }
      context.store.applyChanges([{ kind: 'update', id, props }])
    },
    onPointerUp(_input, context) {
      // Clear the gesture state before handing control back to the host:
      // setActiveTool can call onCancel back on this same tool instance,
      // and by then `id` must already be gone or onCancel would undo the
      // element this gesture just created.
      const created = id
      reset()
      if (created) {
        // Close the capture before the host callbacks, not after:
        // setActiveTool notifies host listeners synchronously, and a
        // host that writes to the store from that notification would
        // otherwise coalesce its write into this shape's undo entry.
        context.store.stopCapturing()
        context.setSelection([created])
        context.setActiveTool('select')
      }
    },
    onCancel(context: ToolContext) {
      if (id) {
        // The streamed shape is exactly the open capture entry.
        context.store.undo()
      }
      reset()
    },
    getOverlay(): ToolOverlay {
      // Creating starts at the press, before the drag threshold turns
      // the gesture into an element.
      return { gesture: origin ? 'creating' : 'idle', lasso: null, guides: [] }
    },
  }
}
