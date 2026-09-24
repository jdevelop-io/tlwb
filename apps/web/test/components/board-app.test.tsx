import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBoardDoc, createLocalAwareness } from '@tlwb/store-yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardApp } from '../../src/board/components/board-app'
import { openBoardSession } from '../../src/board/session/board-session'
import { writeKeys } from '../../src/board/session/keys'
import * as shareModule from '../../src/board/session/share'

const identity = { name: 'Ada', color: '#1971C2' }

/** A hosted board never actually dials the network in tests. */
function hostedConnect() {
  return {
    provider: {} as never,
    awareness: createLocalAwareness(createBoardDoc()),
    getStatus: () => 'connected' as const,
    subscribeStatus: () => () => undefined,
    subscribeClose: () => () => undefined,
    reconnect: () => undefined,
    destroy: () => undefined,
  }
}

// createEditor needs a real 2D context to mount; happy-dom has none. A
// chainable no-op stands in: every call and every read is harmless with
// no elements on the board to paint.
beforeEach(() => {
  const noop: () => unknown = () => stub
  const stub: unknown = new Proxy(noop, {
    get: (_target, prop) => (prop === 'canvas' ? undefined : noop),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    stub as RenderingContext,
  )
})

afterEach(() => vi.restoreAllMocks())

describe('BoardApp, share dialog wiring', () => {
  it('offers "Connect an agent" on a hosted board and calls it', async () => {
    const boardId = `ba${Math.random().toString(36).slice(2)}`
    writeKeys(boardId, { editKey: 'e', viewKey: 'v' })
    const session = await openBoardSession({
      boardId,
      fresh: true,
      identity,
      connect: hostedConnect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const onConnectAgent = vi.fn()
    render(
      <BoardApp
        session={session}
        identity={identity}
        account={{ homeHref: '/', onConnectAgent }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect an agent' }),
    )
    expect(onConnectAgent).toHaveBeenCalled()
    await session.destroy()
  })

  it('shows the MCP endpoint on a hosted board with no account', async () => {
    const boardId = `ba${Math.random().toString(36).slice(2)}`
    writeKeys(boardId, { editKey: 'e', viewKey: 'v' })
    const session = await openBoardSession({
      boardId,
      fresh: true,
      identity,
      connect: hostedConnect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<BoardApp session={session} identity={identity} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))
    expect(
      await screen.findByText(`${location.origin}/mcp`),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Connect an agent' }),
    ).toBeNull()
    await session.destroy()
  })

  it('does not offer the callback on a local board even with an account', async () => {
    vi.spyOn(shareModule, 'shareBoard').mockResolvedValue({
      editKey: 'e',
      viewKey: 'v',
    })
    const boardId = `ba${Math.random().toString(36).slice(2)}`
    const session = await openBoardSession({
      boardId,
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    expect(session.getSnapshot().role).toBe('local')
    const onConnectAgent = vi.fn()
    render(
      <BoardApp
        session={session}
        identity={identity}
        account={{ homeHref: '/', onConnectAgent }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() =>
      expect(
        (
          screen.getByRole('textbox', {
            name: 'Share link',
          }) as HTMLInputElement
        ).value,
      ).toContain('#edit=e'),
    )
    // The session never actually adopted hosting: the role stays
    // 'local', so the gate in BoardApp withholds the callback even
    // though the account offers one.
    expect(session.getSnapshot().role).toBe('local')
    expect(
      screen.queryByRole('button', { name: 'Connect an agent' }),
    ).toBeNull()
    expect(
      await screen.findByText(`${location.origin}/mcp`),
    ).toBeInTheDocument()
    await session.destroy()
  })
})
