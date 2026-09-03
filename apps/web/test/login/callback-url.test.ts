import { describe, expect, it } from 'vitest'
import { resolveCallbackURL } from '../../src/login/callback-url'

describe('resolveCallbackURL', () => {
  it('accepts a same-document path', () => {
    expect(resolveCallbackURL('/b/abc123')).toBe('/b/abc123')
  })

  it('falls back to /dashboard when absent', () => {
    expect(resolveCallbackURL(null)).toBe('/dashboard')
  })

  it('falls back to /dashboard for an empty value', () => {
    expect(resolveCallbackURL('')).toBe('/dashboard')
  })

  it('rejects a scheme-relative target', () => {
    expect(resolveCallbackURL('//evil.example.com')).toBe('/dashboard')
    expect(resolveCallbackURL('//evil.example.com/path')).toBe('/dashboard')
  })

  it('rejects an absolute URL', () => {
    expect(resolveCallbackURL('https://evil.example.com')).toBe('/dashboard')
  })

  it('rejects a value with no leading slash', () => {
    expect(resolveCallbackURL('dashboard')).toBe('/dashboard')
  })
})
