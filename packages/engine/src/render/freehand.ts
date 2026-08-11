import { getStroke } from 'perfect-freehand'
import type { DrawElement } from '../model/element'

const cache = new WeakMap<DrawElement, string>()

/**
 * SVG path of the filled stroke outline, in element-local coordinates.
 * Pressure is simulated from point spacing, so the same points always
 * produce the same outline on every client.
 */
export function getFreehandPath(element: DrawElement): string {
  const cached = cache.get(element)
  if (cached !== undefined) {
    return cached
  }
  const outline = getStroke(
    element.points.map((point) => [point.x, point.y]),
    {
      size: element.strokeWidth * 4,
      thinning: 0.6,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: true,
      last: true,
    },
  )
  const path = svgPathFromOutline(outline)
  cache.set(element, path)
  return path
}

function svgPathFromOutline(outline: number[][]): string {
  if (outline.length < 3) {
    return ''
  }
  const segments = outline.map((point) => `${point[0]},${point[1]}`)
  return `M${segments[0]}L${segments.slice(1).join(' ')}Z`
}
