export interface TokenBucket {
  /** True when a token was available and consumed. */
  take(): boolean
}

export interface BucketEntry {
  bucket: TokenBucket
  /** Timestamp (from the same clock as `now`) this entry was last touched. */
  seen: number
}

/**
 * Drops entries last touched before `now - olderThanMs`: an entry idle
 * that long has already refilled its bucket to capacity, so forgetting
 * it is equivalent to keeping it. Returns a new map; does not mutate
 * `entries`.
 */
export function sweepStale(
  entries: Map<string, BucketEntry>,
  now: number,
  olderThanMs: number,
): Map<string, BucketEntry> {
  const fresh = new Map<string, BucketEntry>()
  for (const [key, entry] of entries) {
    if (now - entry.seen < olderThanMs) {
      fresh.set(key, entry)
    }
  }
  return fresh
}

/** `capacity` tokens, refilled continuously over `refillMs`. */
export function createTokenBucket(
  capacity: number,
  refillMs: number,
  now: () => number = Date.now,
): TokenBucket {
  let tokens = capacity
  let last = now()
  return {
    take() {
      const current = now()
      tokens = Math.min(
        capacity,
        tokens + ((current - last) * capacity) / refillMs,
      )
      last = current
      if (tokens < 1) {
        return false
      }
      tokens -= 1
      return true
    },
  }
}
