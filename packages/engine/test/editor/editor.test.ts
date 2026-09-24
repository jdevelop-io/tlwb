import { describe, expect, it, vi } from 'vitest'
import { MAX_ZOOM } from '../../src/camera'
import { createEditor } from '../../src/editor/editor'
import { createElement } from '../../src/model/create'
import { InMemoryBoardStore } from '../../src/store/memory'
import { FakeCanvas, FakeContainer, fakeEnvironment } from './fakeDom'
import { mountEditor } from './harness'

const box = (id: string, x: number, y: number) =>
  createElement('rectangle', {
    id,
    index: `a${id}`,
    seed: 1,
    x,
    y,
    width: 50,
    height: 50,
  })

describe('createEditor mounting', () => {
  it('appends a scene and an overlay canvas sized from the container', () => {
    const { container, scene, overlay, flush } = mountEditor()
    expect(container.children).toHaveLength(2)
    expect(container.style.position).toBe('relative')
    expect(scene.style.position).toBe('absolute')
    expect(overlay.style.touchAction).toBe('none')
    flush()
    expect(scene.width).toBe(400)
    expect(scene.height).toBe(300)
    expect(overlay.width).toBe(400)
  })

  it('follows container resizes and pixel ratio changes', () => {
    const { scene, overlay, env, flush } = mountEditor()
    flush()
    env.resize(800, 600)
    flush()
    expect(scene.width).toBe(800)
    expect(overlay.height).toBe(600)
    env.setPixelRatio(2)
    flush()
    expect(scene.width).toBe(1600)
    expect(overlay.width).toBe(1600)
  })

  it('positions the container only when it computes to static', () => {
    expect(mountEditor().container.style.position).toBe('relative')

    const env = fakeEnvironment()
    env.getComputedPosition = () => 'absolute'
    const container = new FakeContainer()
    createEditor({
      container: container as unknown as HTMLElement,
      store: new InMemoryBoardStore(),
      environment: env,
    })
    expect(container.style.position).toBeUndefined()
  })

  it('throws when the canvas has no 2D context', () => {
    const env = fakeEnvironment()
    env.createCanvas = () => {
      const canvas = new FakeCanvas()
      canvas.getContext = () => null as unknown as CanvasRenderingContext2D
      return canvas as unknown as HTMLCanvasElement
    }
    expect(() =>
      createEditor({
        container: new FakeContainer() as unknown as HTMLElement,
        store: new InMemoryBoardStore(),
        environment: env,
      }),
    ).toThrow(/2D/)
  })
})

describe('editor state', () => {
  it('starts on the select tool with nothing selected', () => {
    const { editor } = mountEditor()
    expect(editor.getState()).toEqual({
      activeTool: 'select',
      selectedIds: [],
      camera: { x: 0, y: 0, zoom: 1 },
      gesture: 'idle',
      readOnly: false,
      canUndo: false,
      canRedo: false,
    })
    expect(editor.getState()).toBe(editor.getState())
  })

  it('notifies once per change and not for a no-op', () => {
    const { editor, store } = mountEditor()
    const listener = vi.fn()
    editor.subscribe(listener)
    editor.setActiveTool('rectangle')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(editor.getState().activeTool).toBe('rectangle')
    editor.setActiveTool('rectangle')
    expect(listener).toHaveBeenCalledTimes(1)
    store.applyChanges([{ kind: 'create', element: box('a', 0, 0) }])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(editor.getState().canUndo).toBe(true)
  })

  it('reflects the selection and unsubscribes cleanly', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 0, 0) }])
    const listener = vi.fn()
    const stop = editor.subscribe(listener)
    editor.setSelectedIds(['a'])
    expect(editor.getState().selectedIds).toEqual(['a'])
    stop()
    editor.setSelectedIds([])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('editor camera', () => {
  it('clamps the zoom and notifies', () => {
    const { editor } = mountEditor()
    const listener = vi.fn()
    editor.subscribe(listener)
    editor.setCamera({ x: 10, y: 20, zoom: 1000 })
    expect(editor.getState().camera).toEqual({ x: 10, y: 20, zoom: MAX_ZOOM })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('zooms around the given anchor, defaulting to the viewport center', () => {
    const { editor } = mountEditor()
    editor.zoomTo(2, { x: 100, y: 100 })
    expect(editor.screenToWorld({ x: 100, y: 100 })).toEqual({ x: 100, y: 100 })
    expect(editor.getState().camera.zoom).toBe(2)
    editor.setCamera({ x: 0, y: 0, zoom: 1 })
    editor.zoomTo(4)
    expect(editor.screenToWorld({ x: 200, y: 150 })).toEqual({ x: 200, y: 150 })
  })

  it('fits the whole board, or the given ids, with padding', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      { kind: 'create', element: box('a', 0, 0) },
      { kind: 'create', element: box('b', 950, 550) },
    ])
    editor.zoomToFit()
    const { camera } = editor.getState()
    const center = editor.worldToScreen({ x: 500, y: 300 })
    expect(center.x).toBeCloseTo(200, 6)
    expect(center.y).toBeCloseTo(150, 6)
    expect(camera.zoom).toBeCloseTo((400 - 96) / 1000, 5)
    editor.zoomToFit(['a'])
    const single = editor.worldToScreen({ x: 25, y: 25 })
    expect(single.x).toBeCloseTo(200, 6)
    expect(single.y).toBeCloseTo(150, 6)
  })

  it('resets to the origin when there is nothing to fit', () => {
    const { editor } = mountEditor()
    editor.setCamera({ x: 500, y: 500, zoom: 3 })
    editor.zoomToFit()
    expect(editor.getState().camera).toEqual({ x: -200, y: -150, zoom: 1 })
  })

  it('projects an element frame to screen pixels', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 100, 100) }])
    editor.setCamera({ x: 50, y: 50, zoom: 2 })
    expect(editor.getElementScreenRect('a')).toEqual({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    })
    expect(editor.getElementScreenRect('missing')).toBeNull()
  })
})

