import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAliasesTo,
  clearKeys,
  keysFromFragment,
  readAlias,
  readKeys,
  roleOf,
  shareLink,
  tokenOf,
  writeAlias,
  writeKeys,
} from '../../src/board/session/keys'

beforeEach(() => localStorage.clear())

describe('keys', () => {
  it('round-trips through localStorage', () => {
    expect(readKeys('b1')).toBeNull()
    writeKeys('b1', { editKey: 'e', viewKey: 'v' })
    expect(readKeys('b1')).toEqual({ editKey: 'e', viewKey: 'v' })
    clearKeys('b1')
    expect(readKeys('b1')).toBeNull()
  })

  it('ignores a corrupt entry', () => {
    localStorage.setItem('tlwb:keys:b1', '{nope')
    expect(readKeys('b1')).toBeNull()
  })

  it('derives the role and the token', () => {
    expect(roleOf(null)).toBe('local')
    expect(roleOf({ viewKey: 'v' })).toBe('view')
    expect(roleOf({ editKey: 'e', viewKey: 'v' })).toBe('edit')
    expect(tokenOf({ editKey: 'e', viewKey: 'v' })).toBe('e')
    expect(tokenOf({ viewKey: 'v' })).toBe('v')
    expect(tokenOf({})).toBeNull()
  })

  it('reads a key from the fragment', () => {
    expect(keysFromFragment('#edit=abc')).toEqual({ editKey: 'abc' })
    expect(keysFromFragment('#view=abc')).toEqual({ viewKey: 'abc' })
    expect(keysFromFragment('#other=abc')).toBeNull()
    expect(keysFromFragment('')).toBeNull()
  })

  it('builds share links only for the keys it holds', () => {
    const keys = { editKey: 'e', viewKey: 'v' }
    expect(shareLink('https://x', 'b1', keys, 'edit')).toBe(
      'https://x/b/b1#edit=e',
    )
    expect(shareLink('https://x', 'b1', keys, 'view')).toBe(
      'https://x/b/b1#view=v',
    )
    expect(shareLink('https://x', 'b1', { editKey: 'e' }, 'view')).toBeNull()
  })

  it('stores aliases and clears every alias to a board', () => {
    writeAlias('old1', 'new')
    writeAlias('old2', 'new')
    writeAlias('old3', 'other')
    expect(readAlias('old1')).toBe('new')
    clearAliasesTo('new')
    expect(readAlias('old1')).toBeNull()
    expect(readAlias('old2')).toBeNull()
    expect(readAlias('old3')).toBe('other')
  })
})
