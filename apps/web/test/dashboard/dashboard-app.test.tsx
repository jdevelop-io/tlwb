import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readKeys } from '../../src/board/session/keys'
import { ServerError } from '../../src/board/session/server'
import type { DashboardBoard, MeResponse } from '../../src/dashboard/api'
import type { DashboardDeps } from '../../src/dashboard/dashboard-app'
import { DashboardApp } from '../../src/dashboard/dashboard-app'

const me: MeResponse = {
  user: {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    image: null,
    plan: 'free',
  },
  billing: true,
}

const board = (overrides: Partial<DashboardBoard> = {}): DashboardBoard => ({
  id: 'b1',
  name: 'Sprint plan',
  updatedAt: '2026-01-05T10:00:00.000Z',
  shared: false,
  agent: false,
  ...overrides,
})

function makeDeps(overrides: Partial<DashboardDeps> = {}): DashboardDeps {
  return {
    fetchMe: async () => me,
    fetchBoards: async () => ({ boards: [], cap: null }),
    deleteBoard: vi.fn(async () => undefined),
    createApiKey: vi.fn(async () => 'sk_test'),
    revokeApiKey: vi.fn(async () => undefined),
    fetchUsage: vi.fn(async () => ({ month: '2026-01', count: 3, limit: 100 })),
    startCheckout: vi.fn(async () => 'https://stripe.example/checkout'),
    openPortal: vi.fn(async () => 'https://stripe.example/portal'),
    createHostedBoard: vi.fn(async () => ({
      boardId: 'new1',
      editKey: 'e',
      viewKey: 'v',
    })),
    signOut: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
    navigate: vi.fn(),
    adopt: vi.fn(async () => ({ adopted: [], skipped: [] })),
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  history.pushState(null, '', '/dashboard')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('DashboardApp', () => {
  it('redirects to /login when signed out', async () => {
    const navigate = vi.fn()
    const deps = makeDeps({ fetchMe: async () => null, navigate })
    render(<DashboardApp deps={deps} />)
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/login?from=/dashboard'),
    )
    expect(screen.queryByText('New board')).toBeNull()
  })

  it('renders the grid, the sidebar gauge, and New board', async () => {
    const deps = makeDeps({
      fetchBoards: async () => ({
        boards: [
          board({ id: 'b1', name: 'Sprint plan' }),
          board({ id: 'b2', name: 'Retro' }),
        ],
        cap: 10,
      }),
    })
    render(<DashboardApp deps={deps} />)
    expect(await screen.findByText('Free · 2/10 boards')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'My boards' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Sprint plan' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Retro' })).toBeInTheDocument()
    // The primary "New board" button and the grid's ghost card both carry
    // that name: the artboard repeats the call to action at the end of
    // the row.
    expect(screen.getAllByRole('button', { name: 'New board' })).toHaveLength(2)
  })

  it('still loads the board list when adopt() rejects', async () => {
    const deps = makeDeps({
      adopt: vi.fn(async () => {
        throw new Error('adoption blew up')
      }),
      fetchBoards: async () => ({ boards: [board()], cap: 10 }),
    })
    render(<DashboardApp deps={deps} />)
    expect(
      await screen.findByRole('link', { name: 'Sprint plan' }),
    ).toBeInTheDocument()
  })

  it('hides the gauge and upgrade on pro', async () => {
    const deps = makeDeps({
      fetchMe: async () => ({ ...me, user: { ...me.user, plan: 'pro' } }),
      fetchBoards: async () => ({ boards: [board()], cap: null }),
    })
    render(<DashboardApp deps={deps} />)
    await screen.findByRole('link', { name: 'Sprint plan' })
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('hides the sidebar Upgrade button on a free account without billing', async () => {
    const deps = makeDeps({
      fetchMe: async () => ({ ...me, billing: false }),
      fetchBoards: async () => ({ boards: [board()], cap: 10 }),
    })
    render(<DashboardApp deps={deps} />)
    expect(await screen.findByText('Free · 1/10 boards')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('deletes a board through its card menu', async () => {
    window.confirm = vi.fn(() => true)
    const deleteBoard = vi.fn(async () => undefined)
    const deps = makeDeps({
      fetchBoards: async () => ({ boards: [board({ id: 'b1' })], cap: 10 }),
      deleteBoard,
    })
    render(<DashboardApp deps={deps} />)
    await screen.findByRole('link', { name: 'Sprint plan' })
    fireEvent.click(
      screen.getByRole('button', { name: 'More about Sprint plan' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteBoard).toHaveBeenCalledWith('b1'))
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Sprint plan' })).toBeNull(),
    )
  })

  it('keeps the board when the delete confirmation is declined', async () => {
    window.confirm = vi.fn(() => false)
    const deleteBoard = vi.fn(async () => undefined)
    const deps = makeDeps({
      fetchBoards: async () => ({ boards: [board({ id: 'b1' })], cap: 10 }),
      deleteBoard,
    })
    render(<DashboardApp deps={deps} />)
    await screen.findByRole('link', { name: 'Sprint plan' })
    fireEvent.click(
      screen.getByRole('button', { name: 'More about Sprint plan' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteBoard).not.toHaveBeenCalled()
    expect(
      screen.getByRole('link', { name: 'Sprint plan' }),
    ).toBeInTheDocument()
  })

  it('shows only the badges a board actually has', async () => {
    const deps = makeDeps({
      fetchBoards: async () => ({
        boards: [
          board({ id: 'b1', name: 'Shared board', shared: true, agent: false }),
          board({ id: 'b2', name: 'Plain board', shared: false, agent: false }),
        ],
        cap: 10,
      }),
    })
    render(<DashboardApp deps={deps} />)
    await screen.findByRole('link', { name: 'Shared board' })
    expect(screen.getAllByText('Shared')).toHaveLength(1)
    expect(screen.queryByText('Claude')).toBeNull()
  })

  it('falls back to a plain block when a thumbnail fails to load', async () => {
    const deps = makeDeps({
      fetchBoards: async () => ({ boards: [board({ id: 'b1' })], cap: 10 }),
    })
    render(<DashboardApp deps={deps} />)
    const img = await screen.findByAltText('Thumbnail of Sprint plan')
    expect(screen.queryByText('nothing here yet...')).toBeNull()
    fireEvent.error(img)
    expect(screen.queryByAltText('Thumbnail of Sprint plan')).toBeNull()
    expect(screen.getByText('nothing here yet...')).toBeInTheDocument()
  })

  it('shows a relative edited time on the card', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString()
    const deps = makeDeps({
      fetchBoards: async () => ({
        boards: [board({ id: 'b1', updatedAt: twoHoursAgo })],
        cap: 10,
      }),
    })
    render(<DashboardApp deps={deps} />)
    expect(await screen.findByText('Edited 2h ago')).toBeInTheDocument()
  })

  it('shows the cap ghost card once the board count reaches the cap', async () => {
    const boards = Array.from({ length: 10 }, (_, index) =>
      board({ id: `b${index}`, name: `Board ${index}` }),
    )
    const deps = makeDeps({ fetchBoards: async () => ({ boards, cap: 10 }) })
    render(<DashboardApp deps={deps} />)
    expect(await screen.findByText('Board limit reached')).toBeInTheDocument()
    expect(screen.getByText('Upgrade to create more')).toBeInTheDocument()
    // The disabled ghost no longer offers itself as a second "New board"
    // button: only the header's primary action remains.
    expect(screen.getAllByRole('button', { name: 'New board' })).toHaveLength(1)
  })

  it('creates a board, stores its keys, and navigates to it', async () => {
    const navigate = vi.fn()
    const createHostedBoard = vi.fn(async () => ({
      boardId: 'freshly-made',
      editKey: 'edit-key',
      viewKey: 'view-key',
    }))
    const deps = makeDeps({ createHostedBoard, navigate })
    render(<DashboardApp deps={deps} />)
    const newBoardButtons = await screen.findAllByRole('button', {
      name: 'New board',
    })
    fireEvent.click(newBoardButtons[0] as HTMLElement)
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/b/freshly-made'),
    )
    expect(readKeys('freshly-made')).toEqual({
      editKey: 'edit-key',
      viewKey: 'view-key',
    })
  })

  it('shows the cap message with an Upgrade link on a 403 create', async () => {
    const createHostedBoard = vi.fn(async () => {
      throw new ServerError(403)
    })
    const deps = makeDeps({
      fetchBoards: async () => ({ boards: [], cap: 10 }),
      createHostedBoard,
    })
    render(<DashboardApp deps={deps} />)
    const newBoardButtons = await screen.findAllByRole('button', {
      name: 'New board',
    })
    fireEvent.click(newBoardButtons[0] as HTMLElement)
    const banner = await screen.findByRole('status')
    expect(
      within(banner).getByText('You have reached your board limit.'),
    ).toBeInTheDocument()
    expect(
      within(banner).getByRole('button', { name: 'Upgrade' }),
    ).toBeInTheDocument()
  })

  it('omits the Upgrade link from the cap message without billing', async () => {
    const createHostedBoard = vi.fn(async () => {
      throw new ServerError(403)
    })
    const deps = makeDeps({
      fetchMe: async () => ({ ...me, billing: false }),
      fetchBoards: async () => ({ boards: [], cap: 10 }),
      createHostedBoard,
    })
    render(<DashboardApp deps={deps} />)
    const newBoardButtons = await screen.findAllByRole('button', {
      name: 'New board',
    })
    fireEvent.click(newBoardButtons[0] as HTMLElement)
    await screen.findByText('You have reached your board limit.')
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('reports a non-cap board creation failure as a toast, not the cap message', async () => {
    const createHostedBoard = vi.fn(async () => {
      throw new ServerError(500)
    })
    const deps = makeDeps({
      fetchBoards: async () => ({ boards: [], cap: 10 }),
      createHostedBoard,
    })
    render(<DashboardApp deps={deps} />)
    const newBoardButtons = await screen.findAllByRole('button', {
      name: 'New board',
    })
    fireEvent.click(newBoardButtons[0] as HTMLElement)
    await screen.findByText('Could not create the board, try again')
    expect(screen.queryByText('You have reached your board limit.')).toBeNull()
  })

  it('renders the agents view on its route', async () => {
    const deps = makeDeps({ pathname: '/dashboard/agents' })
    render(<DashboardApp deps={deps} />)
    expect(await screen.findByRole('link', { name: 'Agents' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('opens the billing portal for its url', async () => {
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {})
    const openPortal = vi.fn(
      async () => 'https://stripe.example/portal-session',
    )
    const deps = makeDeps({
      fetchMe: async () => ({ ...me, user: { ...me.user, plan: 'pro' } }),
      openPortal,
      pathname: '/dashboard/settings',
    })
    render(<DashboardApp deps={deps} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage billing' }),
    )
    await waitFor(() => expect(openPortal).toHaveBeenCalledOnce())
    expect(assign).toHaveBeenCalledWith('https://stripe.example/portal-session')
  })

  it('signs out and navigates home', async () => {
    const signOut = vi.fn(async () => undefined)
    const navigate = vi.fn()
    const deps = makeDeps({
      signOut,
      navigate,
      pathname: '/dashboard/settings',
    })
    render(<DashboardApp deps={deps} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('shows Manage billing only for a subscribed, billing-enabled account', async () => {
    const deps = makeDeps({
      fetchMe: async () => ({ ...me, user: { ...me.user, plan: 'pro' } }),
      pathname: '/dashboard/settings',
    })
    render(<DashboardApp deps={deps} />)
    expect(
      await screen.findByRole('button', { name: 'Manage billing' }),
    ).toBeInTheDocument()
  })

  it('hides Manage billing for a free account', async () => {
    const deps = makeDeps({ pathname: '/dashboard/settings' })
    render(<DashboardApp deps={deps} />)
    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull()
  })

  it('generates and reveals the MCP API key once, then clears it on revoke', async () => {
    const createApiKey = vi.fn(async () => 'sk_live_secret')
    const revokeApiKey = vi.fn(async () => undefined)
    const deps = makeDeps({
      createApiKey,
      revokeApiKey,
      pathname: '/dashboard/settings',
    })
    render(<DashboardApp deps={deps} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Generate key' }))
    await screen.findByText('sk_live_secret')
    expect(screen.getByText(/shown once/, { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(revokeApiKey).toHaveBeenCalledOnce())
    expect(screen.queryByText('sk_live_secret')).toBeNull()
  })

  it('keeps the key visible and reports an error when revoke fails', async () => {
    const createApiKey = vi.fn(async () => 'sk_live_secret')
    const revokeApiKey = vi.fn(async () => {
      throw new Error('down')
    })
    const deps = makeDeps({
      createApiKey,
      revokeApiKey,
      pathname: '/dashboard/settings',
    })
    render(<DashboardApp deps={deps} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Generate key' }))
    await screen.findByText('sk_live_secret')

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(revokeApiKey).toHaveBeenCalledOnce())

    // A failed revocation must never read as a successful one: the key
    // the user believes might be compromised stays visible, with the
    // failure surfaced instead of swallowed.
    expect(screen.getByText('sk_live_secret')).toBeInTheDocument()
    expect(
      screen.getByText('Could not revoke the key, try again'),
    ).toBeInTheDocument()
  })

  it('shows the monthly usage from fetchUsage', async () => {
    const deps = makeDeps({
      fetchUsage: vi.fn(async () => ({
        month: '2026-01',
        count: 7,
        limit: 100,
      })),
      pathname: '/dashboard/settings',
    })
    render(<DashboardApp deps={deps} />)
    expect(
      await screen.findByText('7 / 100 calls this month'),
    ).toBeInTheDocument()
  })

  it('deletes the account only after both confirmations pass', async () => {
    const deleteUser = vi.fn(async () => undefined)
    const navigate = vi.fn()
    const confirmSpy = vi.fn()
    window.confirm = confirmSpy
    const deps = makeDeps({
      deleteUser,
      navigate,
      pathname: '/dashboard/settings',
    })
    render(<DashboardApp deps={deps} />)
    const deleteButton = await screen.findByRole('button', {
      name: 'Delete account',
    })

    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false)
    fireEvent.click(deleteButton)
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
    expect(deleteUser).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(deleteButton)
    await waitFor(() => expect(deleteUser).toHaveBeenCalledOnce())
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('shows a confirming notice after checkout=success and clears it once pro', async () => {
    history.pushState(null, '', '/dashboard?checkout=success')
    vi.useFakeTimers()
    let call = 0
    const pro: MeResponse = { ...me, user: { ...me.user, plan: 'pro' } }
    const fetchMe = vi.fn(async () => {
      call += 1
      return call < 2 ? me : pro
    })
    const deps = makeDeps({ fetchMe })
    render(<DashboardApp deps={deps} />)
    await vi.waitFor(() =>
      expect(screen.getByText('Payment confirming…')).toBeInTheDocument(),
    )
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() =>
      expect(screen.queryByText('Payment confirming…')).toBeNull(),
    )
  })

  it('gives up polling after the timeout but leaves the notice standing', async () => {
    history.pushState(null, '', '/dashboard?checkout=success')
    vi.useFakeTimers()
    const fetchMe = vi.fn(async () => me)
    const deps = makeDeps({ fetchMe })
    render(<DashboardApp deps={deps} />)
    await vi.waitFor(() =>
      expect(screen.getByText('Payment confirming…')).toBeInTheDocument(),
    )
    await vi.advanceTimersByTimeAsync(30000)
    const callsAtTimeout = fetchMe.mock.calls.length
    expect(screen.getByText('Payment confirming…')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(9000)
    expect(fetchMe.mock.calls.length).toBe(callsAtTimeout)
    expect(screen.getByText('Payment confirming…')).toBeInTheDocument()
  })

  it('reports a failed account deletion as an error instead of failing silently', async () => {
    const deleteUser = vi.fn(async () => {
      throw new Error('down')
    })
    const navigate = vi.fn()
    window.confirm = vi.fn(() => true)
    const deps = makeDeps({
      deleteUser,
      navigate,
      pathname: '/dashboard/settings',
    })
    render(<DashboardApp deps={deps} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete account' }),
    )
    await screen.findByText('Could not delete the account, try again')
    expect(navigate).not.toHaveBeenCalled()
  })
})
