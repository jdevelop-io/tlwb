import type { Camera } from '../camera'
import type { Rect } from '../geometry/bounds'
import type { SnapGuide } from '../geometry/snap'
import type { ElementId, ElementProps, Point } from '../model/element'
import { indexAfter } from '../model/ordering'
import type { BoardStore } from '../store/types'

export type ToolType =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'draw'
  | 'text'
  | 'image'
  | 'eraser'

/** CSS pixels; divide by the camera zoom at the call site. */
export const HIT_TOLERANCE = 8
export const DRAG_THRESHOLD = 2

export interface PointerInput {
  /** Already projected through the camera. */
  world: Point
  /** Raw CSS pixel position, for camera pans. */
  screen: Point
  shiftKey: boolean
  altKey: boolean
}

export interface PendingImage {
  assetHash: string
  width: number
  height: number
}

/**
 * Why the host is being asked to open its text editor. 'created' says
 * the caller has just created the element and left its undo capture
 * open, so the first commit joins the creation entry; 'existing' asks
 * to edit an element that was already there.
 */
export type TextEditOrigin = 'created' | 'existing'

export interface ToolContext {
  store: BoardStore
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** Owned by the controller; callers must not mutate the returned array. */
  getSelection(): readonly ElementId[]
  setSelection(ids: ElementId[]): void
  /** Style defaults applied to newly created elements. */
  getDefaults(): ElementProps
  /** Creation tools fall back to select once their element exists. */
  setActiveTool(type: ToolType): void
  /**
   * The host opens its DOM text editor over the element. A tool that
   * just created the element passes 'created' and leaves its undo
   * capture open, so creating and typing cost one undo entry.
   *
   * Returns true when the recipient took ownership of that capture and
   * will close it itself. A recipient that ignores the origin returns
   * nothing, which is falsy: the caller must then close the capture, so
   * declining is always the safe answer.
   */
  requestTextEdit(id: ElementId, origin?: TextEditOrigin): boolean
  /** Asset staged by the host for the image tool; null when none. */
  getPendingImage(): PendingImage | null
}

/**
 * What the user is doing right now, named after the gesture rather than
 * after the tool running it. Overlay painters key off this: hiding the
 * resize handles while the selection moves, or showing a rotation
 * affordance, cannot be inferred from the snap guides, which stay empty
 * whenever a move happens to snap to nothing.
 */
export type GestureKind =
  | 'idle'
  | 'moving'
  | 'resizing'
  | 'rotating'
  | 'lasso'
  | 'creating'

/**
 * Ephemeral per-gesture state the overlay rendering needs. Tools whose
 * gesture has nothing to paint (hand, text, image, eraser) implement no
 * overlay at all and read as idle.
 */
export interface ToolOverlay {
  gesture: GestureKind
  lasso: Rect | null
  guides: SnapGuide[]
}

export interface Tool {
  readonly type: ToolType
  onPointerDown(input: PointerInput, context: ToolContext): void
  onPointerMove(input: PointerInput, context: ToolContext): void
  onPointerUp(input: PointerInput, context: ToolContext): void
  /** Escape or tool switch mid-gesture: abandon without committing. */
  onCancel(context: ToolContext): void
  getOverlay?(): ToolOverlay
}

/** Fractional index above every current element. */
export function topIndex(store: BoardStore): string {
  return indexAfter(store.listElements().at(-1)?.index ?? null)
}
