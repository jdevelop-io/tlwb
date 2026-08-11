import { describe, expect, it } from 'vitest'
import { snapMovedBounds } from '../../src/geometry/snap'

const other = { x: 100, y: 100, width: 100, height: 100 }

describe('snapMovedBounds', () => {
  it('snaps a nearby left edge and reports a vertical guide', () => {
    const moving = { x: 103, y: 300, width: 50, height: 50 }
    const result = snapMovedBounds(moving, [other], 8)
    expect(result.dx).toBe(-3)
    expect(result.dy).toBe(0)
    expect(result.guides).toEqual([{ orientation: 'vertical', position: 100 }])
  })

  it('snaps centers on both axes at once', () => {
    const moving = { x: 127, y: 122, width: 50, height: 50 }
    const result = snapMovedBounds(moving, [other], 8)
    expect(result.dx).toBe(-2)
    expect(result.dy).toBe(3)
    expect(result.guides).toHaveLength(2)
  })

  it('prefers the smallest correction', () => {
    const near = { x: 200, y: 0, width: 10, height: 10 }
    const moving = { x: 104, y: 300, width: 98, height: 50 }
    // Left edge is 4 away from other's left; right edge is 2 away from near's left.
    const result = snapMovedBounds(moving, [other, near], 8)
    expect(result.dx).toBe(-2)
  })

  it('returns zero and no guides beyond the threshold', () => {
    const moving = { x: 500, y: 500, width: 50, height: 50 }
    expect(snapMovedBounds(moving, [other], 8)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    })
  })
})
