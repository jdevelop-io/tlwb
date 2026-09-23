import { describe, expect, it } from 'vitest'
import { relativeTime } from '../../src/dashboard/relative-time'

const now = Date.parse('2026-09-23T12:00:00Z')
const at = (ms: number) => new Date(now - ms).toISOString()

describe('relativeTime', () => {
  it('rounds down to the artboard vocabulary', () => {
    expect(relativeTime(at(20_000), now)).toBe('just now')
    expect(relativeTime(at(5 * 60_000), now)).toBe('5m ago')
    expect(relativeTime(at(2 * 3_600_000), now)).toBe('2h ago')
    expect(relativeTime(at(26 * 3_600_000), now)).toBe('yesterday')
    expect(relativeTime(at(3 * 86_400_000), now)).toBe('3 days ago')
    expect(relativeTime(at(8 * 86_400_000), now)).toBe('last week')
    expect(relativeTime(at(15 * 86_400_000), now)).toBe('2 weeks ago')
    expect(relativeTime(at(35 * 86_400_000), now)).toBe('last month')
    expect(relativeTime(at(100 * 86_400_000), now)).toBe('3 months ago')
    expect(relativeTime(at(400 * 86_400_000), now)).toBe('last year')
  })
})
