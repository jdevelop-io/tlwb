import { type Camera, clampZoom, createCamera } from '../camera'
import type { ElementId } from '../model/element'
import type { BoardStore } from '../store/types'
import { type ImageResolver, renderScene } from './scene'
import { createFrameScheduler, type FrameRequester } from './schedule'
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
  requestFrame?: FrameRequester
}

export interface Renderer {
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** The pixel ratio defaults to the current one. */
  resize(width: number, height: number, devicePixelRatio?: number): void
  /** Repaints only when the set actually changes. */
  setErasingIds(ids: readonly ElementId[]): void
  markDirty(): void
  destroy(): void
}

/**
 * Binds a canvas to a board store: every store event invalidates the
 * scene, and at most one frame is pending at any time. There is no
 * continuous loop; a clean board costs nothing.
 */
export function createRenderer(options: RendererOptions): Renderer {
  const { canvas, store } = options
  let camera = createCamera()
  let viewport = { width: options.width, height: options.height }
  let devicePixelRatio = options.devicePixelRatio ?? 1
  let erasingIds: ReadonlySet<ElementId> = new Set()

  const scheduler = createFrameScheduler(() => {
    renderScene(canvas, {
      elements: store.listElements(),
      camera,
      viewport,
      devicePixelRatio,
      fonts: options.fonts,
      resolveImage: options.resolveImage,
      background: options.background,
      erasingIds,
    })
  }, options.requestFrame)

  const unsubscribe = store.subscribe(() => scheduler.markDirty())
  scheduler.markDirty()

  return {
    getCamera: () => camera,
    setCamera: (next) => {
      camera = { ...next, zoom: clampZoom(next.zoom) }
      scheduler.markDirty()
    },
    resize: (width, height, ratio = devicePixelRatio) => {
      viewport = { width, height }
      devicePixelRatio = ratio
      scheduler.markDirty()
    },
    setErasingIds: (ids) => {
      if (
        ids.length === erasingIds.size &&
        ids.every((id) => erasingIds.has(id))
      ) {
        return
      }
      erasingIds = new Set(ids)
      scheduler.markDirty()
    },
    markDirty: scheduler.markDirty,
    destroy: () => {
      scheduler.destroy()
      unsubscribe()
    },
  }
}
