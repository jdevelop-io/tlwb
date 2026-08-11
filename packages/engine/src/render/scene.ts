import { RoughCanvas } from 'roughjs/bin/canvas'
import { type Camera, type Viewport, visibleRect } from '../camera'
import {
  expandRect,
  getElementBounds,
  rectsIntersect,
} from '../geometry/bounds'
import type { BoardElement, ImageElement, TextElement } from '../model/element'
import { getFreehandPath } from './freehand'
import { getShapeDrawables } from './shapes'
import {
  DEFAULT_FONTS,
  type FontConfig,
  fontString,
  LINE_HEIGHT,
  textAnchorX,
  textLines,
} from './text'

export type ImageResolver = (assetHash: string) => CanvasImageSource | null

export interface RenderSceneOptions {
  /** Sorted back to front, as `BoardStore.listElements()` returns them. */
  elements: readonly BoardElement[]
  camera: Camera
  /** CSS pixels; the backing store scales by `devicePixelRatio`. */
  viewport: Viewport
  devicePixelRatio?: number
  fonts?: FontConfig
  resolveImage?: ImageResolver
  background?: string
}

/** World-unit slack for stroke overshoot around sketchy outlines. */
const CULLING_MARGIN = 32

const noImage: ImageResolver = () => null

export function renderScene(
  canvas: HTMLCanvasElement,
  options: RenderSceneOptions,
): void {
  const {
    elements,
    camera,
    viewport,
    devicePixelRatio = 1,
    fonts = DEFAULT_FONTS,
    resolveImage = noImage,
    background = '#FFFFFF',
  } = options
  const width = Math.round(viewport.width * devicePixelRatio)
  const height = Math.round(viewport.height * devicePixelRatio)
  if (canvas.width !== width) {
    canvas.width = width
  }
  if (canvas.height !== height) {
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }
  const rough = new RoughCanvas(canvas)
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, viewport.width, viewport.height)
  ctx.scale(camera.zoom, camera.zoom)
  ctx.translate(-camera.x, -camera.y)
  const visible = expandRect(visibleRect(camera, viewport), CULLING_MARGIN)
  for (const element of elements) {
    if (element.opacity === 0) {
      continue
    }
    if (!rectsIntersect(getElementBounds(element), visible)) {
      continue
    }
    ctx.save()
    ctx.globalAlpha = element.opacity
    ctx.translate(element.x + element.width / 2, element.y + element.height / 2)
    ctx.rotate(element.angle)
    ctx.translate(-element.width / 2, -element.height / 2)
    paintElement(ctx, rough, element, fonts, resolveImage)
    ctx.restore()
  }
}

function paintElement(
  ctx: CanvasRenderingContext2D,
  rough: RoughCanvas,
  element: BoardElement,
  fonts: FontConfig,
  resolveImage: ImageResolver,
): void {
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'line':
    case 'arrow': {
      for (const drawable of getShapeDrawables(element)) {
        rough.draw(drawable)
      }
      return
    }
    case 'draw': {
      const path = getFreehandPath(element)
      if (path === '') {
        return
      }
      ctx.fillStyle = element.strokeColor
      ctx.fill(new Path2D(path))
      return
    }
    case 'text':
      paintText(ctx, element, fonts)
      return
    case 'image':
      paintImage(ctx, element, resolveImage)
      return
  }
}

function paintText(
  ctx: CanvasRenderingContext2D,
  element: TextElement,
  fonts: FontConfig,
): void {
  ctx.fillStyle = element.strokeColor
  ctx.font = fontString(element, fonts)
  ctx.textAlign = element.textAlign
  ctx.textBaseline = 'top'
  const anchorX = textAnchorX(element)
  textLines(element).forEach((line, row) => {
    ctx.fillText(line, anchorX, row * element.fontSize * LINE_HEIGHT)
  })
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  element: ImageElement,
  resolveImage: ImageResolver,
): void {
  const image = resolveImage(element.assetHash)
  if (image) {
    ctx.drawImage(image, 0, 0, element.width, element.height)
    return
  }
  ctx.fillStyle = '#F7F7F5'
  ctx.fillRect(0, 0, element.width, element.height)
  ctx.strokeStyle = '#E5E4E0'
  ctx.lineWidth = 2
  ctx.strokeRect(0, 0, element.width, element.height)
}
