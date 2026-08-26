import { createElement } from '../model/create'
import type { Tool } from './types'
import { topIndex } from './types'

/**
 * Places an empty text element on click and hands editing to the host:
 * the engine has no DOM access, so the host opens its text editor over
 * the element, then sizes it (or removes it when committed empty).
 */
export function createTextTool(): Tool {
  return {
    type: 'text',
    onPointerDown() {},
    onPointerMove() {},
    onPointerUp(input, context) {
      context.store.stopCapturing()
      const element = createElement('text', {
        index: topIndex(context.store),
        ...context.getDefaults(),
        x: input.world.x,
        y: input.world.y,
      })
      // The capture stays open: 'created' hands it to the owner of the
      // pending creation, so the host's first commit joins this entry
      // and one undo removes the element.
      context.store.applyChanges([{ kind: 'create', element }])
      context.setSelection([element.id])
      context.requestTextEdit(element.id, 'created')
      context.setActiveTool('select')
    },
    onCancel() {},
  }
}
