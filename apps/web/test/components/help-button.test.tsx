import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HelpButton } from '../../src/board/components/help-button'

describe('HelpButton', () => {
  it('is a real control with an accessible name', () => {
    render(<HelpButton />)
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
  })

  it('lists the shortcuts, opens modally, and can be dismissed', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close')
    render(<HelpButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(showModal).toHaveBeenCalledOnce()
    expect(screen.getByText('Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Pan')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })
})
