import { type Camera, panCamera, screenToWorld, zoomCamera } from '../camera'
import { hitTestScene } from '../geometry/hit'
import { hitTestHandles } from '../geometry/transform'
import type { InteractionController } from '../interaction/controller'
import type { Point } from '../model/element'
import type { BoardStore } from '../store/types'
import { HIT_TOLERANCE, type PointerInput } from '../tools/types'
import { cursorFor } from './cursor'

export interface InputHost {
  store: BoardStore
  controller: InteractionController
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** CSS pixel position relative to the container. */
  toScreen(event: { clientX: number; clientY: number }): Point
  isReadOnly(): boolean
  onDoubleClick(world: Point): void
  onCursorMove(point: Point | null): void
}

/** Wheel pixels to zoom factor: about 100 px doubles or halves the zoom. */
const WHEEL_ZOOM_SENSITIVITY = 0.007

/**
 * Binds the browser's pointer, wheel, and keyboard events onto the
 * controller. Pointer positions are projected through the camera here;
 * the controller only ever sees `PointerInput`. Returns the disposer.
 */
export function bindInput(
  surface: HTMLCanvasElement,
  keyboardTarget: EventTarget,
  host: InputHost,
): () => void {
  let spaceHeld = false
  let pressed = false
  /** Last screen point of the temporary pan in progress, if any. */
  let pan: Point | null = null
  /**
   * Pointer driving the gesture (a press or a pan) in progress, if any.
   * This is a single-pointer editor: once a pointer opens a gesture,
   * every other pointer's down/move/up/cancel is ignored until it ends,
   * so a second finger or an unrelated mouse button cannot steal or
   * close it.
   */
  let activePointerId: number | null = null
  let lastWorld: Point = { x: 0, y: 0 }

  const worldOf = (event: { clientX: number; clientY: number }): Point =>
    screenToWorld(host.getCamera(), host.toScreen(event))

  const toInput = (event: PointerEvent, screen: Point): PointerInput => ({
    world: screenToWorld(host.getCamera(), screen),
    screen,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  })

  const updateCursor = (): void => {
    const camera = host.getCamera()
    const snapshot = host.controller.getSnapshot()
    const handle = pan
      ? null
      : hitTestHandles(snapshot.handles, lastWorld, camera.zoom)
    const hit =
      snapshot.selectedIds.length > 0
        ? hitTestScene(
            host.store.listElements(),
            lastWorld,
            HIT_TOLERANCE / camera.zoom,
          )
        : null
    const [singleId] = snapshot.selectedIds
    const single =
      singleId !== undefined && snapshot.selectedIds.length === 1
        ? host.store.getElement(singleId)
        : undefined
    surface.style.cursor = cursorFor({
      tool: snapshot.activeTool,
      gesture: snapshot.gesture,
      panning: pan !== null,
      panReady: spaceHeld,
      pressed,
      handle,
      overSelected: hit !== null && snapshot.selectedIds.includes(hit.id),
      angle: single?.angle ?? 0,
    })
  }

  /** True when `pointerId` isn't the one driving the gesture in progress. */
  const isForeignPointer = (pointerId: number): boolean =>
    activePointerId !== null && pointerId !== activePointerId

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button === 2 || isForeignPointer(event.pointerId)) {
      return
    }
    const screen = host.toScreen(event)
    lastWorld = screenToWorld(host.getCamera(), screen)
    if (event.button === 1 || spaceHeld) {
      activePointerId = event.pointerId
      surface.setPointerCapture(event.pointerId)
      pan = screen
      event.preventDefault()
      updateCursor()
      return
    }
    if (event.button !== 0) {
      return
    }
    activePointerId = event.pointerId
    surface.setPointerCapture(event.pointerId)
    pressed = true
    host.controller.pointerDown(toInput(event, screen))
    updateCursor()
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (isForeignPointer(event.pointerId)) {
      return
    }
    const screen = host.toScreen(event)
    lastWorld = screenToWorld(host.getCamera(), screen)
    host.onCursorMove(lastWorld)
    if (pan) {
      host.setCamera(
        panCamera(host.getCamera(), screen.x - pan.x, screen.y - pan.y),
      )
      pan = screen
      return
    }
    if (pressed) {
      host.controller.pointerMove(toInput(event, screen))
    }
    updateCursor()
  }

  const onPointerUp = (event: PointerEvent): void => {
    // The right button never opens a gesture, so it can never close one
    // (a right-click during a left-button drag, same mouse, same pointer
    // id); the pointer id check catches the other half, a second finger
    // releasing while the first one is still down.
    if (event.button === 2 || isForeignPointer(event.pointerId)) {
      return
    }
    const screen = host.toScreen(event)
    lastWorld = screenToWorld(host.getCamera(), screen)
    if (pan) {
      pan = null
      activePointerId = null
      updateCursor()
      return
    }
    if (!pressed) {
      return
    }
    pressed = false
    activePointerId = null
    host.controller.pointerUp(toInput(event, screen))
    updateCursor()
  }

  const onPointerCancel = (event: PointerEvent): void => {
    if (isForeignPointer(event.pointerId)) {
      return
    }
    pan = null
    activePointerId = null
    if (pressed) {
      pressed = false
      host.controller.cancelGesture()
    }
    updateCursor()
  }

  const onPointerLeave = (): void => {
    host.onCursorMove(null)
  }

  const onDoubleClick = (event: MouseEvent): void => {
    if (host.isReadOnly()) {
      return
    }
    host.onDoubleClick(worldOf(event))
  }

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const camera = host.getCamera()
    if (event.ctrlKey || event.metaKey) {
      host.setCamera(
        zoomCamera(
          camera,
          host.toScreen(event),
          camera.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
        ),
      )
      return
    }
    host.setCamera(panCamera(camera, -event.deltaX, -event.deltaY))
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) {
      return
    }
    if (event.key === ' ') {
      spaceHeld = true
      event.preventDefault()
      updateCursor()
      return
    }
    if (host.isReadOnly()) {
      return
    }
    const consumed = host.controller.handleKey({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    })
    if (consumed) {
      event.preventDefault()
    }
    updateCursor()
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ') {
      spaceHeld = false
      updateCursor()
    }
  }

  /** A key held while the window loses focus never gets its keyup. */
  const onBlur = (): void => {
    spaceHeld = false
  }

  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('pointermove', onPointerMove)
  surface.addEventListener('pointerup', onPointerUp)
  surface.addEventListener('pointercancel', onPointerCancel)
  surface.addEventListener('pointerleave', onPointerLeave)
  surface.addEventListener('dblclick', onDoubleClick)
  // Explicitly non-passive: Chrome otherwise ignores preventDefault on
  // wheel and scrolls the page under the board.
  surface.addEventListener('wheel', onWheel, { passive: false })
  keyboardTarget.addEventListener('keydown', onKeyDown as EventListener)
  keyboardTarget.addEventListener('keyup', onKeyUp as EventListener)
  keyboardTarget.addEventListener('blur', onBlur)

  return () => {
    surface.removeEventListener('pointerdown', onPointerDown)
    surface.removeEventListener('pointermove', onPointerMove)
    surface.removeEventListener('pointerup', onPointerUp)
    surface.removeEventListener('pointercancel', onPointerCancel)
    surface.removeEventListener('pointerleave', onPointerLeave)
    surface.removeEventListener('dblclick', onDoubleClick)
    surface.removeEventListener('wheel', onWheel)
    keyboardTarget.removeEventListener('keydown', onKeyDown as EventListener)
    keyboardTarget.removeEventListener('keyup', onKeyUp as EventListener)
    keyboardTarget.removeEventListener('blur', onBlur)
  }
}

/** The host's text editor and board name keep their keys. */
function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') {
    return false
  }
  const element = target as { tagName?: string; isContentEditable?: boolean }
  const tag = element.tagName?.toUpperCase()
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    element.isContentEditable === true
  )
}
