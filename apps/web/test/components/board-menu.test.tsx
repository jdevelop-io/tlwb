import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../src/auth/client'
import { BoardMenu } from '../../src/board/components/board-menu'
import { writeKeys } from '../../src/board/session/keys'

const me: Me = { name: 'Ada', email: 'ada@x.com', image: null, plan: 'free' }

function respond(status: number, body?: unknown) {
  return vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('BoardMenu', () => {
  it('offers no adoption entry when signed out', () => {
    writeKeys('b1', { editKey: 'e1', viewKey: 'v1' })
    render(<BoardMenu currentId="b1" me={null} hosted={true} />)
    expect(screen.queryByText('Add to my account')).toBeNull()
  })

  it('offers no adoption entry when the board is not hosted', () => {
    writeKeys('b1', { editKey: 'e1', viewKey: 'v1' })
    render(<BoardMenu currentId="b1" me={me} hosted={false} />)
    expect(screen.queryByText('Add to my account')).toBeNull()
  })

  it('offers no adoption entry without both keys held locally', () => {
    writeKeys('b1', { editKey: 'e1' })
    render(<BoardMenu currentId="b1" me={me} hosted={true} />)
    expect(screen.queryByText('Add to my account')).toBeNull()
  })

  it('offers adoption when signed in, hosted, and both keys are held', () => {
    writeKeys('b1', { editKey: 'e1', viewKey: 'v1' })
    render(<BoardMenu currentId="b1" me={me} hosted={true} />)
    expect(
      screen.getByRole('button', { name: 'Add to my account' }),
    ).toBeInTheDocument()
  })

  it('posts adoption on click and swaps to a disabled entry on success', async () => {
    writeKeys('b1', { editKey: 'e1', viewKey: 'v1' })
    const fetchFn = respond(200, { adopted: ['b1'], skipped: [] })
    vi.stubGlobal('fetch', fetchFn)
    render(<BoardMenu currentId="b1" me={me} hosted={true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to my account' }))
    const done = await screen.findByRole('button', {
      name: 'In your account',
    })
    expect(done).toBeDisabled()
    expect(screen.queryByText('Add to my account')).toBeNull()
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe('/api/boards/adopt')
    expect(JSON.parse(init.body as string)).toEqual({
      boards: [{ boardId: 'b1', editKey: 'e1' }],
    })
  })

  it('keeps the entry active when adoption is skipped', async () => {
    writeKeys('b1', { editKey: 'e1', viewKey: 'v1' })
    vi.stubGlobal('fetch', respond(200, { adopted: [], skipped: ['b1'] }))
    render(<BoardMenu currentId="b1" me={me} hosted={true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to my account' }))
    await vi.waitFor(() =>
      expect(
        (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBe(1),
    )
    expect(
      screen.getByRole('button', { name: 'Add to my account' }),
    ).toBeInTheDocument()
  })
})
