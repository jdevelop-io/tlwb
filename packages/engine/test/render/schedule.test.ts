import { describe, expect, it } from 'vitest'
import { createFrameScheduler } from '../../src/render/schedule'

function harness() {
  const frames: (() => void)[] = []
  let paints = 0
  const scheduler = createFrameScheduler(
    () => {
      paints += 1
    },
    (callback) => {
      frames.push(callback)
    },
  )
  const flush = () => {
    for (const frame of frames.splice(0)) {
      frame()
    }
  }
  return { frames, flush, scheduler, paints: () => paints }
}

describe('createFrameScheduler', () => {
  it('schedules nothing until marked dirty', () => {
    const { frames } = harness()
    expect(frames).toHaveLength(0)
  })

  it('coalesces marks into one pending frame and paints once', () => {
    const { frames, flush, scheduler, paints } = harness()
    scheduler.markDirty()
    scheduler.markDirty()
    scheduler.markDirty()
    expect(frames).toHaveLength(1)
    flush()
    expect(paints()).toBe(1)
    scheduler.markDirty()
    expect(frames).toHaveLength(1)
  })

  it('never paints after destroy, even for a frame already pending', () => {
    const { flush, scheduler, paints, frames } = harness()
    scheduler.markDirty()
    scheduler.destroy()
    flush()
    scheduler.markDirty()
    expect(paints()).toBe(0)
    expect(frames).toHaveLength(0)
  })
})
