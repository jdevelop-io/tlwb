import { beforeEach, describe, expect, it } from 'vitest'
import type { Me } from '../../src/auth/client'
import {
  identityFor,
  loadIdentity,
  saveIdentity,
} from '../../src/board/session/identity'
import { STROKE_COLORS } from '../../src/board/session/palette'

beforeEach(() => localStorage.clear())

const me: Me = {
  name: 'Ada Lovelace',
  email: 'ada@x.com',
  image: null,
  plan: 'free',
}

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

describe('identityFor', () => {
  it('keeps the local identity unchanged when signed out', () => {
    const base = { name: 'Curious Otter', color: '#1971C2' }
    expect(identityFor(base, null)).toEqual(base)
  })

  it('uses the account name but keeps the local color when signed in', () => {
    const base = { name: 'Curious Otter', color: '#1971C2' }
    expect(identityFor(base, me)).toEqual({
      name: 'Ada Lovelace',
      color: '#1971C2',
    })
  })
})
