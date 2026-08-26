import { fireEvent, render, screen } from '@testing-library/react'
import { createElement, InMemoryBoardStore } from '@tlwb/engine'
import { describe, expect, it, vi } from 'vitest'
import { TextEditor } from '../../src/board/components/text-editor'
import { fakeEditor } from './fake-editor'

function setup(text = 'hello') {
  const store = new InMemoryBoardStore()
  const element = createElement('text', {
    index: 'a0',
    text,
    x: 10,
    y: 20,
    width: 80,
    height: 25,
  })
  store.applyChanges([{ kind: 'create', element }])
  const editor = fakeEditor()
  ;(editor.getElementScreenRect as ReturnType<typeof vi.fn>).mockReturnValue({
    x: 100,
    y: 200,
    width: 80,
    height: 25,
  })
  const onDone = vi.fn()
  render(
    <TextEditor
      editor={editor}
      store={store}
      id={element.id}
      onDone={onDone}
    />,
  )
  return { editor, element, onDone }
}

describe('TextEditor', () => {
  it('opens over the element with its text and font, focused', () => {
    setup()
    const area = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(area).toHaveValue('hello')
    expect(document.activeElement).toBe(area)
    expect(area.style.left).toBe('100px')
    expect(area.style.top).toBe('200px')
    expect(area.style.fontSize).toBe('20px')
    expect(area.style.fontFamily).toContain('Caveat')
  })

  it('commits on blur and on Escape, keeps Enter as a line break', () => {
    const { editor, element, onDone } = setup()
    const area = screen.getByRole('textbox')
    fireEvent.change(area, { target: { value: 'line 1\nline 2' } })
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(editor.commitText).not.toHaveBeenCalled()
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(editor.commitText).toHaveBeenCalledWith(element.id, 'line 1\nline 2')
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
