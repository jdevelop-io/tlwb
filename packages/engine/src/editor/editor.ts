import {
  type Camera,
  clampZoom,
  screenToWorld,
  worldToScreen,
  zoomCamera,
} from '../camera'
import { exportScenePng } from '../export/png'
import { exportSceneSvg } from '../export/svg'
import { getElementBounds } from '../geometry/bounds'
import {
  createInteractionController,
  type InteractionController,
} from '../interaction/controller'
import { applyWithBindings } from '../model/bindings'
import { createElement } from '../model/create'
import type {
  BoardElement,
  ElementId,
  ElementProps,
  Point,
} from '../model/element'
import { type Peer, sanitizePeers } from '../presence'
import {
  DEFAULT_OVERLAY_THEME,
  type OverlayTheme,
  renderOverlay,
} from '../render/overlay'
import { createRenderer } from '../render/renderer'
import { createFrameScheduler } from '../render/schedule'
import { DEFAULT_FONTS, measureText, type TextSpec } from '../render/text'
import { selectionBounds } from '../selection'
import {
  HIT_TOLERANCE,
  type TextEditOrigin,
  type ToolType,
  topIndex,
} from '../tools/types'
import { resolveEnvironment } from './environment'
import { bindInput } from './input'
import {
  commitTextChanges,
  createLabel,
  resolveDoubleClick,
} from './textEditing'
import type {
  Editor,
  EditorAction,
  EditorOptions,
  EditorState,
  ExportOptions,
} from './types'

/** CSS pixels kept around a fitted selection on each side. */
const FIT_PADDING = 48

const CANVAS_STYLE = {
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  touchAction: 'none',
} as const

/**
 * The one place a missing 2D context is turned into a failed mount.
 * Called before any canvas is appended, so a browser that cannot give
 * the editor a context leaves nothing behind in the host's container.
 */
function contextOrThrow(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('createEditor: 2D canvas context unavailable')
  }
  return context
}

/**
 * The DOM-bound editor: two stacked canvases (scene below, overlay
 * above) in the host's container, the interaction controller behind
 * them, and one immutable state snapshot for the host's UI. Element
 * mutations still go through the injected store.
 */
