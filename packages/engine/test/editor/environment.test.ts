import { afterEach, describe, expect, it } from 'vitest'
import { resolveEnvironment } from '../../src/editor/environment'

/**
 * `resolveEnvironment` is the one file in the engine allowed to touch
 * `window` and `document`, so it is the one file tests cannot reach with
 * the fake DOM the rest of the suite uses. These tests stand fake
 * globals up around it instead, and cover the logic `tsc` cannot check:
 * the media query that has to be re-armed after every ratio change, the
 * ResizeObserver wiring, and which browser call each default reads.
 */

/** A MediaQueryList that honours `{ once: true }`, as a browser does. */
interface FakeQuery {
  readonly media: string
  addEventListener(
    type: string,
    handler: () => void,
    options?: { once?: boolean },
  ): void
  removeEventListener(type: string, handler: () => void): void
  /** Dispatches 'change' to the handlers still registered. */
  fire(): void
}

function fakeQuery(media: string): FakeQuery {
  const handlers = new Map<() => void, boolean>()
  return {
    media,
    addEventListener: (_type, handler, options) => {
      handlers.set(handler, options?.once === true)
    },
    removeEventListener: (_type, handler) => {
      handlers.delete(handler)
    },
    fire: () => {
      for (const [handler, once] of [...handlers]) {
        if (once) {
          handlers.delete(handler)
        }
        handler()
      }
    },
  }
}

const globals = globalThis as unknown as {
  window?: unknown
  document?: unknown
  ResizeObserver?: unknown
}
const original = {
  window: globals.window,
  document: globals.document,
  ResizeObserver: globals.ResizeObserver,
}

afterEach(() => {
  globals.window = original.window
  globals.document = original.document
  globals.ResizeObserver = original.ResizeObserver
})

describe('resolveEnvironment', () => {
  it('re-arms the pixel ratio query after every change', () => {
    const queries: FakeQuery[] = []
    const window = {
      devicePixelRatio: 1,
      matchMedia: (media: string) => {
        const query = fakeQuery(media)
        queries.push(query)
        return query
      },
    }
    globals.window = window

    const seen: number[] = []
    const stop = resolveEnvironment().observePixelRatio((ratio) => {
      seen.push(ratio)
    })
    expect(queries.map((query) => query.media)).toEqual(['(resolution: 1dppx)'])

    window.devicePixelRatio = 2
    queries[0]?.fire()
    expect(seen).toEqual([2])
    // The first query fired once and is spent: only a query re-armed for
    // the new ratio can report the next change.
    expect(queries.map((query) => query.media)).toEqual([
      '(resolution: 1dppx)',
      '(resolution: 2dppx)',
    ])

    window.devicePixelRatio = 3
    queries[1]?.fire()
    expect(seen).toEqual([2, 3])
    expect(queries).toHaveLength(3)

    stop()
    window.devicePixelRatio = 4
    queries[2]?.fire()
    expect(seen).toEqual([2, 3])
    expect(queries).toHaveLength(3)
  })

  it('reports the container size now and on every resize', () => {
    let observed: unknown = null
    const notify: (() => void)[] = []
    let disconnected = false
    globals.ResizeObserver = class {
      constructor(callback: () => void) {
        notify.push(callback)
      }
      observe(target: unknown): void {
        observed = target
      }
      disconnect(): void {
        disconnected = true
      }
    }
    const container = {
      getBoundingClientRect: () => ({ width: 400, height: 300 }),
    }

    const sizes: [number, number][] = []
    const stop = resolveEnvironment().observeSize(
      container as unknown as HTMLElement,
      (width, height) => {
        sizes.push([width, height])
      },
    )
    expect(sizes).toEqual([[400, 300]])
    expect(observed).toBe(container)

    notify[0]?.()
    expect(sizes).toEqual([
      [400, 300],
      [400, 300],
    ])

    stop()
    expect(disconnected).toBe(true)
  })

  it('reads each default from the browser call it belongs to', () => {
    const canvas = { tag: 'canvas' }
    globals.document = {
      createElement: (tag: string) => (tag === 'canvas' ? canvas : null),
    }
    globals.window = {
      devicePixelRatio: 2,
      getComputedStyle: () => ({ position: 'absolute' }),
    }

    const env = resolveEnvironment()
    expect(env.createCanvas()).toBe(canvas)
    expect(env.getPixelRatio()).toBe(2)
    expect(env.getComputedPosition({} as HTMLElement)).toBe('absolute')
  })
})
