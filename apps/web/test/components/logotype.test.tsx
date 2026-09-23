import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Logotype } from '../../src/board/components/logotype'

describe('Logotype', () => {
  it('links home with the wordmark and its underline', () => {
    render(<Logotype size="nav" href="/" />)
    const link = screen.getByRole('link', { name: 'tlwb' })
    expect(link).toHaveAttribute('href', '/')
    expect(link.querySelector('svg')).toHaveAttribute('width', '60')
  })

  it('renders as text when no href is given', () => {
    render(<Logotype size="editor" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('tlwb')).toBeInTheDocument()
  })
})
