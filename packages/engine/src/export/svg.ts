import type {
  BoardElement,
  ElementId,
  ImageElement,
  TextElement,
} from '../model/element'
import { getFreehandPath } from '../render/freehand'
import { dashPattern, getShapeSvgPaths } from '../render/shapes'
import {
  DEFAULT_FONTS,
  type FontConfig,
  LINE_HEIGHT,
  textAnchorX,
  textLines,
} from '../render/text'
import { exportBounds, selectExportElements } from './bounds'

export interface SvgExportOptions {
  /** Empty or absent exports the whole board. */
  ids?: readonly ElementId[]
  background?: string
  fonts?: FontConfig
  /** An href for the image (data or content URL); null omits it. */
  resolveImageUrl?: (assetHash: string) => string | null
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const noUrl = (): null => null

/**
 * Builds an SVG document from a scene without touching the DOM. Shapes
 * reuse the scene's rough.js drawables and seeds, so the file is the
 * board as drawn. Fonts are named, not embedded.
 */
export function exportSceneSvg(
  elements: readonly BoardElement[],
  options: SvgExportOptions = {},
): string {
  const {
    background = '#FFFFFF',
    fonts = DEFAULT_FONTS,
    resolveImageUrl = noUrl,
  } = options
  const chosen = selectExportElements(elements, options.ids)
  const bounds = exportBounds(chosen)
  const width = fmt(bounds.width)
  const height = fmt(bounds.height)
  const parts = [
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="${fmt(bounds.x)} ${fmt(bounds.y)} ${width} ${height}">`,
    `<rect x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${width}" height="${height}" fill="${escapeXml(background)}"/>`,
  ]
  for (const element of chosen) {
    if (element.opacity === 0) {
      continue
    }
    const inner = elementSvg(element, fonts, resolveImageUrl)
    if (inner === '') {
      continue
    }
    const opacity =
      element.opacity === 1 ? '' : ` opacity="${fmt(element.opacity)}"`
    parts.push(`<g transform="${transformOf(element)}"${opacity}>${inner}</g>`)
  }
  parts.push('</svg>')
  return parts.join('\n')
}

/** Two decimals, no trailing zeros: stable snapshots, small files. */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Same pivot as the canvas renderer: rotate around the frame center. */
function transformOf(element: BoardElement): string {
  if (element.angle === 0) {
    return `translate(${fmt(element.x)} ${fmt(element.y)})`
  }
  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  const degrees = (element.angle * 180) / Math.PI
  return `translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(degrees)}) translate(${fmt(-element.width / 2)} ${fmt(-element.height / 2)})`
}

function elementSvg(
  element: BoardElement,
  fonts: FontConfig,
  resolveImageUrl: (assetHash: string) => string | null,
): string {
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'line':
    case 'arrow': {
      const dash =
        element.strokeStyle === 'dashed'
          ? ` stroke-dasharray="${dashPattern(element.strokeWidth).map(fmt).join(' ')}"`
          : ''
      return getShapeSvgPaths(element)
        .map((path) => {
          const stroked = path.stroke !== 'none'
          return `<path d="${path.d}" fill="${escapeXml(path.fill ?? 'none')}" stroke="${escapeXml(path.stroke)}" stroke-width="${fmt(path.strokeWidth)}"${stroked ? dash : ''}/>`
        })
        .join('')
    }
    case 'draw': {
      const d = getFreehandPath(element)
      return d === ''
        ? ''
        : `<path d="${d}" fill="${escapeXml(element.strokeColor)}"/>`
    }
    case 'text':
      return textSvg(element, fonts)
    case 'image':
      return imageSvg(element, resolveImageUrl)
  }
}

const TEXT_ANCHORS = { left: 'start', center: 'middle', right: 'end' } as const

function textSvg(element: TextElement, fonts: FontConfig): string {
  const anchorX = fmt(textAnchorX(element))
  const family = escapeXml(fonts[element.fontFamily])
  const fill = escapeXml(element.strokeColor)
  return textLines(element)
    .map(
      (line, row) =>
        `<text x="${anchorX}" y="${fmt(row * element.fontSize * LINE_HEIGHT)}" font-family="${family}" font-size="${fmt(element.fontSize)}" fill="${fill}" text-anchor="${TEXT_ANCHORS[element.textAlign]}" dominant-baseline="text-before-edge">${escapeXml(line)}</text>`,
    )
    .join('')
}

function imageSvg(
  element: ImageElement,
  resolveImageUrl: (assetHash: string) => string | null,
): string {
  const url = resolveImageUrl(element.assetHash)
  if (url === null) {
    return ''
  }
  return `<image href="${escapeXml(url)}" width="${fmt(element.width)}" height="${fmt(element.height)}" preserveAspectRatio="none"/>`
}
