import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BoardMenu } from '../../src/board/components/board-menu'
import { touchRecent } from '../../src/board/session/recents'

beforeEach(() => localStorage.clear())

describe('BoardMenu', () => {
  it('lists recents, the current board excluded, then home', () => {
    touchRecent({ id: 'b1', name: 'Current', updatedAt: 2 })
    touchRecent({ id: 'b2', name: 'Other', updatedAt: 1 })
    render(<BoardMenu currentId="b1" />)
    expect(screen.getByRole('link', { name: /Other/ })).toHaveAttribute(
      'href',
      '/b/b2',
    )
    expect(screen.queryByRole('link', { name: /Current/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('renders the extra items a deployment passes, before home', () => {
    const { container } = render(
      <BoardMenu
        currentId="b1"
        items={<button type="button">Add to my account</button>}
      />,
    )
    const labels = Array.from(container.querySelectorAll('a, button')).map(
      (node) => node.textContent,
    )
    expect(labels).toEqual(['New board', 'Add to my account', 'Home'])
  })
})
