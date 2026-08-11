import { hitTestScene } from '../geometry/hit'
import type { ElementId } from '../model/element'
import { deleteElements } from '../model/operations'
import type { PointerInput, Tool, ToolContext } from './types'
import { HIT_TOLERANCE } from './types'

/**
 * Collects everything touched during the drag and deletes it as one
 * batch on release, so the whole sweep undoes in one step.
 *
 * Known limitation: hit-testing runs at the discrete pointer samples
 * only and never interpolates along the path between two moves, so a
 * fast sweep can jump over a small element that sat between them. Fixing
 * it means hit-testing the segment rather than its endpoints.
 */
export function createEraserTool(): Tool {
  let hitIds: Set<ElementId> | null = null

  const collect = (input: PointerInput, context: ToolContext): void => {
    if (!hitIds) {
      return
    }
    const pending = hitIds
    const tolerance = HIT_TOLERANCE / context.getCamera().zoom
    const remaining = context.store
      .listElements()
      .filter((element) => !pending.has(element.id))
    const hit = hitTestScene(remaining, input.world, tolerance)
    if (hit) {
      pending.add(hit.id)
    }
  }

  return {
    type: 'eraser',
    onPointerDown(input, context) {
      hitIds = new Set()
      collect(input, context)
    },
    onPointerMove(input, context) {
      collect(input, context)
    },
    onPointerUp(_input, context) {
      if (hitIds && hitIds.size > 0) {
        context.store.stopCapturing()
        context.store.applyChanges(
          deleteElements(context.store.listElements(), [...hitIds]),
        )
        context.store.stopCapturing()
      }
      hitIds = null
    },
    onCancel() {
      hitIds = null
    },
  }
}
