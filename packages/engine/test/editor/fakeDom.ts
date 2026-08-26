import { type Canvas, createCanvas } from '@napi-rs/canvas'
import type { EditorEnvironment } from '../../src/editor/environment'

type Listener = (event: FakeEvent) => void

export interface FakeEvent {
  type: string
  target: unknown
  defaultPrevented: boolean
  preventDefault(): void
  [key: string]: unknown
}

type ListenerOptions = AddEventListenerOptions | boolean | undefined

/** The slice of EventTarget the editor binds to, with a dispatcher. */
export class FakeNode {
  readonly listeners = new Map<string, Map<Listener, ListenerOptions>>()

  addEventListener(
    type: string,
    listener: Listener,
    options?: ListenerOptions,
  ): void {
    let map = this.listeners.get(type)
    if (!map) {
      map = new Map()
      this.listeners.set(type, map)
    }
    map.set(listener, options)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  listenerCount(): number {
    let count = 0
    for (const map of this.listeners.values()) {
      count += map.size
    }
    return count
  }

  /**
   * The options each listener of `type` was registered with, so a test
   * can prove a listener is explicitly non-passive.
   */
  listenerOptions(type: string): ListenerOptions[] {
    return [...(this.listeners.get(type)?.values() ?? [])]
  }

  dispatch(type: string, init: Record<string, unknown> = {}): FakeEvent {
    const event: FakeEvent = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true
      },
      ...init,
    }
    for (const listener of [...(this.listeners.get(type)?.keys() ?? [])]) {
      listener(event)
    }
    return event
  }
}

/** A napi canvas wearing the DOM surface the editor touches. */
export class FakeCanvas extends FakeNode {
  readonly napi: Canvas = createCanvas(1, 1)
  readonly style: Record<string, string> = {}
  readonly captured: number[] = []
  /**
   * Bumped whenever something takes this canvas's 2D context, which a
   * painter does at least once per paint (the scene painter twice, as
   * roughjs takes its own). It attributes a frame to a canvas: compare
   * the value across a flush, where unchanged means this canvas was not
   * repainted. Never assert the absolute count.
   */
  paints = 0

  get width(): number {
    return this.napi.width
  }

  set width(value: number) {
    this.napi.width = value
  }

  get height(): number {
    return this.napi.height
  }

  set height(value: number) {
    this.napi.height = value
  }

  getContext(_type: '2d'): CanvasRenderingContext2D {
    this.paints += 1
    return this.napi.getContext('2d') as unknown as CanvasRenderingContext2D
  }

  setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId)
  }

  toBlob(callback: (blob: Blob | null) => void, type = 'image/png'): void {
    callback(
      new Blob([new Uint8Array(this.napi.toBuffer('image/png'))], { type }),
    )
  }

  rgbaAt(x: number, y: number): number[] {
    return Array.from(this.napi.getContext('2d').getImageData(x, y, 1, 1).data)
  }
}

export class FakeContainer extends FakeNode {
  readonly children: FakeCanvas[] = []
  readonly style: Record<string, string> = {}
  rect = { left: 10, top: 20, width: 400, height: 300 }

  appendChild(child: FakeCanvas): void {
    this.children.push(child)
  }

  removeChild(child: FakeCanvas): void {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
    }
  }

  getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.rect
    return {
      left,
      top,
      width,
      height,
      x: left,
      y: top,
      right: left + width,
      bottom: top + height,
    } as DOMRect
  }
}

export interface FakeEnvironment extends EditorEnvironment {
  frames: (() => void)[]
  flush(): void
  keyboard: FakeNode
  resize(width: number, height: number): void
  setPixelRatio(ratio: number): void
}

export function fakeEnvironment(): FakeEnvironment {
  let sizeListener: ((width: number, height: number) => void) | null = null
  let ratioListener: ((ratio: number) => void) | null = null
  let ratio = 1
  const keyboard = new FakeNode()
  const env: FakeEnvironment = {
    frames: [],
    keyboard,
    createCanvas: () => new FakeCanvas() as unknown as HTMLCanvasElement,
    observeSize: (container, callback) => {
      sizeListener = callback
      const { width, height } = (container as unknown as FakeContainer).rect
      callback(width, height)
      return () => {
        sizeListener = null
      }
    },
    observePixelRatio: (callback) => {
      ratioListener = callback
      return () => {
        ratioListener = null
      }
    },
    getPixelRatio: () => ratio,
    getComputedPosition: () => 'static',
    keyboardTarget: keyboard as unknown as EventTarget,
    requestFrame: (callback) => {
      env.frames.push(callback)
    },
    flush: () => {
      for (const frame of env.frames.splice(0)) {
        frame()
      }
    },
    resize: (width, height) => {
      sizeListener?.(width, height)
    },
    setPixelRatio: (next) => {
      ratio = next
      ratioListener?.(next)
    },
  }
  return env
}
