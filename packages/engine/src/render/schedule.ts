export type FrameRequester = (callback: () => void) => void

export const defaultRequestFrame: FrameRequester = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback())
  } else {
    setTimeout(callback, 16)
  }
}

export interface FrameScheduler {
  markDirty(): void
  destroy(): void
}

/**
 * Invalidation loop: `markDirty` requests at most one frame, and the
 * frame paints once however many marks preceded it. There is no
 * continuous loop; an idle layer costs nothing. The scene renderer and
 * the overlay each own one, so they invalidate independently.
 */
export function createFrameScheduler(
  paint: () => void,
  requestFrame: FrameRequester = defaultRequestFrame,
): FrameScheduler {
  let dirty = false
  let destroyed = false
  return {
    markDirty: () => {
      if (dirty || destroyed) {
        return
      }
      dirty = true
      requestFrame(() => {
        dirty = false
        if (destroyed) {
          return
        }
        paint()
      })
    },
    destroy: () => {
      destroyed = true
    },
  }
}
