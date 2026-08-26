import { describe, expect, it } from 'vitest'
import { exportBounds, selectExportElements } from '../../src/export/bounds'
import { createElement } from '../../src/model/create'

const a = createElement('rectangle', {
  id: 'a',
  index: 'a0',
  x: 10,
  y: 20,
  width: 100,
  height: 50,
})
const b = createElement('ellipse', {
  id: 'b',
  index: 'a1',
  x: 200,
  y: 0,
  width: 40,
  height: 40,
})

describe('selectExportElements', () => {
  it('returns everything for an absent or empty id list', () => {
    expect(selectExportElements([a, b])).toEqual([a, b])
    expect(selectExportElements([a, b], [])).toEqual([a, b])
  })

  it('keeps only the listed ids, in scene order', () => {
    expect(selectExportElements([a, b], ['b', 'a', 'zzz'])).toEqual([a, b])
    expect(selectExportElements([a, b], ['b'])).toEqual([b])
  })
})

describe('exportBounds', () => {
  it('wraps the union of the elements with the margin', () => {
    expect(exportBounds([a, b])).toEqual({
      x: -6,
      y: -16,
      width: 262,
      height: 102,
    })
  })

  it('falls back to a one by one rect for an empty scene', () => {
    expect(exportBounds([])).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})
