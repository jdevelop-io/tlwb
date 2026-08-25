import {
  type Camera,
  clampZoom,
  screenToWorld,
  worldToScreen,
  zoomCamera,
} from '../camera'
import { getElementBounds } from '../geometry/bounds'
import { createInteractionController } from '../interaction/controller'
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
import { HIT_TOLERANCE, type ToolType, topIndex } from '../tools/types'
import { resolveEnvironment } from './environment'
import { bindInput } from './input'
import {
  commitTextChanges,
  createLabel,
  resolveDoubleClick,
} from './textEditing'
import type { Editor, EditorAction, EditorOptions, EditorState } from './types'

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
    onTextEditRequest: options.onTextEditRequest,
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
  const unsubscribeController = controller.subscribe(invalidate)
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

  /** One undo entry, selected, handed to the host's editor. */
  const placeText = (element: BoardElement): void => {
    store.stopCapturing()
    store.applyChanges([{ kind: 'create', element }])
    store.stopCapturing()
    controller.setActiveTool('select')
    controller.setSelectedIds([element.id])
    options.onTextEditRequest?.(element.id)
  }

  const unbindInput = bindInput(overlayCanvas, env.keyboardTarget, {
    store,
    controller,
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
          options.onTextEditRequest?.(target.id)
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
      batching = true
      if (next) {
        controller.setSelectedIds([])
        controller.setActiveTool('hand')
      } else {
        controller.setActiveTool('select')
      }
      batching = false
      invalidate()
    }),
    execute: editable((action: EditorAction) => controller.execute(action)),
    updateSelection: editable((patch: ElementProps) => {
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
        return
      }
      store.stopCapturing()
      store.applyChanges(changes)
      store.stopCapturing()
    }),
    undo: editable(() => store.undo()),
    redo: editable(() => store.redo()),
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
    destroy: () => {
      if (destroyed) {
        return
      }
      destroyed = true
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
