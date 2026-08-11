import { createElement } from '../model/create'
import type { Tool } from './types'
import { topIndex } from './types'

/**
 * Places the image the host staged (upload and hashing are the host's
 * job), centered on the click. Without a staged image the tool is
 * inert.
 */
export function createImageTool(): Tool {
  return {
    type: 'image',
    onPointerDown() {},
    onPointerMove() {},
    onPointerUp(input, context) {
      const pending = context.getPendingImage()
      if (!pending) {
        return
      }
      context.store.stopCapturing()
      const element = createElement('image', {
        index: topIndex(context.store),
        ...context.getDefaults(),
        assetHash: pending.assetHash,
        x: input.world.x - pending.width / 2,
        y: input.world.y - pending.height / 2,
        width: pending.width,
        height: pending.height,
      })
      context.store.applyChanges([{ kind: 'create', element }])
      context.store.stopCapturing()
      context.setSelection([element.id])
      context.setActiveTool('select')
    },
    onCancel() {},
  }
}
