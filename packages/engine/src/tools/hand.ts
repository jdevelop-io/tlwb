import { panCamera } from '../camera'
import type { Point } from '../model/element'
import type { Tool } from './types'

/** Pans the camera; the only tool that never touches the store. */
export function createHandTool(): Tool {
  let last: Point | null = null
  return {
    type: 'hand',
    onPointerDown(input) {
      last = input.screen
    },
    onPointerMove(input, context) {
      if (!last) {
        return
      }
      context.setCamera(
        panCamera(
          context.getCamera(),
          input.screen.x - last.x,
          input.screen.y - last.y,
        ),
      )
      last = input.screen
    },
    onPointerUp() {
      last = null
    },
    onCancel() {
      last = null
    },
  }
}
