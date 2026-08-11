import { normalizeLinearPoints } from '../geometry/points'
import { createElement } from '../model/create'
import type { ElementId, Point } from '../model/element'
import type { Tool, ToolOverlay } from './types'
import { topIndex } from './types'

/**
 * Freehand strokes: one store update per pointer move so collaborators
 * watch the stroke appear. The tool stays active on release so strokes
 * can chain without re-picking it.
 */
export function createDrawTool(): Tool {
  let worldPoints: Point[] | null = null
  let id: ElementId | null = null

  const reset = (): void => {
    worldPoints = null
    id = null
  }

  return {
    type: 'draw',
    onPointerDown(input, context) {
      context.store.stopCapturing()
      // No drag threshold here, unlike the shape and linear tools: a
      // plain click is meant to leave a one-point, zero-size element on
      // the board. That is a dot, which perfect-freehand renders as a
      // blob, and dotting the canvas is what a drawing tool is for.
      worldPoints = [input.world]
      const element = createElement('draw', {
        index: topIndex(context.store),
        ...context.getDefaults(),
        ...normalizeLinearPoints(worldPoints),
      })
      context.store.applyChanges([{ kind: 'create', element }])
      id = element.id
    },
    onPointerMove(input, context) {
      if (!worldPoints || !id) {
        return
      }
      worldPoints.push(input.world)
      context.store.applyChanges([
        { kind: 'update', id, props: normalizeLinearPoints(worldPoints) },
      ])
    },
    onPointerUp(_input, context) {
      if (id) {
        context.store.stopCapturing()
      }
      reset()
    },
    onCancel(context) {
      if (id) {
        // The streamed element is exactly the open capture entry.
        context.store.undo()
      }
      reset()
    },
    getOverlay(): ToolOverlay {
      return { gesture: id ? 'creating' : 'idle', lasso: null, guides: [] }
    },
  }
}
