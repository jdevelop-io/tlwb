import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiKeySummary } from '../../src/dashboard/api'
import { NewTokenDialog } from '../../src/dashboard/new-token-dialog'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})
afterEach(() => vi.useRealTimers())

describe('NewTokenDialog', () => {
  it('creates a scoped token, shows the snippet, and flips the chip on first use', async () => {
    const createApiKey = vi.fn(async () => ({ id: 'k9', key: 'tlwb_abc' }))
    const fetchApiKeys = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'k9',
          name: 'Claude · desktop',
          boardIds: ['b1'],
          createdAt: '',
          lastUsedAt: null,
        },
      ])
      .mockResolvedValue([
        {
          id: 'k9',
          name: 'Claude · desktop',
          boardIds: ['b1'],
          createdAt: '',
          lastUsedAt: '2026-09-23T12:00:00Z',
        },
      ])
    render(
      <NewTokenDialog
        open
        boards={[
          { id: 'b1', name: 'payments architecture' },
          { id: 'b2', name: 'sprint retro' },
        ]}
        presetBoardId="b1"
        createApiKey={createApiKey}
        fetchApiKeys={fetchApiKeys}
        onClose={() => undefined}
      />,
    )
    expect(
      screen.getByRole('radio', { name: 'Only specific boards' }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: 'payments architecture' }),
    ).toBeChecked()
    expect(screen.getByText('1 board selected')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Token name' }), {
      target: { value: 'Claude · desktop' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    expect(createApiKey).toHaveBeenCalledWith({
      name: 'Claude · desktop',
      boardIds: ['b1'],
    })
    expect(await screen.findByText(/Bearer tlwb_abc/)).toBeInTheDocument()
    expect(screen.getByText('Waiting for your agent...')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(6500)
    await waitFor(() =>
      expect(screen.getByText('Connected')).toBeInTheDocument(),
    )
  })

  it('stops polling once the dialog closes, and again on unmount', async () => {
    const createApiKey = vi.fn(async () => ({ id: 'k9', key: 'tlwb_abc' }))
    const pending: ApiKeySummary = {
      id: 'k9',
      name: 'Claude · desktop',
      boardIds: null,
      createdAt: '',
      lastUsedAt: null,
    }
    const fetchApiKeys = vi.fn(async () => [pending])
    const { rerender, unmount } = render(
      <NewTokenDialog
        open
        boards={[]}
        createApiKey={createApiKey}
        fetchApiKeys={fetchApiKeys}
        onClose={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await screen.findByText('Waiting for your agent...')

    await vi.advanceTimersByTimeAsync(3000)
    const callsWhileOpen = fetchApiKeys.mock.calls.length
    expect(callsWhileOpen).toBeGreaterThan(0)

    rerender(
      <NewTokenDialog
        open={false}
        boards={[]}
        createApiKey={createApiKey}
        fetchApiKeys={fetchApiKeys}
        onClose={() => undefined}
      />,
    )
    await vi.advanceTimersByTimeAsync(9000)
    expect(fetchApiKeys.mock.calls.length).toBe(callsWhileOpen)

    // Reopening after a close starts a fresh run: the old key and chip
    // are gone, not resumed.
    rerender(
      <NewTokenDialog
        open
        boards={[]}
        createApiKey={createApiKey}
        fetchApiKeys={fetchApiKeys}
        onClose={() => undefined}
      />,
    )
    expect(screen.queryByText(/Bearer tlwb_abc/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create token' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await screen.findByText('Waiting for your agent...')
    await vi.advanceTimersByTimeAsync(3000)
    const callsBeforeUnmount = fetchApiKeys.mock.calls.length
    expect(callsBeforeUnmount).toBeGreaterThan(callsWhileOpen)

    unmount()
    await vi.advanceTimersByTimeAsync(9000)
    expect(fetchApiKeys.mock.calls.length).toBe(callsBeforeUnmount)
  })
})
