import { describe, expect, it } from 'vitest'
import { generateKey, hashKey, resolveRole } from '../src/keys'

describe('keys', () => {
  it('generates distinct base64url keys of 32 bytes', () => {
    const a = generateKey()
    const b = generateKey()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(a, 'base64url')).toHaveLength(32)
  })

  it('hashes deterministically to 32 bytes', () => {
    const key = generateKey()
    expect(hashKey(key)).toHaveLength(32)
    expect(hashKey(key).equals(hashKey(key))).toBe(true)
    expect(hashKey(key).equals(hashKey(generateKey()))).toBe(false)
  })

  it('resolves the role from the presented token', () => {
    const editKey = generateKey()
    const viewKey = generateKey()
    const hashes = {
      editKeyHash: hashKey(editKey),
      viewKeyHash: hashKey(viewKey),
    }
    expect(resolveRole(editKey, hashes)).toBe('edit')
    expect(resolveRole(viewKey, hashes)).toBe('view')
    expect(resolveRole(generateKey(), hashes)).toBeNull()
    expect(resolveRole('', hashes)).toBeNull()
  })

  it('does not throw when hash length mismatches', () => {
    const token = generateKey()
    const hashes = {
      editKeyHash: new Uint8Array(16),
      viewKeyHash: new Uint8Array(64),
    }
    expect(resolveRole(token, hashes)).toBeNull()
  })

  it('hashes empty string to 32 bytes', () => {
    expect(hashKey('')).toHaveLength(32)
  })
})
