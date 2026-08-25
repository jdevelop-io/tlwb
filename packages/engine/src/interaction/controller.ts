import type { Camera } from '../camera'
import type { Rect } from '../geometry/bounds'
import type { SnapGuide } from '../geometry/snap'
import { getHandles, type Handle } from '../geometry/transform'
import {
  type KeyboardAction,
  type KeyInput,
  resolveKeyboardAction,
} from '../keyboard'
import { applyWithBindings } from '../model/bindings'
import type { ElementId, ElementProps } from '../model/element'
import {
  bringForward,
  bringToFront,
  deleteElements,
  duplicateElements,
  groupElements,
  sendBackward,
  sendToBack,
  ungroupElements,
} from '../model/operations'
import { selectionBounds } from '../selection'
import type { BoardChange, BoardStore } from '../store/types'
import { createDrawTool } from '../tools/draw'
import { createEraserTool } from '../tools/eraser'
import { createHandTool } from '../tools/hand'
import { createImageTool } from '../tools/image'
import { createLinearTool } from '../tools/linear'
import { createSelectTool } from '../tools/select'
import { createShapeTool } from '../tools/shape'
import { createTextTool } from '../tools/text'
import type {
  GestureKind,
  PendingImage,
  PointerInput,
  Tool,
  ToolContext,
  ToolOverlay,
  ToolType,
} from '../tools/types'

export interface InteractionSnapshot {
  activeTool: ToolType
  selectedIds: ElementId[]
  selectionBounds: Rect | null
  /** Present only for the select tool with a non-empty selection. */
  handles: Handle[]
  /**
   * What the user is doing right now. Covers only the states an overlay
   * painter needs to distinguish, not every gesture in progress: see
   * `GestureKind` for the full rule, including which in-progress gestures
   * still report 'idle'.
   */
  gesture: GestureKind
  lasso: Rect | null
  guides: SnapGuide[]
}

export interface InteractionControllerOptions {
  store: BoardStore
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** Initial style defaults for created elements. */
  defaults?: ElementProps
  onTextEditRequest?(id: ElementId): void
  /**
   * Asset staged by the host for the image tool; null when none. The
   * engine only reads this once per placement, at the pointer-up that
   * creates the image element, and never clears or mutates whatever the
   * host returns. The host therefore owns the staged image's entire
   * lifecycle: after a placement consumes it, the host must clear the
   * value (or stage the next asset) before the user can place again, or
   * re-activating the image tool without re-staging places a second copy
   * of the same asset.
   */
  getPendingImage?(): PendingImage | null
}

export interface InteractionController {
  getActiveTool(): ToolType
  setActiveTool(type: ToolType): void
  getSelectedIds(): ElementId[]
  setSelectedIds(ids: ElementId[]): void
  /** Merged into the creation defaults (contextual panel writes here). */
  setDefaults(patch: ElementProps): void
  pointerDown(input: PointerInput): void
  pointerMove(input: PointerInput): void
  pointerUp(input: PointerInput): void
  /**
   * Abandons the gesture in flight without committing it and leaves the
   * selection alone. This is where a host routes the browser's
   * pointercancel (palm rejection, a system gesture stealing the
   * pointer, the pointer leaving the window mid-drag): routing it to
   * pointerUp would commit the half-drawn element instead.
   */
  cancelGesture(): void
  /** True when the key was consumed; the host preventDefaults then. */
  handleKey(input: KeyInput): boolean
  /** Runs an action as a consumed key would; the client chrome calls it. */
  execute(action: KeyboardAction): void
  /** Copy of the current creation defaults (contextual panel reads here). */
  getDefaults(): ElementProps
  getSnapshot(): InteractionSnapshot
  /** Fires on any change of tool, selection, or gesture state. */
  subscribe(listener: () => void): () => void
  destroy(): void
}

const DUPLICATE_OFFSET = 10

/**
 * The headless editor: owns the active tool and the selection, routes
 * already-projected pointer input and keyboard input, and exposes the
 * state the overlay rendering needs. The next plan's createEditor binds
 * DOM events onto it.
 */
