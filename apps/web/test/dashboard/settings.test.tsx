import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Settings, type SettingsDeps } from '../../src/dashboard/settings'

const user = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  plan: 'free' as const,
}

function deps(overrides: Partial<SettingsDeps> = {}): SettingsDeps {
  return {
    startCheckout: vi.fn(async () => 'https://stripe.example/checkout'),
    openPortal: vi.fn(async () => 'https://stripe.example/portal'),
    deleteUser: vi.fn(async () => undefined),
    navigate: vi.fn(),
    ...overrides,
  }
}

describe('Settings', () => {
  it('shows the account, offers both upgrade intervals on the free plan, and signs out', () => {
    const d = deps()
    const onSignOut = vi.fn()
    render(<Settings user={user} billing deps={d} onSignOut={onSignOut} />)
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('Free plan')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade monthly' }))
    expect(d.startCheckout).toHaveBeenCalledWith('month')
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade yearly' }))
    expect(d.startCheckout).toHaveBeenCalledWith('year')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalled()
  })

  it('hides the upgrade buttons on the free plan without billing', () => {
    const d = deps()
    render(
      <Settings
        user={user}
        billing={false}
        deps={d}
        onSignOut={() => undefined}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Upgrade monthly' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade yearly' })).toBeNull()
  })

  it('opens the billing portal on the pro plan', async () => {
    const d = deps()
    render(
      <Settings
        user={{ ...user, plan: 'pro' }}
        billing
        deps={d}
        onSignOut={() => undefined}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Upgrade monthly' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade yearly' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }))
    await waitFor(() => expect(d.openPortal).toHaveBeenCalled())
  })

  it('deletes the account only after both confirmations pass', async () => {
    const d = deps()
    const confirmSpy = vi.fn()
    window.confirm = confirmSpy
    render(
      <Settings
        user={user}
        billing={false}
        deps={d}
        onSignOut={() => undefined}
      />,
    )
    const deleteButton = screen.getByRole('button', { name: 'Delete account' })

    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false)
    fireEvent.click(deleteButton)
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
    expect(d.deleteUser).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(deleteButton)
    await waitFor(() => expect(d.deleteUser).toHaveBeenCalledOnce())
    expect(d.navigate).toHaveBeenCalledWith('/')
  })

  it('reports a failed account deletion as an error instead of failing silently', async () => {
    const deleteUser = vi.fn(async () => {
      throw new Error('down')
    })
    const d = deps({ deleteUser })
    window.confirm = vi.fn(() => true)
    render(
      <Settings
        user={user}
        billing={false}
        deps={d}
        onSignOut={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    await screen.findByText('Could not delete the account, try again')
    expect(d.navigate).not.toHaveBeenCalled()
  })
})