export function createEditor(options: EditorOptions): Editor {
  const { container, store } = options
  if (
    typeof HTMLElement !== 'undefined' &&
    !(container instanceof HTMLElement)
  ) {
    throw new TypeError('createEditor: container must be an HTMLElement')
  }
  const env = resolveEnvironment(options.environment)
  const theme: OverlayTheme = { ...DEFAULT_OVERLAY_THEME, ...options.theme }
  const sceneCanvas = env.createCanvas()
  const overlayCanvas = env.createCanvas()
  for (const canvas of [sceneCanvas, overlayCanvas]) {
    contextOrThrow(canvas)
  }
  const fonts = options.fonts ?? DEFAULT_FONTS
  const measuringContext = contextOrThrow(env.createCanvas())
  const measure = (spec: TextSpec) => measureText(spec, fonts, measuringContext)
  // The canvases are absolutely positioned, so the container has to be
  // a positioned ancestor. Only a static one is changed: a host that
  // positions its container itself, from a stylesheet or inline, keeps
  // its own value and its own layout.
  if (env.getComputedPosition(container) === 'static') {
    container.style.position = 'relative'
  }
  for (const canvas of [sceneCanvas, overlayCanvas]) {
    Object.assign(canvas.style, CANVAS_STYLE)
    container.appendChild(canvas)
  }

  let viewport = { width: 0, height: 0 }
  let pixelRatio = env.getPixelRatio()
  let peers: Peer[] = []
  let destroyed = false
  let readOnly = options.readOnly ?? false
  /**
   * The text `placeText` just created, until something settles it. Its
   * undo capture is still open while it is set, so the first commit
   * joins the creation entry instead of opening a second one.
   */
  let pendingTextId: ElementId | null = null

  /**
   * The single door to the host's text editor, whichever route opened
   * it: the text tool through the controller, a double-click here. A
   * 'created' element arrives with its undo capture still open. This
   * takes ownership of it, saying so with the return value the text
   * tool reads, and the `pendingTextId` recorded here is what lets the
   * first `commitText` join the creation entry instead of opening a
   * second one. Closing that capture instead would cost two undo
   * entries, the first of which only empties the text back to an
   * invisible zero-width frame.
   *
   * The open capture is the price. Every other route into the store
   * closes it first (`settleTextCreation`), so an edit the user
   * abandons cannot swallow a later unrelated action.
   */
  const beginTextEdit = (id: ElementId, origin: TextEditOrigin): boolean => {
    if (origin === 'created') {
      pendingTextId = id
    }
    options.onTextEditRequest?.(id)
    // Recording the pending creation is taking ownership of its still
    // open capture: `settleTextCreation` is what closes it.
    return origin === 'created'
  }

  const renderer = createRenderer({
    canvas: sceneCanvas,
    store,
    width: 0,
    height: 0,
    devicePixelRatio: pixelRatio,
    fonts,
    resolveImage: options.resolveImage,
    background: options.background,
    requestFrame: env.requestFrame,
  })

  /**
   * Closes over `overlay` and `refresh`, both bound further down, yet it
   * is handed to the controller before either exists and the read-only
   * tool switch runs there too. That holds only as long as no
   * constructor and no tool's `onCancel` calls back into `setCamera`: a
   * tool that panned on cancel would turn this into a ReferenceError at
   * mount. Move the bindings above this point if that ever changes.
   */
  const setCamera = (camera: Camera): void => {
    if (destroyed) {
      return
    }
    renderer.setCamera(camera)
    overlay.markDirty()
    refresh()
  }

  const controller = createInteractionController({
    store,
    getCamera: () => renderer.getCamera(),
    setCamera,
    defaults: options.defaults,
    onTextEditRequest: beginTextEdit,
    getPendingImage: options.getPendingImage,
  })

  if (readOnly) {
    controller.setActiveTool('hand')
  }

  const overlay = createFrameScheduler(() => {
    renderOverlay(overlayCanvas, {
      elements: store.listElements(),
      snapshot: controller.getSnapshot(),
      camera: renderer.getCamera(),
      viewport,
      devicePixelRatio: pixelRatio,
      peers,
      theme,
    })
  }, env.requestFrame)

  const listeners = new Set<() => void>()
  const compute = (): EditorState => {
    const snapshot = controller.getSnapshot()
    return {
      activeTool: snapshot.activeTool,
      selectedIds: snapshot.selectedIds,
      camera: renderer.getCamera(),
      gesture: snapshot.gesture,
      readOnly,
      // Read-only strips undo/redo from the host's UI too: neither call
      // does anything there, so neither should ever read as available.
      canUndo: !readOnly && store.canUndo(),
      canRedo: !readOnly && store.canRedo(),
    }
  }
  let state = compute()
  /** True while several controller calls form one state change. */
  let batching = false
  const refresh = (): void => {
    if (destroyed || batching) {
      return
    }
    const next = compute()
    if (sameState(state, next)) {
      return
    }
    state = next
    for (const listener of listeners) {
      listener()
    }
  }

  const invalidate = (): void => {
    overlay.markDirty()
    refresh()
  }
  const unsubscribeController = controller.subscribe(() => {
    renderer.setErasingIds(controller.getSnapshot().erasing)
    invalidate()
  })
  const unsubscribeStore = store.subscribe(invalidate)
  const stopSizing = env.observeSize(container, (width, height) => {
    viewport = { width, height }
    renderer.resize(width, height, pixelRatio)
    overlay.markDirty()
  })
  const stopRatio = env.observePixelRatio((ratio) => {
    pixelRatio = ratio
    renderer.resize(viewport.width, viewport.height, ratio)
    overlay.markDirty()
  })

  /**
   * The double-click route: creates the text with its capture left
   * open, then goes through the same door the text tool goes through.
   */
  const placeText = (element: BoardElement): void => {
    store.stopCapturing()
    store.applyChanges([{ kind: 'create', element }])
    controller.setActiveTool('select')
    controller.setSelectedIds([element.id])
    beginTextEdit(element.id, 'created')
  }

  /** Closes the capture a creation left open, if one is still open. */
  const settleTextCreation = (): void => {
    if (pendingTextId === null) {
      return
    }
    pendingTextId = null
    store.stopCapturing()
  }

  /**
   * The controller as input and the host reach it. Tools open their own
   * capture boundary before writing, but `nudge` deliberately does not,
   * so the three entry points that can write settle the pending text
   * creation rather than relying on every tool's discipline.
   */
  const guarded: InteractionController = {
    ...controller,
    pointerDown: (input) => {
      settleTextCreation()
      controller.pointerDown(input)
    },
    handleKey: (input) => {
      settleTextCreation()
      return controller.handleKey(input)
    },
    execute: (action) => {
      settleTextCreation()
      controller.execute(action)
    },
  }

  const unbindInput = bindInput(overlayCanvas, env.keyboardTarget, {
    store,
    controller: guarded,
    getCamera: () => renderer.getCamera(),
    setCamera,
    toScreen: (event) => {
      const rect = container.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    },
    isReadOnly: () => readOnly,
    onDoubleClick: (world) => {
      const elements = store.listElements()
      const target = resolveDoubleClick(
        elements,
        world,
        HIT_TOLERANCE / renderer.getCamera().zoom,
      )
      switch (target.kind) {
        case 'none':
          return
        case 'edit':
          controller.setSelectedIds([target.id])
          beginTextEdit(target.id, 'existing')
          return
        case 'label': {
          const shape = store.getElement(target.containerId)
          if (shape) {
            placeText(
              createLabel(
                shape,
                topIndex(store),
                controller.getDefaults(),
                measure,
              ),
            )
          }
          return
        }
        case 'create':
          placeText(
            createElement('text', {
              index: topIndex(store),
              ...controller.getDefaults(),
              x: world.x,
              y: world.y,
            }),
          )
          return
      }
    },
    onCursorMove: (point) => options.onCursorMove?.(point),
  })

  const fitCamera = (ids?: ElementId[]): Camera => {
    const elements = store.listElements()
    const bounds = selectionBounds(
      elements,
      ids ?? elements.map((element) => element.id),
    )
    if (!bounds || viewport.width === 0 || viewport.height === 0) {
      return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 }
    }
    const zoom = clampZoom(
      Math.min(
        (viewport.width - FIT_PADDING * 2) / Math.max(bounds.width, 1),
        (viewport.height - FIT_PADDING * 2) / Math.max(bounds.height, 1),
      ),
    )
    return {
      x: bounds.x + bounds.width / 2 - viewport.width / (2 * zoom),
      y: bounds.y + bounds.height / 2 - viewport.height / (2 * zoom),
      zoom,
    }
  }

  /** Every mutator is inert after destroy. */
  const alive =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (!destroyed) {
        fn(...args)
      }
    }

  /** Mutators are also inert in read-only mode. */
  const editable = <A extends unknown[]>(fn: (...args: A) => void) =>
    alive((...args: A) => {
      if (!readOnly) {
        fn(...args)
      }
    })

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setActiveTool: editable((type: ToolType) => controller.setActiveTool(type)),
    setSelectedIds: editable((ids: ElementId[]) =>
      controller.setSelectedIds(ids),
    ),
    setDefaults: alive((patch: ElementProps) => controller.setDefaults(patch)),
    setReadOnly: alive((next: boolean) => {
      if (readOnly === next) {
        return
      }
      readOnly = next
      settleTextCreation()
      batching = true
      try {
        if (next) {
          controller.setSelectedIds([])
          controller.setActiveTool('hand')
        } else {
          controller.setActiveTool('select')
        }
      } finally {
        batching = false
      }
      invalidate()
    }),
    execute: editable((action: EditorAction) => guarded.execute(action)),
    updateSelection: editable((patch: ElementProps) => {
      settleTextCreation()
      const ids = controller.getSelectedIds()
      if (ids.length === 0) {
        // clearHistory() empties the undo/redo stacks without emitting
        // anything, so the memoized state can be stale here (a host that
        // loads a document with applyChanges then clearHistory, for
        // instance): refresh covers this one path, not clearHistory in
        // general.
        refresh()
        return
      }
      store.stopCapturing()
      applyWithBindings(
        store,
        ids.map((id) => ({ kind: 'update', id, props: patch })),
        new Set(ids),
      )
      store.stopCapturing()
    }),
    commitText: editable((id: ElementId, text: string) => {
      const changes = commitTextChanges(store.listElements(), id, text, measure)
      if (changes.length === 0) {
        settleTextCreation()
        return
      }
      // The first commit on a freshly placed text joins its creation
      // entry; see placeText. A blank one merges a create and a delete
      // into that entry, which undoes to nothing: the abandoned text
      // leaves no visible element behind either way.
      const joinsCreation = id === pendingTextId
      pendingTextId = null
      if (!joinsCreation) {
        store.stopCapturing()
      }
      // A bare applyChanges, where every other frame-changing path goes
      // through applyWithBindings: nothing can bind to a text element,
      // so resizing one can never move a follower. Route this through
      // applyWithBindings the day a text becomes a bind target.
      store.applyChanges(changes)
      store.stopCapturing()
    }),
    undo: editable(() => {
      settleTextCreation()
      store.undo()
    }),
    redo: editable(() => {
      settleTextCreation()
      store.redo()
    }),
    setCamera,
    zoomTo: alive((zoom: number, anchor?: Point) =>
      setCamera(
        zoomCamera(
          renderer.getCamera(),
          anchor ?? { x: viewport.width / 2, y: viewport.height / 2 },
          zoom,
        ),
      ),
    ),
    zoomToFit: alive((ids?: ElementId[]) => setCamera(fitCamera(ids))),
    worldToScreen: (point) => worldToScreen(renderer.getCamera(), point),
    screenToWorld: (point) => screenToWorld(renderer.getCamera(), point),
    getElementScreenRect: (id) => {
      const element = store.getElement(id)
      if (!element) {
        return null
      }
      const bounds = getElementBounds(element)
      const camera = renderer.getCamera()
      const origin = worldToScreen(camera, bounds)
      return {
        x: origin.x,
        y: origin.y,
        width: bounds.width * camera.zoom,
        height: bounds.height * camera.zoom,
      }
    },
    setPresence: alive((next: Peer[]) => {
      peers = sanitizePeers(next)
      overlay.markDirty()
    }),
    // Exports read the store only, so they keep working after destroy.
    exportPng: (exportOptions: ExportOptions & { scale?: number } = {}) =>
      exportScenePng(
        store.listElements(),
        {
          ids: exportOptions.ids,
          background: exportOptions.background ?? options.background,
          scale: exportOptions.scale,
          fonts,
          resolveImage: options.resolveImage,
        },
        env.createCanvas,
      ),
    exportSvg: (exportOptions: ExportOptions = {}) =>
      exportSceneSvg(store.listElements(), {
        ids: exportOptions.ids,
        background: exportOptions.background ?? options.background,
        fonts,
        resolveImageUrl: options.resolveImageUrl,
      }),
    destroy: () => {
      if (destroyed) {
        return
      }
      destroyed = true
      // The store outlives the editor: never hand it back with a
      // capture this editor opened still open.
      settleTextCreation()
      unbindInput()
      stopSizing()
      stopRatio()
      unsubscribeController()
      unsubscribeStore()
      controller.destroy()
      renderer.destroy()
      overlay.destroy()
      container.removeChild(overlayCanvas)
      container.removeChild(sceneCanvas)
      listeners.clear()
    },
  }
}

function sameState(a: EditorState, b: EditorState): boolean {
  return (
    a.activeTool === b.activeTool &&
    a.gesture === b.gesture &&
    a.readOnly === b.readOnly &&
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.camera.x === b.camera.x &&
    a.camera.y === b.camera.y &&
    a.camera.zoom === b.camera.zoom &&
    a.selectedIds.length === b.selectedIds.length &&
    a.selectedIds.every((id, index) => id === b.selectedIds[index])
  )
}
