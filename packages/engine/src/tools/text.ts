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
      // The capture is offered, not abandoned: a recipient that takes
      // it ('created' handed over, true returned) closes it once the
      // edit settles, so the host's first commit joins this entry and
      // one undo removes the element. A recipient that declines leaves
      // the tool to close it here, which costs a second undo entry but
      // never lets an unrelated write join this one.
      context.store.applyChanges([{ kind: 'create', element }])
      context.setSelection([element.id])
      if (!context.requestTextEdit(element.id, 'created')) {
        context.store.stopCapturing()
      }
      context.setActiveTool('select')
    },
    onCancel() {},
  }
}
