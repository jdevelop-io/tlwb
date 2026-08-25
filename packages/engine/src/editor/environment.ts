import { defaultRequestFrame, type FrameRequester } from '../render/schedule'

/**
 * Everything the editor needs from the browser, behind one seam. The
 * defaults reach for the DOM; tests hand in fakes. Nothing else in the
 * engine touches `document` or `window`.
 */
export interface EditorEnvironment {
  createCanvas(): HTMLCanvasElement
  /** Reports the container's CSS size now and after every change. */
  observeSize(
    container: HTMLElement,
    callback: (width: number, height: number) => void,
  ): () => void
  /** Reports each change of the device pixel ratio (monitor switch). */
  observePixelRatio(callback: (ratio: number) => void): () => void
  getPixelRatio(): number
  /** Where keyboard events are listened to; `window` in a browser. */
  keyboardTarget: EventTarget
  requestFrame: FrameRequester
}

export function resolveEnvironment(
  overrides: Partial<EditorEnvironment> = {},
): EditorEnvironment {
  return {
    createCanvas: () => document.createElement('canvas'),
    observeSize: observeSizeWithResizeObserver,
    observePixelRatio: observePixelRatioWithMatchMedia,
    getPixelRatio: () => window.devicePixelRatio || 1,
    // `globalThis` is `window` in a browser; tests always override it.
    keyboardTarget: globalThis as unknown as EventTarget,
    requestFrame: defaultRequestFrame,
    ...overrides,
  }
}

function observeSizeWithResizeObserver(
  container: HTMLElement,
  callback: (width: number, height: number) => void,
): () => void {
  const report = (): void => {
    const rect = container.getBoundingClientRect()
    callback(rect.width, rect.height)
  }
  report()
  const observer = new ResizeObserver(() => report())
  observer.observe(container)
  return () => observer.disconnect()
}

/**
 * A media query matching the current ratio fires once when the window
 * moves to a screen with another ratio; it is re-armed for the new one.
 */
function observePixelRatioWithMatchMedia(
  callback: (ratio: number) => void,
): () => void {
  let query: MediaQueryList | null = null
  let stopped = false
  const onChange = (): void => {
    callback(window.devicePixelRatio || 1)
    arm()
  }
  const arm = (): void => {
    if (stopped) {
      return
    }
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    query.addEventListener('change', onChange, { once: true })
  }
  arm()
  return () => {
    stopped = true
    query?.removeEventListener('change', onChange)
  }
}
