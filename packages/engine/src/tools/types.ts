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

export interface ToolContext {
  store: BoardStore
  getCamera(): Camera
  setCamera(camera: Camera): void
  getSelection(): ElementId[]
  setSelection(ids: ElementId[]): void
  /** Style defaults applied to newly created elements. */
  getDefaults(): ElementProps
  /** Creation tools fall back to select once their element exists. */
  setActiveTool(type: ToolType): void
  /** The host opens its DOM text editor over the element. */
  requestTextEdit(id: ElementId): void
  /** Asset staged by the host for the image tool; null when none. */
  getPendingImage(): PendingImage | null
}

/** Ephemeral per-gesture state the overlay rendering needs. */
export interface ToolOverlay {
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
