import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement, InMemoryBoardStore } from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import { ContextPanel } from '../../src/board/components/context-panel'
import { fakeEditor } from './fake-editor'

describe('ContextPanel', () => {
  it('stays hidden with the select tool and no selection', () => {
    const { container } = render(
      <ContextPanel editor={fakeEditor()} store={new InMemoryBoardStore()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('patches the creation defaults when a tool is active', () => {
    const editor = fakeEditor({ activeTool: 'rectangle' })
    render(<ContextPanel editor={editor} store={new InMemoryBoardStore()} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Stroke #E5484D' }))
    expect(editor.setDefaults).toHaveBeenCalledWith({ strokeColor: '#E5484D' })
    expect(editor.updateSelection).not.toHaveBeenCalled()
  })

  it('patches the selection and shows text controls for a text element', () => {
    const store = new InMemoryBoardStore()
    const text = createElement('text', { index: 'a0', text: 'hi' })
    store.applyChanges([{ kind: 'create', element: text }])
    const editor = fakeEditor({ selectedIds: [text.id] })
    render(<ContextPanel editor={editor} store={store} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Font size 28' }))
    expect(editor.updateSelection).toHaveBeenCalledWith({ fontSize: 28 })
    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }))
    expect(editor.execute).toHaveBeenCalledWith({ kind: 'bring-to-front' })
  })

  it('follows a style change on the selected element', () => {
    const store = new InMemoryBoardStore()
    const rectangle = createElement('rectangle', { index: 'a0' })
    store.applyChanges([{ kind: 'create', element: rectangle }])
    const editor = fakeEditor({ selectedIds: [rectangle.id] })
    render(<ContextPanel editor={editor} store={store} />)
    // What `updateSelection` does in the engine: the element changes in
    // the store while the editor state (tool, selection) stays the same.
    act(() =>
      store.applyChanges([
        {
          kind: 'update',
          id: rectangle.id,
          props: { strokeColor: '#E5484D' },
        },
      ]),
    )
    expect(screen.getByRole('radio', { name: 'Stroke #E5484D' })).toBeChecked()
  })

  it('exposes sketchiness as a slider and leaves no swatch checked with nothing selected', () => {
    const editor = fakeEditor({ activeTool: 'rectangle' })
    render(<ContextPanel editor={editor} store={new InMemoryBoardStore()} />)
    const slider = screen.getByRole('slider', { name: 'Sketchiness' })
    fireEvent.change(slider, { target: { value: '2' } })
    expect(editor.setDefaults).toHaveBeenCalledWith({ sketchiness: 2 })
    // `Editor` has no way to read the creation defaults back (only to
    // write them), so with nothing selected the panel must not claim
    // any particular color is the current one.
    for (const radio of screen.getAllByRole('radio', { name: /^Stroke / }))
      expect(radio).not.toBeChecked()
  })
})
