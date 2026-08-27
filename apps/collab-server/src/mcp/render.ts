import { fileURLToPath } from 'node:url'
import type { ImageContent } from '@modelcontextprotocol/sdk/types.js'
import {
  createCanvas,
  GlobalFonts,
  type Image,
  loadImage,
  Path2D,
} from '@napi-rs/canvas'
import {
  type BoardElement,
  exportBounds,
  exportScenePng,
  type ImageResolver,
} from '@tlwb/engine'
import { getAsset } from '../db/assets'
import type { Db } from '../db/client'

// The engine references the DOM Path2D global; napi provides it here.
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D
}

/** The web application's faces, from the same packages it loads. */
export const FONTS = { hand: 'Caveat', ui: 'Inter' }
const BACKGROUND = '#FFFFFF'

/**
 * Registers a font file, throwing if it fails: this runs at module
 * load, so failing loudly at startup is the right behaviour rather
 * than silently falling back to a substitute font and serving PNGs
 * whose layout and fonts do not match the browser's export.
 */
export function registerFont(specifier: string, family: string): void {
  const key = GlobalFonts.registerFromPath(
    fileURLToPath(import.meta.resolve(specifier)),
    family,
  )
  if (!key) {
    throw new Error(`failed to register font "${family}" from ${specifier}`)
  }
}
registerFont('@fontsource/inter/files/inter-latin-400-normal.woff2', FONTS.ui)
registerFont(
  '@fontsource/caveat/files/caveat-latin-500-normal.woff2',
  FONTS.hand,
)

/** A napi canvas with the browser's `toBlob`, which napi lacks. */
function canvasFactory(): () => HTMLCanvasElement {
  return () => {
    const canvas = createCanvas(1, 1)
    return Object.assign(canvas, {
      toBlob(callback: (blob: Blob | null) => void, type?: string) {
        callback(
          new Blob([new Uint8Array(canvas.toBuffer('image/png'))], { type }),
        )
      },
    }) as unknown as HTMLCanvasElement
  }
}

export interface RenderOptions {
  scale: number
  /** Output pixels (width times height) above which nothing is rendered. */
  maxPixels: number
  resolveImage?: ImageResolver
}

/**
 * Whether a render at `scale` would exceed `maxPixels`, checked from
 * bounds alone so a caller can refuse an oversized board before paying
 * for anything the render itself would need (loading and decoding
 * assets in particular).
 */
export function exceedsPixelBudget(
  elements: readonly BoardElement[],
  scale: number,
  maxPixels: number,
): boolean {
  const bounds = exportBounds(elements)
  const pixels = Math.ceil(bounds.width) * Math.ceil(bounds.height) * scale ** 2
  return pixels > maxPixels
}

/** Null when the output would exceed `maxPixels`. */
export async function renderPng(
  elements: readonly BoardElement[],
  options: RenderOptions,
): Promise<Uint8Array | null> {
  if (exceedsPixelBudget(elements, options.scale, options.maxPixels)) {
    return null
  }
  const blob = await exportScenePng(
    elements,
    {
      scale: options.scale,
      fonts: FONTS,
      background: BACKGROUND,
      resolveImage: options.resolveImage,
    },
    canvasFactory(),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Decodes every asset the board's image elements reference, so the
 * synchronous resolver the renderer wants can answer from memory. An
 * asset that is missing or undecodable renders as nothing.
 */
export async function loadImages(
  db: Db,
  boardId: string,
  elements: readonly BoardElement[],
): Promise<ImageResolver> {
  const images = new Map<string, Image>()
  for (const element of elements) {
    if (element.type !== 'image' || images.has(element.assetHash)) {
      continue
    }
    const asset = await getAsset(db, boardId, element.assetHash)
    if (!asset) {
      continue
    }
    try {
      images.set(element.assetHash, await loadImage(asset.bytes))
    } catch {
      // Not decodable: skipped, like a broken image in the browser.
    }
  }
  return (assetHash) =>
    (images.get(assetHash) as unknown as CanvasImageSource | undefined) ?? null
}

export function imageBlock(png: Uint8Array): ImageContent {
  return {
    type: 'image',
    data: Buffer.from(png).toString('base64'),
    mimeType: 'image/png',
  }
}
