import type { Drawable, Options } from 'roughjs/bin/core'
import { RoughGenerator } from 'roughjs/bin/generator'
import type {
  ArrowElement,
  DiamondElement,
  EllipseElement,
  LineElement,
  RectangleElement,
} from '../model/element'

export type SketchyElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | LineElement
  | ArrowElement

const ARROWHEAD_ANGLE = Math.PI / 6

const generator = new RoughGenerator()
const cache = new WeakMap<SketchyElement, Drawable[]>()

/**
 * Drawables for a sketchy element, in element-local coordinates. Cached
 * on the element object: stores freeze elements and replace them on
 * every update, so identity is a valid cache key.
 */
export function getShapeDrawables(element: SketchyElement): Drawable[] {
  const cached = cache.get(element)
  if (cached) {
    return cached
  }
  const drawables = buildDrawables(element)
  cache.set(element, drawables)
  return drawables
}

function buildDrawables(element: SketchyElement): Drawable[] {
  const options = baseOptions(element)
  switch (element.type) {
    case 'rectangle':
      return [generator.rectangle(0, 0, element.width, element.height, options)]
    case 'ellipse':
      return [
        generator.ellipse(
          element.width / 2,
          element.height / 2,
          element.width,
          element.height,
          options,
        ),
      ]
    case 'diamond': {
      const { width, height } = element
      return [
        generator.polygon(
          [
            [width / 2, 0],
            [width, height / 2],
            [width / 2, height],
            [0, height / 2],
          ],
          options,
        ),
      ]
    }
    case 'line': {
      if (element.points.length < 2) {
        return []
      }
      return [
        generator.linearPath(
          element.points.map((point) => [point.x, point.y]),
          options,
        ),
      ]
    }
    case 'arrow':
      return arrowDrawables(element, options)
  }
}

function baseOptions(element: SketchyElement): Options {
  const options: Options = {
    seed: Math.max(1, element.seed),
    roughness: element.sketchiness,
    stroke: element.strokeColor,
    strokeWidth: element.strokeWidth,
  }
  if (element.strokeStyle === 'dashed') {
    options.strokeLineDash = [element.strokeWidth * 4, element.strokeWidth * 4]
  }
  if (element.fillColor) {
    options.fill = element.fillColor
    options.fillStyle = 'solid'
  }
  return options
}

function arrowDrawables(element: ArrowElement, options: Options): Drawable[] {
  const points = element.points
  const tip = points.at(-1)
  const beforeTip = points.at(-2)
  if (!tip || !beforeTip) {
    return []
  }
  const shaft =
    points.length === 2
      ? generator.line(beforeTip.x, beforeTip.y, tip.x, tip.y, options)
      : generator.curve(
          points.map((point): [number, number] => [point.x, point.y]),
          options,
        )
  const direction = Math.atan2(tip.y - beforeTip.y, tip.x - beforeTip.x)
  const size = element.strokeWidth * 4 + 8
  const wings = [-1, 1].map((side) =>
    generator.line(
      tip.x,
      tip.y,
      tip.x - size * Math.cos(direction + side * ARROWHEAD_ANGLE),
      tip.y - size * Math.sin(direction + side * ARROWHEAD_ANGLE),
      options,
    ),
  )
  return [shaft, ...wings]
}
