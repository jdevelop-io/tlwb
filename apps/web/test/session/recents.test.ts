import { beforeEach, describe, expect, it } from 'vitest'
import {
  listRecents,
  RECENTS_CAP,
  removeRecent,
  touchRecent,
} from '../../src/board/session/recents'

beforeEach(() => localStorage.clear())

describe('recents', () => {
  it('upserts by id and orders most recent first', () => {
    touchRecent({ id: 'a', name: 'A', updatedAt: 1 })
    touchRecent({ id: 'b', name: 'B', updatedAt: 2 })
    touchRecent({ id: 'a', name: 'A2', updatedAt: 3 })
    expect(listRecents()).toEqual([
      { id: 'a', name: 'A2', updatedAt: 3 },
      { id: 'b', name: 'B', updatedAt: 2 },
    ])
  })

  it('caps the list and removes entries', () => {
    for (let i = 0; i <= RECENTS_CAP; i += 1) {
      touchRecent({ id: `b${i}`, name: 'x', updatedAt: i })
    }
    expect(listRecents()).toHaveLength(RECENTS_CAP)
    expect(listRecents()[0]?.id).toBe(`b${RECENTS_CAP}`)
    removeRecent(`b${RECENTS_CAP}`)
    expect(listRecents()[0]?.id).toBe(`b${RECENTS_CAP - 1}`)
  })

  it('survives a corrupt entry', () => {
    localStorage.setItem('tlwb:recents', '[{"id":1}]')
    expect(listRecents()).toEqual([])
  })
})
