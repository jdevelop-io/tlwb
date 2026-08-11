import { type Camera, clampZoom, createCamera } from '../camera'
import type { BoardStore } from '../store/types'
import { type ImageResolver, renderScene } from './scene'
import type { FontConfig } from './text'

export interface RendererOptions {
  canvas: HTMLCanvasElement
  store: BoardStore
  /** Initial viewport size in CSS pixels. */
  width: number
  height: number
  devicePixelRatio?: number
  fonts?: FontConfig
  resolveImage?: ImageResolver
  background?: string
  /** Frame scheduler, injectable for tests. */
  requestFrame?: (callback: () => void) => void
}

export interface Renderer {
  getCamera(): Camera
  setCamera(camera: Camera): void
  resize(width: number, height: number): void
  markDirty(): void
  destroy(): void
}

const defaultRequestFrame = (callback: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback())
  } else {
    setTimeout(callback, 16)
  }
}

/**
 * Binds a canvas to a board store: every store event invalidates the
 * scene, and at most one frame is pending at any time. There is no
 * continuous loop; a clean board costs nothing.
 */
export function createRenderer(options: RendererOptions): Renderer {
  const { canvas, store, requestFrame = defaultRequestFrame } = options
  let camera = createCamera()
  let viewport = { width: options.width, height: options.height }
  let dirty = false
  let destroyed = false

  const renderNow = (): void => {
    renderScene(canvas, {
      elements: store.listElements(),
      camera,
      viewport,
      devicePixelRatio: options.devicePixelRatio,
      fonts: options.fonts,
      resolveImage: options.resolveImage,
      background: options.background,
    })
  }

  const markDirty = (): void => {
    if (dirty || destroyed) {
      return
    }
    dirty = true
    requestFrame(() => {
      dirty = false
      if (destroyed) {
        return
      }
      renderNow()
    })
  }

  const unsubscribe = store.subscribe(() => markDirty())
  markDirty()

  return {
    getCamera: () => camera,
    setCamera: (next) => {
      camera = { ...next, zoom: clampZoom(next.zoom) }
      markDirty()
    },
    resize: (width, height) => {
      viewport = { width, height }
      markDirty()
    },
    markDirty,
    destroy: () => {
      destroyed = true
      unsubscribe()
    },
  }
}
