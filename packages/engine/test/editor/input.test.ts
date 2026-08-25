import { describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/model/create'
import { mountEditor } from './harness'

const box = (id: string, x: number, y: number) =>
  createElement('rectangle', {
    id,
    index: `a${id}`,
    seed: 1,
    x,
    y,
    width: 100,
    height: 100,
  })

describe('pointer binding', () => {
  it('draws a rectangle through pointer events, in container coordinates', () => {
    const { editor, store, pointer, overlay } = mountEditor()
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 10, 10)
    expect(overlay.captured).toEqual([1])
    pointer('pointermove', 110, 60)
    pointer('pointerup', 110, 60)
    expect(store.listElements()[0]).toMatchObject({
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
    })
    expect(editor.getState().activeTool).toBe('select')
  })

  it('projects through the camera', () => {
    const { editor, store, pointer } = mountEditor()
    editor.setCamera({ x: 100, y: 50, zoom: 2 })
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 20, 20)
    pointer('pointermove', 60, 40)
    pointer('pointerup', 60, 40)
    expect(store.listElements()[0]).toMatchObject({
      x: 110,
      y: 60,
      width: 20,
      height: 10,
    })
  })

  it('ignores the right button', () => {
    const { editor, store, pointer, overlay } = mountEditor()
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 10, 10, { button: 2, buttons: 2 })
    pointer('pointermove', 50, 50, { buttons: 2 })
    pointer('pointerup', 50, 50, { button: 2, buttons: 0 })
    expect(store.listElements()).toHaveLength(0)
    expect(overlay.captured).toEqual([])
  })

  it('abandons the gesture on pointercancel', () => {
    const { editor, store, pointer } = mountEditor()
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 10, 10)
    pointer('pointermove', 60, 60)
    expect(store.listElements()).toHaveLength(1)
    pointer('pointercancel', 60, 60)
    expect(store.listElements()).toHaveLength(0)
  })

  it('keeps a left-button drag open through an unrelated right-button click', () => {
    const { editor, store, pointer } = mountEditor()
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 10, 10)
    pointer('pointermove', 60, 60)
    pointer('pointerdown', 60, 60, { button: 2, buttons: 3 })
    pointer('pointerup', 60, 60, { button: 2, buttons: 1 })
    // The right-click must not have closed the left-button gesture.
    expect(editor.getState().activeTool).toBe('rectangle')
    pointer('pointerup', 60, 60)
    expect(editor.getState().activeTool).toBe('select')
    expect(store.listElements()[0]).toMatchObject({
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    })
  })

  it('pans with the middle button without changing the tool', () => {
    const { editor, pointer } = mountEditor()
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 0, 0, { button: 1, buttons: 4 })
    pointer('pointermove', 30, 40, { buttons: 4 })
    pointer('pointerup', 30, 40, { button: 1, buttons: 0 })
    expect(editor.getState().camera).toEqual({ x: -30, y: -40, zoom: 1 })
    expect(editor.getState().activeTool).toBe('rectangle')
  })

  it('pans while the space bar is held, then returns to the tool', () => {
    const { editor, store, pointer, key } = mountEditor()
    editor.setActiveTool('rectangle')
    expect(key('keydown', ' ').defaultPrevented).toBe(true)
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 10, 0)
    pointer('pointerup', 10, 0)
    expect(editor.getState().camera.x).toBe(-10)
    expect(store.listElements()).toHaveLength(0)
    key('keyup', ' ')
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 50, 50)
    pointer('pointerup', 50, 50)
    expect(store.listElements()).toHaveLength(1)
  })

  it('reports the local cursor in world coordinates and null on leave', () => {
    const onCursorMove = vi.fn()
    const { editor, pointer } = mountEditor({ onCursorMove })
    editor.setCamera({ x: 100, y: 100, zoom: 1 })
    pointer('pointermove', 5, 6, { buttons: 0 })
    expect(onCursorMove).toHaveBeenLastCalledWith({ x: 105, y: 106 })
    pointer('pointerleave', 0, 0, { buttons: 0 })
    expect(onCursorMove).toHaveBeenLastCalledWith(null)
  })
})

describe('wheel binding', () => {
  it('zooms around the pointer with a modifier held', () => {
    const { editor, pointer } = mountEditor()
    const before = editor.screenToWorld({ x: 100, y: 80 })
    const event = pointer('wheel', 100, 80, { deltaY: -100, ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(editor.getState().camera.zoom).toBeGreaterThan(1)
    const after = editor.screenToWorld({ x: 100, y: 80 })
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    pointer('wheel', 100, 80, { deltaY: 100, metaKey: true })
    expect(editor.getState().camera.zoom).toBeCloseTo(1, 6)
  })

  it('pans without a modifier', () => {
    const { editor, pointer } = mountEditor()
    const event = pointer('wheel', 0, 0, { deltaX: 10, deltaY: 20 })
    expect(event.defaultPrevented).toBe(true)
    expect(editor.getState().camera).toEqual({ x: 10, y: 20, zoom: 1 })
  })

  it('registers the wheel listener as explicitly non-passive', () => {
    const { overlay } = mountEditor()
    expect(overlay.listenerOptions('wheel')).toEqual([{ passive: false }])
  })
})

describe('cursor binding', () => {
  it('follows the tool and the hovered handle or element', () => {
    const { editor, store, pointer, overlay } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 100, 100) }])
    pointer('pointermove', 5, 5, { buttons: 0 })
    expect(overlay.style.cursor).toBe('default')
    editor.setActiveTool('hand')
    pointer('pointermove', 5, 5, { buttons: 0 })
    expect(overlay.style.cursor).toBe('grab')
    editor.setActiveTool('rectangle')
    pointer('pointermove', 5, 5, { buttons: 0 })
    expect(overlay.style.cursor).toBe('crosshair')
    editor.setActiveTool('select')
    editor.setSelectedIds(['a'])
    pointer('pointermove', 200, 150, { buttons: 0 })
    expect(overlay.style.cursor).toBe('ew-resize')
    // On the top edge, away from the handles: a hollow rectangle is hit
    // on its outline, exactly where the select tool grabs it.
    pointer('pointermove', 130, 100, { buttons: 0 })
    expect(overlay.style.cursor).toBe('move')
    pointer('pointermove', 20, 20, { buttons: 0 })
    expect(overlay.style.cursor).toBe('default')
  })

  it('refreshes immediately after a tool-switching key, without waiting for a pointer move', () => {
    const { pointer, key, overlay } = mountEditor()
    pointer('pointermove', 5, 5, { buttons: 0 })
    expect(overlay.style.cursor).toBe('default')
    key('keydown', '2')
    expect(overlay.style.cursor).toBe('grab')
  })
})
