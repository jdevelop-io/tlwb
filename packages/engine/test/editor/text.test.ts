import { describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/model/create'
import type { TextElement } from '../../src/model/element'
import { LINE_HEIGHT } from '../../src/render/text'
import { mountEditor } from './harness'

const shape = () =>
  createElement('rectangle', {
    id: 'shape',
    index: 'a0',
    seed: 1,
    x: 100,
    y: 100,
    width: 200,
    height: 100,
  })

describe('double-click text editing', () => {
  it('creates a text on empty canvas, selects it, and asks the host to edit', () => {
    const onTextEditRequest = vi.fn()
    const { editor, store, pointer } = mountEditor({ onTextEditRequest })
    pointer('dblclick', 30, 40)
    const [text] = store.listElements() as TextElement[]
    expect(text).toMatchObject({ type: 'text', x: 30, y: 40, text: '' })
    expect(editor.getState().selectedIds).toEqual([text?.id])
    expect(onTextEditRequest).toHaveBeenCalledWith(text?.id)
  })

  it('creates a centered label inside a shape, once', () => {
    const onTextEditRequest = vi.fn()
    const { store, pointer } = mountEditor({ onTextEditRequest })
    store.applyChanges([{ kind: 'create', element: shape() }])
    pointer('dblclick', 150, 150)
    const label = store
      .listElements()
      .find((element) => element.type === 'text') as TextElement
    expect(label).toMatchObject({
      containerId: 'shape',
      textAlign: 'center',
      x: 200,
      width: 0,
      height: 20 * LINE_HEIGHT,
    })
    expect(label.y).toBeCloseTo(150 - (20 * LINE_HEIGHT) / 2, 6)
    pointer('dblclick', 120, 120)
    expect(store.listElements()).toHaveLength(2)
    expect(onTextEditRequest).toHaveBeenLastCalledWith(label.id)
  })

  it('edits an existing text instead of creating one', () => {
    const onTextEditRequest = vi.fn()
    const { store, pointer } = mountEditor({ onTextEditRequest })
    store.applyChanges([
      {
        kind: 'create',
        element: createElement('text', {
          id: 't',
          index: 'a0',
          x: 10,
          y: 10,
          width: 80,
          height: 25,
          text: 'hello',
        }),
      },
    ])
    pointer('dblclick', 40, 20)
    expect(store.listElements()).toHaveLength(1)
    expect(onTextEditRequest).toHaveBeenCalledWith('t')
  })
})

describe('commitText', () => {
  it('sizes the text with the scene metrics, as one undo entry', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      {
        kind: 'create',
        element: createElement('text', {
          id: 't',
          index: 'a0',
          x: 10,
          y: 10,
          text: '',
          fontSize: 20,
        }),
      },
    ])
    store.stopCapturing()
    editor.commitText('t', 'hello\nworld')
    const text = store.getElement('t') as TextElement
    expect(text.text).toBe('hello\nworld')
    expect(text.width).toBeGreaterThan(0)
    expect(text.height).toBe(2 * 20 * LINE_HEIGHT)
    editor.undo()
    expect((store.getElement('t') as TextElement).text).toBe('')
  })

  it('recenters a label and deletes an empty commit', () => {
    const { editor, store, pointer } = mountEditor()
    store.applyChanges([{ kind: 'create', element: shape() }])
    pointer('dblclick', 150, 150)
    const label = store
      .listElements()
      .find((element) => element.type === 'text') as TextElement
    editor.commitText(label.id, 'centered')
    const committed = store.getElement(label.id) as TextElement
    expect(committed.x + committed.width / 2).toBeCloseTo(200, 6)
    expect(committed.y + committed.height / 2).toBeCloseTo(150, 6)
    editor.commitText(label.id, '')
    expect(store.getElement(label.id)).toBeUndefined()
    expect(store.listElements()).toHaveLength(1)
  })
})
