import { describe, expect, it } from 'vitest'
import { relativeTime } from '../../src/dashboard/relative-time'

const now = Date.parse('2026-09-23T12:00:00Z')
const at = (ms: number) => new Date(now - ms).toISOString()

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

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

  it('sits exactly on the bucket boundaries', () => {
    // just now <-> minutes
    expect(relativeTime(at(MINUTE - 1), now)).toBe('just now')
    expect(relativeTime(at(MINUTE), now)).toBe('1m ago')
    // minutes <-> hours
    expect(relativeTime(at(HOUR - 1), now)).toBe('59m ago')
    expect(relativeTime(at(HOUR), now)).toBe('1h ago')
    // hours <-> yesterday
    expect(relativeTime(at(DAY - 1), now)).toBe('23h ago')
    expect(relativeTime(at(DAY), now)).toBe('yesterday')
    // exactly a week: floor(7 / 7) === 1, same bucket as "last week"
    expect(relativeTime(at(7 * DAY), now)).toBe('last week')
    // day 13 still floors to 1 week; day 14 is the first exact "2 weeks"
    expect(relativeTime(at(13 * DAY), now)).toBe('last week')
    expect(relativeTime(at(14 * DAY), now)).toBe('2 weeks ago')
    // exactly 30 days: the days<30 guard closes, floor(30/30) === 1 month
    expect(relativeTime(at(30 * DAY), now)).toBe('last month')
    // exactly 365 days: the days<365 guard closes, floor(365/365) === 1 year
    expect(relativeTime(at(365 * DAY), now)).toBe('last year')
  })
})
