import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentsView } from '../../src/dashboard/agents-view'

const now = Date.parse('2026-09-23T12:00:00Z')
const keys = [
  {
    id: 'k1',
    name: 'Claude · laptop',
    boardIds: null,
    createdAt: '2026-09-01T00:00:00Z',
    lastUsedAt: '2026-09-23T11:55:00Z',
  },
  {
    id: 'k2',
    name: 'Claude Code · studio',
    boardIds: ['b1', 'b2'],
    createdAt: '2026-09-02T00:00:00Z',
    lastUsedAt: null,
  },
]

describe('AgentsView', () => {
  it('lists tokens with scope and activity, and revokes one', () => {
    const onRevoke = vi.fn()
    render(
      <AgentsView
        keys={keys}
        usage={null}
        now={now}
        onRevoke={onRevoke}
        onOpenNewToken={() => undefined}
      />,
    )
    expect(screen.getByText('All boards')).toBeInTheDocument()
    expect(screen.getByText('Active 5 min ago')).toBeInTheDocument()
    expect(screen.getByText('2 boards')).toBeInTheDocument()
    expect(screen.getByText('Never used')).toBeInTheDocument()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Revoke' })[1] as HTMLElement,
    )
    expect(onRevoke).toHaveBeenCalledWith('k2')
  })

  it('opens the new token dialog from both buttons', () => {
    const open = vi.fn()
    render(
      <AgentsView
        keys={[]}
        usage={null}
        onRevoke={() => undefined}
        onOpenNewToken={open}
      />,
    )
    for (const button of screen.getAllByRole('button', { name: 'New token' }))
      fireEvent.click(button)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('shows the monthly call usage when it is known', () => {
    render(
      <AgentsView
        keys={[]}
        usage={{ count: 12, limit: 200 }}
        onRevoke={() => undefined}
        onOpenNewToken={() => undefined}
      />,
    )
    expect(screen.getByText('12 / 200 calls this month')).toBeInTheDocument()
  })

  it('shows no usage line when it is not known yet', () => {
    render(
      <AgentsView
        keys={[]}
        usage={null}
        onRevoke={() => undefined}
        onOpenNewToken={() => undefined}
      />,
    )
    expect(screen.queryByText(/calls this month/)).toBeNull()
  })
})
