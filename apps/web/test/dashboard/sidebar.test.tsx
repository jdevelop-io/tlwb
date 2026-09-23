import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../src/dashboard/sidebar'

const user = { name: 'Sam', image: null, plan: 'free' as const }

describe('Sidebar', () => {
  it('marks the active section and shows the free plan gauge', () => {
    const onUpgrade = vi.fn()
    render(
      <Sidebar
        active="agents"
        user={user}
        boardCount={7}
        cap={10}
        billing
        onUpgrade={onUpgrade}
      />,
    )
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByText('Free · 7/10 boards')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '7',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(onUpgrade).toHaveBeenCalled()
  })

  it('hides the gauge and upgrade for pro accounts', () => {
    render(
      <Sidebar
        active="boards"
        user={{ ...user, plan: 'pro' }}
        boardCount={12}
        cap={null}
        billing
        onUpgrade={() => undefined}
      />,
    )
    expect(screen.getByText('Pro · 12 boards')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })
})
