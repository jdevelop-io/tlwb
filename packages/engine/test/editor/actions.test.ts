import { describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/model/create'
import { mountEditor } from './harness'

const box = (id: string, index: string, x: number) =>
  createElement('rectangle', {
    id,
    index,
    seed: 1,
    x,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000000',
  })

describe('keyboard routing', () => {
  it('routes shortcuts to the controller and prevents their default', () => {
    const { editor, key } = mountEditor()
    expect(key('keydown', '3').defaultPrevented).toBe(true)
    expect(editor.getState().activeTool).toBe('rectangle')
    expect(key('keydown', 'q').defaultPrevented).toBe(false)
  })

  it('leaves editable targets alone', () => {
    const { editor, key } = mountEditor()
    const input = { tagName: 'input' }
    expect(key('keydown', '3', { target: input }).defaultPrevented).toBe(false)
    expect(editor.getState().activeTool).toBe('select')
    const editable = { tagName: 'DIV', isContentEditable: true }
    key('keydown', '2', { target: editable })
    expect(editor.getState().activeTool).toBe('select')
  })
})

describe('editor actions', () => {
  it('executes actions from the chrome', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      { kind: 'create', element: box('a', 'a0', 0) },
      { kind: 'create', element: box('b', 'a1', 200) },
    ])
    editor.setSelectedIds(['a'])
    editor.execute({ kind: 'bring-to-front' })
    expect(store.listElements().map((element) => element.id)).toEqual([
      'b',
      'a',
    ])
    editor.execute({ kind: 'delete-selection' })
    expect(store.listElements().map((element) => element.id)).toEqual(['b'])
    expect(editor.getState().selectedIds).toEqual([])
  })

  it('applies a style patch to the selection as one undo entry', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      { kind: 'create', element: box('a', 'a0', 0) },
      { kind: 'create', element: box('b', 'a1', 200) },
    ])
    store.stopCapturing()
    editor.setSelectedIds(['a', 'b'])
    const listener = vi.fn()
    editor.subscribe(listener)
    editor.updateSelection({ strokeColor: '#FF0000', strokeWidth: 4 })
    expect(store.getElement('a')).toMatchObject({
      strokeColor: '#FF0000',
      strokeWidth: 4,
    })
    expect(store.getElement('b')).toMatchObject({ strokeColor: '#FF0000' })
    editor.undo()
    expect(store.getElement('a')?.strokeColor).toBe('#000000')
    expect(store.getElement('b')?.strokeColor).toBe('#000000')
    expect(editor.getState().canRedo).toBe(true)
    editor.redo()
    expect(store.getElement('b')?.strokeColor).toBe('#FF0000')
    expect(listener).toHaveBeenCalled()
  })

  it('does nothing without a selection', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 'a0', 0) }])
    store.clearHistory()
    editor.updateSelection({ strokeColor: '#FF0000' })
    expect(store.getElement('a')?.strokeColor).toBe('#000000')
    expect(editor.getState().canUndo).toBe(false)
  })

  it('moves bound labels along with a positional patch', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      { kind: 'create', element: box('a', 'a0', 0) },
      {
        kind: 'create',
        element: createElement('text', {
          id: 'label',
          index: 'a1',
          x: 40,
          y: 40,
          width: 20,
          height: 20,
          text: 'a',
          containerId: 'a',
        }),
      },
    ])
    editor.setSelectedIds(['a'])
    editor.updateSelection({ x: 500 })
    expect(store.getElement('label')).toMatchObject({ x: 540, y: 40 })
  })
})
