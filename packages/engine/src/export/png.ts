import type { BoardElement, ElementId } from '../model/element'
import { type ImageResolver, renderScene } from '../render/scene'
import type { FontConfig } from '../render/text'
import { exportBounds, selectExportElements } from './bounds'

export interface PngExportOptions {
  /** Empty or absent exports the whole board. */
  ids?: readonly ElementId[]
  background?: string
  fonts?: FontConfig
  resolveImage?: ImageResolver
  /** Backing store pixels per world unit; 2 for a retina export. */
  scale?: number
}

/**
 * Rasterizes a scene through the scene renderer on an offscreen canvas,
 * framed on the element bounds plus the export margin, and encodes it
 * as PNG. `createCanvas` comes from the editor environment so this
 * stays testable without a DOM.
 */
export function exportScenePng(
  elements: readonly BoardElement[],
  options: PngExportOptions,
  createCanvas: () => HTMLCanvasElement,
): Promise<Blob> {
  const chosen = selectExportElements(elements, options.ids)
  const bounds = exportBounds(chosen)
  const canvas = createCanvas()
  renderScene(canvas, {
    elements: chosen,
    camera: { x: bounds.x, y: bounds.y, zoom: 1 },
    viewport: {
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height),
    },
    devicePixelRatio: options.scale ?? 1,
    fonts: options.fonts,
    resolveImage: options.resolveImage,
    background: options.background,
  })
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('PNG encoding failed'))
      }
    }, 'image/png')
  })
}
