import { describe, expect, it } from 'vitest'
import {
  distance,
  distanceToSegment,
  normalizeLinearPoints,
  pointInPolygon,
  segmentsIntersection,
} from '../../src/geometry/points'

describe('distance', () => {
  it('measures the euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('distanceToSegment', () => {
  it('projects onto the segment interior', () => {
    const d = distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(d).toBe(3)
  })

  it('clamps to the nearest endpoint beyond the segment', () => {
    const d = distanceToSegment(
      { x: 13, y: 4 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    )
    expect(d).toBe(5)
  })

  it('degenerates to point distance on a zero-length segment', () => {
    const d = distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })
    expect(d).toBe(5)
  })
})

describe('pointInPolygon', () => {
  const diamond = [
    { x: 5, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 10 },
    { x: 0, y: 5 },
  ]

  it('accepts an interior point', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, diamond)).toBe(true)
  })

  it('rejects a bounding-box corner outside the polygon', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, diamond)).toBe(false)
  })
})

describe('segmentsIntersection', () => {
  it('returns the crossing point of two segments', () => {
    const hit = segmentsIntersection(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    )
    expect(hit).toEqual({ x: 5, y: 5 })
  })

  it('returns null when the segments do not cross', () => {
    const hit = segmentsIntersection(
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    )
    expect(hit).toBeNull()
  })
})

describe('normalizeLinearPoints', () => {
  it('anchors the frame at the top-left of the points', () => {
    const frame = normalizeLinearPoints([
      { x: 30, y: 50 },
      { x: 10, y: 90 },
    ])
    expect(frame).toEqual({
      x: 10,
      y: 50,
      width: 20,
      height: 40,
      points: [
        { x: 20, y: 0 },
        { x: 0, y: 40 },
      ],
    })
  })

  it('returns an empty frame for no points', () => {
    expect(normalizeLinearPoints([])).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [],
    })
  })
})
