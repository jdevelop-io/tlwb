import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HelpButton } from '../../src/board/components/help-button'

describe('HelpButton', () => {
  it('is a real control with an accessible name', () => {
    render(<HelpButton />)
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument()
  })

  it('lists the shortcuts and can be dismissed, without crashing where dialog is unsupported', () => {
    render(<HelpButton />)
    // happy-dom's <dialog> has no showModal/close; the component guards
    // both, so clicking here must not throw.
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByText('Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Pan and zoom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  })
})
