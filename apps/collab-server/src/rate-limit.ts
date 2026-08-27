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

export interface IpLimiter {
  /** True when the address still had a token; consumes it. */
  take(ip: string): boolean
}

const MAX_TRACKED_IPS = 10_000

/** One token bucket per address, swept when the table grows large. */
export function createIpLimiter(
  capacity: number,
  windowMs: number,
  now: () => number = Date.now,
): IpLimiter {
  let entries = new Map<string, BucketEntry>()
  return {
    take(ip) {
      const nowMs = now()
      if (entries.size > MAX_TRACKED_IPS) {
        // ponytail: sweeps only entries idle past the window, so an
        // address currently limited keeps its state. Remaining ceiling:
        // more than MAX_TRACKED_IPS distinct addresses all active within
        // one window still grow the map; a proper LRU is the upgrade.
        entries = sweepStale(entries, nowMs, windowMs)
      }
      let entry = entries.get(ip)
      if (!entry) {
        entry = {
          bucket: createTokenBucket(capacity, windowMs, now),
          seen: nowMs,
        }
        entries.set(ip, entry)
      } else {
        entry.seen = nowMs
      }
      return entry.bucket.take()
    },
  }
}
