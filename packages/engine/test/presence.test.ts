import { describe, expect, it } from 'vitest'
import { sanitizePeers } from '../src/presence'

const good = {
  id: 'p1',
  name: 'Ada',
  color: '#00AA00',
  cursor: { x: 10, y: 20 },
  selectedIds: ['a'],
  isAgent: false,
}

describe('sanitizePeers', () => {
  it('keeps well-formed peers as they are', () => {
    expect(sanitizePeers([good])).toEqual([good])
  })

  it('drops peers with missing fields or a non-finite cursor', () => {
    expect(
      sanitizePeers([
        { ...good, cursor: { x: Number.NaN, y: 0 } },
        { ...good, name: undefined },
        null,
        'nope',
        { ...good, id: 'ok', cursor: null },
      ]),
    ).toEqual([{ ...good, id: 'ok', cursor: null }])
  })
})
