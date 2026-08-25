import { describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/model/create'
import { mountEditor } from './harness'

const box = () =>
  createElement('rectangle', {
    id: 'a',
    index: 'a0',
    seed: 1,
    x: 100,
    y: 100,
    width: 100,
    height: 100,
  })

describe('read-only mode', () => {
  it('starts on the hand tool and only pans', () => {
    const { editor, store, pointer, key } = mountEditor({ readOnly: true })
    expect(editor.getState()).toMatchObject({
      readOnly: true,
      activeTool: 'hand',
    })
    expect(key('keydown', '3').defaultPrevented).toBe(false)
    editor.setActiveTool('rectangle')
    expect(editor.getState().activeTool).toBe('hand')
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 30, 40)
    pointer('pointerup', 30, 40)
    expect(editor.getState().camera).toEqual({ x: -30, y: -40, zoom: 1 })
    expect(store.listElements()).toHaveLength(0)
    pointer('dblclick', 50, 50)
    expect(store.listElements()).toHaveLength(0)
  })

  it('ignores every mutating call', () => {
    const { editor, store } = mountEditor({ readOnly: true })
    store.applyChanges([{ kind: 'create', element: box() }])
    store.clearHistory()
    editor.setSelectedIds(['a'])
    expect(editor.getState().selectedIds).toEqual([])
    editor.updateSelection({ strokeColor: '#FF0000' })
    editor.execute({ kind: 'select-all' })
    editor.execute({ kind: 'delete-selection' })
    editor.commitText('a', 'x')
    editor.undo()
    editor.redo()
    expect(store.listElements()).toEqual([store.getElement('a')])
    expect(editor.getState()).toMatchObject({
      selectedIds: [],
      canUndo: false,
    })
  })

  it('switches at runtime, clearing the selection on the way in', () => {
    const { editor, store, pointer } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box() }])
    editor.setSelectedIds(['a'])
    const listener = vi.fn()
    editor.subscribe(listener)
    editor.setReadOnly(true)
    expect(editor.getState()).toMatchObject({
      readOnly: true,
      activeTool: 'hand',
      selectedIds: [],
    })
    expect(listener).toHaveBeenCalledTimes(1)
    editor.setReadOnly(true)
    expect(listener).toHaveBeenCalledTimes(1)
    editor.setReadOnly(false)
    expect(editor.getState()).toMatchObject({
      readOnly: false,
      activeTool: 'select',
    })
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 50, 50)
    pointer('pointerup', 50, 50)
    expect(store.listElements()).toHaveLength(2)
  })

  it('still paints presence and reports the local cursor', () => {
    const onCursorMove = vi.fn()
    const { editor, overlay, pointer, flush } = mountEditor({
      readOnly: true,
      onCursorMove,
    })
    flush()
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
    flush()
    expect(overlay.rgbaAt(102, 108)).toEqual([0, 170, 0, 255])
    pointer('pointermove', 5, 6, { buttons: 0 })
    expect(onCursorMove).toHaveBeenLastCalledWith({ x: 5, y: 6 })
  })

  it('still zooms via the wheel while read-only', () => {
    const { editor, pointer } = mountEditor({ readOnly: true })
    pointer('wheel', 0, 0, { ctrlKey: true, deltaY: -100 })
    expect(editor.getState().camera.zoom).toBeGreaterThan(1)
  })

  it('still pans via the wheel while read-only', () => {
    const { editor, pointer } = mountEditor({ readOnly: true })
    pointer('wheel', 0, 0, { deltaX: -20, deltaY: -10 })
    expect(editor.getState().camera).toEqual({ x: -20, y: -10, zoom: 1 })
  })

  it('still pans with a space-held pointer drag while read-only', () => {
    const { editor, pointer, key } = mountEditor({ readOnly: true })
    key('keydown', ' ')
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 15, 25)
    pointer('pointerup', 15, 25)
    expect(editor.getState().camera).toEqual({ x: -15, y: -25, zoom: 1 })
  })
})
