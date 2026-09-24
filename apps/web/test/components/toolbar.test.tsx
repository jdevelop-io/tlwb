import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toolbar } from '../../src/board/components/toolbar'
import { fakeEditor } from './fake-editor'

describe('Toolbar', () => {
  it('lists the eleven tools with shortcuts and activates one on click', () => {
    const editor = fakeEditor()
    render(<Toolbar editor={editor} onPickImage={() => undefined} />)
    expect(screen.getAllByRole('radio')).toHaveLength(11)
    fireEvent.click(screen.getByRole('radio', { name: 'Rectangle (3)' }))
    expect(editor.setActiveTool).toHaveBeenCalledWith('rectangle')
    expect(screen.getByRole('radio', { name: 'Rectangle (3)' })).toBeChecked()
  })

  it('opens the file picker instead of a tool for images', () => {
    const editor = fakeEditor()
    const onPickImage = vi.fn()
    render(<Toolbar editor={editor} onPickImage={onPickImage} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Image (0)' }))
    expect(onPickImage).toHaveBeenCalled()
    expect(editor.setActiveTool).not.toHaveBeenCalled()
  })

  it('separates hand from shapes and image from eraser', () => {
    const { container } = render(
      <Toolbar editor={fakeEditor()} onPickImage={() => undefined} />,
    )
    expect(container.querySelectorAll('.toolbar-divider')).toHaveLength(2)
  })
})
