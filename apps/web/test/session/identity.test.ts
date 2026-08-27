import { beforeEach, describe, expect, it } from 'vitest'
import { loadIdentity, saveIdentity } from '../../src/board/session/identity'
import { STROKE_COLORS } from '../../src/board/session/palette'

beforeEach(() => localStorage.clear())

describe('identity', () => {
  it('draws a name and a marker color once and keeps them', () => {
    const first = loadIdentity(localStorage, () => 0)
    expect(first.name).toBe('Curious Otter')
    expect(STROKE_COLORS.slice(1)).toContain(first.color)
    expect(loadIdentity(localStorage, () => 0.99)).toEqual(first)
  })

  it('saves a renamed identity', () => {
    loadIdentity()
    saveIdentity({ name: 'Ada', color: '#1971C2' })
    expect(loadIdentity()).toEqual({ name: 'Ada', color: '#1971C2' })
  })
})
