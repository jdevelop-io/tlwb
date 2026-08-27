import { fireEvent, render, screen } from '@testing-library/react'
import { createElement, InMemoryBoardStore } from '@tlwb/engine'
import { describe, expect, it, vi } from 'vitest'
import { TextEditor } from '../../src/board/components/text-editor'
import { fakeEditor } from './fake-editor'

/**
 * A minimal 2D context: `measureText` returns ten pixels per character,
 * so the sizing formula (measured size, scaled by zoom, floored by the
 * element's rect) stays reachable under happy-dom, which never
 * implements canvas rendering itself.
 */
const fakeCtx = {
  font: '',
  measureText: (text: string) => ({ width: text.length * 10 }),
} as unknown as CanvasRenderingContext2D
;(
  HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }
).getContext = () => fakeCtx

function setup(text = 'hello', zoom = 1) {
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
  const editor = fakeEditor({ camera: { x: 0, y: 0, zoom } })
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

  it('sizes the overlay from the measured text and the camera zoom', () => {
    // 'hello' is 5 characters: measured width 5 * 10 = 50, one line
    // tall at fontSize 20 and LINE_HEIGHT 1.25 = 25. At zoom 2, width
    // is max(50 * 2 + 8, rect.width 80) = 108 and height is
    // max(25 * 2, rect.height 25) = 50. A dropped zoom factor or a
    // wrong multiplier lands on a different number here.
    setup('hello', 2)
    const area = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(area.style.width).toBe('108px')
    expect(area.style.height).toBe('50px')
  })

  it('keeps Enter as a line break instead of committing', () => {
    const { editor } = setup()
    const area = screen.getByRole('textbox')
    fireEvent.change(area, { target: { value: 'line 1\nline 2' } })
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(editor.commitText).not.toHaveBeenCalled()
  })

  it('commits the typed text on blur', () => {
    const { editor, element, onDone } = setup()
    const area = screen.getByRole('textbox')
    fireEvent.change(area, { target: { value: 'line 1\nline 2' } })
    fireEvent.blur(area)
    expect(editor.commitText).toHaveBeenCalledWith(element.id, 'line 1\nline 2')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('commits once on Escape even when a trailing blur follows', () => {
    const { editor, element, onDone } = setup()
    const area = screen.getByRole('textbox')
    fireEvent.change(area, { target: { value: 'line 1\nline 2' } })
    fireEvent.keyDown(area, { key: 'Escape' })
    fireEvent.blur(area)
    expect(editor.commitText).toHaveBeenCalledTimes(1)
    expect(editor.commitText).toHaveBeenCalledWith(element.id, 'line 1\nline 2')
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
