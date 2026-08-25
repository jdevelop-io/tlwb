import type { Camera } from '../camera'
import type { Rect } from '../geometry/bounds'
import type { KeyboardAction } from '../keyboard'
import type { ElementId, ElementProps, Point } from '../model/element'
import type { Peer } from '../presence'
import type { OverlayTheme } from '../render/overlay'
import type { ImageResolver } from '../render/scene'
import type { FontConfig } from '../render/text'
import type { BoardStore } from '../store/types'
import type { GestureKind, PendingImage, ToolType } from '../tools/types'
import type { EditorEnvironment } from './environment'

/**
 * The keyboard table resolves to it and the client chrome (toolbar,
 * contextual panel, overflow menu) dispatches it directly.
 */
export type EditorAction = KeyboardAction

export interface EditorOptions {
  container: HTMLElement
  store: BoardStore
  fonts?: FontConfig
  /** Scene and PNG export. */
  resolveImage?: ImageResolver
  /** SVG export: an href (data or content URL); null omits the image. */
  resolveImageUrl?: (assetHash: string) => string | null
  background?: string
  defaults?: ElementProps
  readOnly?: boolean
  theme?: Partial<OverlayTheme>
  onTextEditRequest?: (id: ElementId) => void
  getPendingImage?: () => PendingImage | null
  /** World position of the local pointer; null when it leaves the canvas. */
  onCursorMove?: (point: Point | null) => void
  /** Browser seam; tests replace it, hosts leave it alone. */
  environment?: Partial<EditorEnvironment>
}

export interface EditorState {
  activeTool: ToolType
  selectedIds: ElementId[]
  camera: Camera
  gesture: GestureKind
  readOnly: boolean
  canUndo: boolean
  canRedo: boolean
}

export interface Editor {
  /** A new object only when something changed; safe for `useSyncExternalStore`. */
  getState(): EditorState
  subscribe(listener: () => void): () => void

  setActiveTool(type: ToolType): void
  setSelectedIds(ids: ElementId[]): void
  /** Merged into the creation defaults (contextual panel writes here). */
  setDefaults(patch: ElementProps): void
  /** Dispatches a chrome action (delete, duplicate, group, z-order...). */
  execute(action: EditorAction): void
  /** Applies a style or position patch to every selected element, one undo entry. */
  updateSelection(patch: ElementProps): void
  /**
   * Ends a host text edit: sizes the element with the scene metrics,
   * recenters a label in its container, deletes it when blank.
   */
  commitText(id: ElementId, text: string): void
  undo(): void
  redo(): void

  setCamera(camera: Camera): void
  /** Zooms toward the anchor (CSS pixels), the viewport center by default. */
  zoomTo(zoom: number, screenAnchor?: Point): void
  /** Frames the ids, or the whole board; resets to the origin when empty. */
  zoomToFit(ids?: ElementId[]): void
  worldToScreen(point: Point): Point
  screenToWorld(point: Point): Point
  /** Screen rect of the element's bounding box; null for an unknown id. */
  getElementScreenRect(id: ElementId): Rect | null

  /** Replaces the whole peer list; malformed peers are dropped. */
  setPresence(peers: Peer[]): void

  destroy(): void
}
