import type { Point } from '../model/element'

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lengthSquared = abx * abx + aby * aby
  if (lengthSquared === 0) {
    return distance(point, a)
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared,
    ),
  )
  return distance(point, { x: a.x + t * abx, y: a.y + t * aby })
}

/** Ray-casting test; points exactly on an edge are not guaranteed either way. */
export function pointInPolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i] as Point
    const pj = polygon[j] as Point
    if (
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x
    ) {
      inside = !inside
    }
  }
  return inside
}

export function segmentsIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): Point | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y
  const denominator = d1x * d2y - d1y * d2x
  if (denominator === 0) {
    return null
  }
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denominator
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return null
  }
  return { x: p1.x + t * d1x, y: p1.y + t * d1y }
}

export interface LinearFrame {
  x: number
  y: number
  width: number
  height: number
  points: Point[]
}

/**
 * Rebuilds a linear element frame from points in world coordinates:
 * origin at the top-left of the points, points made relative to it,
 * width and height enclosing them. Keeping this invariant is what makes
 * the element frame a valid culling box for the renderer.
 */
export function normalizeLinearPoints(
  worldPoints: readonly Point[],
): LinearFrame {
  if (worldPoints.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0, points: [] }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of worldPoints) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: worldPoints.map((point) => ({
      x: point.x - minX,
      y: point.y - minY,
    })),
  }
}