describe('editor presence', () => {
  it('paints peers on the overlay only', () => {
    const { editor, scene, overlay, env, flush } = mountEditor()
    flush()
    const scenePaints = scene.paints
    const overlayPaints = overlay.paints
    editor.setPresence([
      {
        id: 'p',
        name: 'Ada',
        color: '#00AA00',
        cursor: { x: 100, y: 100 },
        selectedIds: [],
        isAgent: false,
      },
      { id: 'broken' } as never,
    ])
    editor.setPresence([
      {
        id: 'p',
        name: 'Ada',
        color: '#00AA00',
        cursor: { x: 100, y: 100 },
        selectedIds: [],
        isAgent: false,
      },
    ])
    expect(env.frames).toHaveLength(1)
    flush()
    // Two updates, one overlay repaint, and the scene scheduler was
    // never marked: a remote cursor costs nothing below the overlay.
    expect(overlay.paints).toBeGreaterThan(overlayPaints)
    expect(scene.paints).toBe(scenePaints)
    expect(overlay.rgbaAt(102, 108)).toEqual([0, 170, 0, 255])
  })
})

describe('editor destroy', () => {
  it('removes the canvases and observers, then ignores every call', () => {
    const { editor, container, env, store } = mountEditor()
    editor.setActiveTool('hand')
    const before = editor.getState()
    editor.destroy()
    editor.destroy()
    expect(container.children).toHaveLength(0)
    expect(env.keyboard.listenerCount()).toBe(0)
    env.frames.length = 0
    store.applyChanges([{ kind: 'create', element: box('a', 0, 0) }])
    editor.setActiveTool('rectangle')
    editor.setCamera({ x: 1, y: 1, zoom: 1 })
    expect(env.frames).toHaveLength(0)
    expect(editor.getState()).toBe(before)
  })
})

describe('editor eraser preview', () => {
  it('repaints the scene with the touched elements faded until release', () => {
    const { editor, store, scene, pointer, flush } = mountEditor()
    const red = createElement('rectangle', {
      id: 'red',
      index: 'a0',
      seed: 1,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#FF0000',
      fillColor: '#FF0000',
      sketchiness: 0,
    })
    store.applyChanges([{ kind: 'create', element: red }])
    editor.setActiveTool('eraser')
    flush()
    const pixel = () =>
      Array.from(scene.napi.getContext('2d').getImageData(50, 50, 1, 1).data)
    expect(pixel()).toEqual([255, 0, 0, 255])
    pointer('pointerdown', 50, 50)
    flush()
    expect(pixel()).not.toEqual([255, 0, 0, 255])
    expect(store.getElement('red')).toBeDefined()
    pointer('pointerup', 50, 50)
    flush()
    expect(store.getElement('red')).toBeUndefined()
  })
})
