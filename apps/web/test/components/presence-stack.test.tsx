import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PresenceStack } from '../../src/board/components/presence-stack'
import { openBoardSession } from '../../src/board/session/board-session'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

describe('PresenceStack', () => {
  it('focuses the rename input once it replaces the avatar', async () => {
    const session = await openBoardSession({
      boardId: 'ps1',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(
      <PresenceStack
        session={session}
        identity={identity}
        onRename={() => undefined}
        onShare={() => undefined}
        menu={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ada' }))
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveFocus()
    await session.destroy()
  })

  it('keeps the menu slot outside the scrolling peer list', async () => {
    const session = await openBoardSession({
      boardId: 'ps2',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(
      <PresenceStack
        session={session}
        identity={identity}
        onRename={() => undefined}
        onShare={() => undefined}
        menu={<div data-testid="menu-marker" />}
      />,
    )
    // A popover nested inside the peer list would inherit its
    // scrolling clip box and get clipped to nothing, exactly like the
    // overflow menu did before this scrolling was scoped to the peer
    // list alone: see presence-stack.css for the full explanation.
    const marker = screen.getByTestId('menu-marker')
    const scrollingPeers = document.querySelector('.presence-avatars')
    expect(scrollingPeers).not.toBeNull()
    expect(scrollingPeers?.contains(marker)).toBe(false)
    await session.destroy()
  })
})