export function createInteractionController(
  options: InteractionControllerOptions,
): InteractionController {
  const { store } = options
  let selection: ElementId[] = []
  let activeToolType: ToolType = 'select'
  let defaults: ElementProps = { ...options.defaults }
  const listeners = new Set<() => void>()
  // Some actions (a tool switch, clearing the selection) notify as a
  // side effect of the helper they call, on top of the trailing notify
  // every dispatch already does. Suppressing nested notifies while a
  // dispatch runs keeps one key press or one `execute` call down to a
  // single notification, matching what a subscriber actually cares
  // about: the settled state after the action, not each step of it.
  let dispatching = false

  const notify = (): void => {
    if (dispatching) {
      return
    }
    for (const listener of listeners) {
      listener()
    }
  }

  function dispatch(action: () => void): void {
    dispatching = true
    try {
      action()
    } finally {
      dispatching = false
    }
    notify()
  }

  const context: ToolContext = {
    store,
    getCamera: () => options.getCamera(),
    setCamera: (camera) => options.setCamera(camera),
    getSelection: () => selection,
    setSelection: (ids) => {
      // Copied in, as getSelectedIds and getSnapshot copy out: the
      // controller owns its selection array, and a caller that keeps
      // writing to the array it handed over changes nothing here.
      selection = [...ids]
      notify()
    },
    getDefaults: () => defaults,
    setActiveTool: (type) => setActiveTool(type),
    requestTextEdit: (id) => options.onTextEditRequest?.(id),
    getPendingImage: () => options.getPendingImage?.() ?? null,
  }

  const tools: Record<ToolType, Tool> = {
    select: createSelectTool(),
    hand: createHandTool(),
    rectangle: createShapeTool('rectangle'),
    ellipse: createShapeTool('ellipse'),
    diamond: createShapeTool('diamond'),
    arrow: createLinearTool('arrow'),
    line: createLinearTool('line'),
    draw: createDrawTool(),
    text: createTextTool(),
    image: createImageTool(),
    eraser: createEraserTool(),
  }

  function setActiveTool(type: ToolType): void {
    if (type === activeToolType) {
      return
    }
    tools[activeToolType].onCancel(context)
    activeToolType = type
    notify()
  }

  // Selection ids must never point at missing elements, whatever
  // removed them: undo, a remote batch, or the eraser.
  const unsubscribe = store.subscribe((event) => {
    if (event.kind !== 'changes') {
      return
    }
    const deleted = new Set<ElementId>()
    for (const change of event.changes) {
      if (change.kind === 'delete') {
        deleted.add(change.id)
      }
    }
    if (deleted.size === 0) {
      return
    }
    const pruned = selection.filter((id) => !deleted.has(id))
    if (pruned.length !== selection.length) {
      selection = pruned
      notify()
    }
  })

  /** One discrete action = one undo entry. */
  function applyDiscrete(changes: BoardChange[]): void {
    if (changes.length === 0) {
      return
    }
    store.stopCapturing()
    store.applyChanges(changes)
    store.stopCapturing()
  }

  function execute(action: KeyboardAction): void {
    const elements = store.listElements()
    switch (action.kind) {
      case 'set-tool':
        setActiveTool(action.tool)
        return
      case 'cancel':
        tools[activeToolType].onCancel(context)
        context.setSelection([])
        return
      case 'undo':
        store.undo()
        return
      case 'redo':
        store.redo()
        return
      case 'select-all':
        context.setSelection(elements.map((element) => element.id))
        return
      case 'delete-selection':
        applyDiscrete(deleteElements(elements, selection))
        return
      case 'duplicate-selection': {
        if (selection.length === 0) {
          return
        }
        store.stopCapturing()
        const { changes, newIds } = duplicateElements(elements, selection, {
          x: DUPLICATE_OFFSET,
          y: DUPLICATE_OFFSET,
        })
        store.applyChanges(changes)
        store.stopCapturing()
        context.setSelection(newIds)
        return
      }
      case 'group-selection':
        applyDiscrete(groupElements(elements, selection))
        return
      case 'ungroup-selection':
        applyDiscrete(ungroupElements(elements, selection))
        return
      case 'bring-to-front':
        applyDiscrete(bringToFront(elements, selection))
        return
      case 'send-to-back':
        applyDiscrete(sendToBack(elements, selection))
        return
      case 'bring-forward':
        applyDiscrete(bringForward(elements, selection))
        return
      case 'send-backward':
        applyDiscrete(sendBackward(elements, selection))
        return
      case 'nudge': {
        if (selection.length === 0) {
          return
        }
        // Deliberately no capture boundary: the previous gesture closed
        // its entry, so held arrow keys coalesce into a single undo.
        const wanted = new Set(selection)
        const changes: BoardChange[] = elements
          .filter((element) => wanted.has(element.id))
          .map((element) => ({
            kind: 'update',
            id: element.id,
            props: { x: element.x + action.dx, y: element.y + action.dy },
          }))
        applyWithBindings(store, changes, wanted)
        return
      }
      default: {
        // Exhaustiveness guard: a KeyboardAction variant added without a
        // matching case here fails the build instead of silently falling
        // through at runtime.
        const unreachable: never = action
        void unreachable
        return
      }
    }
  }

  return {
    getActiveTool: () => activeToolType,
    setActiveTool,
    getSelectedIds: () => [...selection],
    setSelectedIds: (ids) => context.setSelection(ids),
    setDefaults: (patch) => {
      defaults = { ...defaults, ...patch }
    },
    getDefaults: () => ({ ...defaults }),
    pointerDown: (input) => {
      tools[activeToolType].onPointerDown(input, context)
      notify()
    },
    pointerMove: (input) => {
      tools[activeToolType].onPointerMove(input, context)
      notify()
    },
    pointerUp: (input) => {
      tools[activeToolType].onPointerUp(input, context)
      notify()
    },
    cancelGesture: () => {
      tools[activeToolType].onCancel(context)
      notify()
    },
    handleKey: (input) => {
      const action = resolveKeyboardAction(input)
      if (!action) {
        return false
      }
      dispatch(() => execute(action))
      return true
    },
    execute: (action) => {
      dispatch(() => execute(action))
    },
    getSnapshot: () => {
      const elements = store.listElements()
      const bounds = selectionBounds(elements, selection)
      const overlay: ToolOverlay = tools[activeToolType].getOverlay?.() ?? {
        gesture: 'idle',
        lasso: null,
        guides: [],
      }
      return {
        activeTool: activeToolType,
        selectedIds: [...selection],
        selectionBounds: bounds,
        handles:
          activeToolType === 'select' && bounds
            ? getHandles(bounds, options.getCamera().zoom)
            : [],
        gesture: overlay.gesture,
        lasso: overlay.lasso,
        guides: overlay.guides,
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    destroy: () => {
      tools[activeToolType].onCancel(context)
      unsubscribe()
      listeners.clear()
    },
  }
}
