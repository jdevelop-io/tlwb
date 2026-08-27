import { describe, expect, it } from 'vitest'
import {
  createIpLimiter,
  createTokenBucket,
  sweepStale,
} from '../src/rate-limit'

describe('createTokenBucket', () => {
  it('allows the burst, refuses when empty, refills over time', () => {
    let clock = 0
    const bucket = createTokenBucket(3, 3_000, () => clock)
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
    ])
    expect(bucket.take()).toBe(false)
    clock = 1_000
    expect(bucket.take()).toBe(true)
    expect(bucket.take()).toBe(false)
    clock = 10_000
    expect([
      bucket.take(),
      bucket.take(),
      bucket.take(),
      bucket.take(),
    ]).toEqual([true, true, true, false])
  })
})

describe('sweepStale', () => {
  it('drops entries older than the window and keeps fresher ones', () => {
    const entries = new Map([
      ['stale-ip', { bucket: createTokenBucket(1, 1_000), seen: 0 }],
      ['fresh-ip', { bucket: createTokenBucket(1, 1_000), seen: 8_000 }],
    ])
    const swept = sweepStale(entries, 10_000, 5_000)
    expect(swept.has('stale-ip')).toBe(false)
    expect(swept.has('fresh-ip')).toBe(true)
  })
})

describe('createIpLimiter', () => {
  it('gives every address its own bucket', () => {
    let now = 0
    const limiter = createIpLimiter(2, 60_000, () => now)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
    expect(limiter.take('b')).toBe(true)
    now = 60_000
    expect(limiter.take('a')).toBe(true)
  })
})
