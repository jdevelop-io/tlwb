import { createEditor } from '../../src/editor/editor'
import type { Editor, EditorOptions } from '../../src/editor/types'
import { InMemoryBoardStore } from '../../src/store/memory'
import {
  type FakeCanvas,
  FakeContainer,
  type FakeEnvironment,
  type FakeEvent,
  fakeEnvironment,
} from './fakeDom'

export interface Mounted {
  editor: Editor
  store: InMemoryBoardStore
  container: FakeContainer
  env: FakeEnvironment
  scene: FakeCanvas
  overlay: FakeCanvas
  /** Dispatches a pointer event at container-relative CSS pixels. */
  pointer(
    type: string,
    x: number,
    y: number,
    init?: Record<string, unknown>,
  ): FakeEvent
  key(
    type: 'keydown' | 'keyup',
    key: string,
    init?: Record<string, unknown>,
  ): FakeEvent
  flush(): void
}

/** Container at (10, 20), 400 by 300 CSS pixels, pixel ratio 1. */
export function mountEditor(
  options: Partial<Omit<EditorOptions, 'container' | 'store'>> = {},
): Mounted {
  const store = new InMemoryBoardStore()
  const container = new FakeContainer()
  const env = fakeEnvironment()
  const editor = createEditor({
    container: container as unknown as HTMLElement,
    store,
    environment: env,
    fonts: { hand: 'Caveat', ui: 'Caveat' },
    ...options,
  })
  const [scene, overlay] = container.children
  if (!scene || !overlay) {
    throw new Error('createEditor did not mount two canvases')
  }
  return {
    editor,
    store,
    container,
    env,
    scene,
    overlay,
    pointer: (type, x, y, init = {}) =>
      overlay.dispatch(type, {
        clientX: x + container.rect.left,
        clientY: y + container.rect.top,
        button: 0,
        buttons: 1,
        pointerId: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        deltaX: 0,
        deltaY: 0,
        ...init,
      }),
    key: (type, key, init = {}) =>
      env.keyboard.dispatch(type, {
        key,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        target: null,
        ...init,
      }),
    flush: env.flush,
  }
}
