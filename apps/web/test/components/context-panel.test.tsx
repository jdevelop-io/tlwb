import { fireEvent, render, screen } from '@testing-library/react'
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
})
