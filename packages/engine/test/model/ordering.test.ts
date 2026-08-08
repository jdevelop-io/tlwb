import { describe, expect, it } from 'vitest'
import {
  firstIndex,
  indexAfter,
  indexBetween,
  sortByIndex,
} from '../../src/model/ordering'

describe('fractional ordering', () => {
  it('generates a first index', () => {
    expect(firstIndex().length).toBeGreaterThan(0)
  })

  it('generates increasing indexes with indexAfter', () => {
    const a = firstIndex()
    const b = indexAfter(a)
    const c = indexAfter(b)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  it('generates an index strictly between two indexes', () => {
    const a = firstIndex()
    const b = indexAfter(a)
    const mid = indexBetween(a, b)
    expect(a < mid).toBe(true)
    expect(mid < b).toBe(true)
  })

  it('keeps order stable across repeated midpoint insertions', () => {
    let low = firstIndex()
    const high = indexAfter(low)
    const generated = [low, high]
    for (let i = 0; i < 50; i++) {
      const mid = indexBetween(low, high)
      generated.push(mid)
      low = mid
    }
    const midpoints = generated.slice(2)
    expect([...midpoints].sort()).toEqual(midpoints)
    expect(midpoints.every((midpoint) => midpoint < high)).toBe(true)
    expect(new Set(generated).size).toBe(generated.length)
  })

  it('sorts items by index without mutating the input', () => {
    const items = [{ index: 'a2' }, { index: 'a0' }, { index: 'a1' }]
    const sorted = sortByIndex(items)
    expect(sorted.map((item) => item.index)).toEqual(['a0', 'a1', 'a2'])
    expect(items[0]?.index).toBe('a2')
  })
})
