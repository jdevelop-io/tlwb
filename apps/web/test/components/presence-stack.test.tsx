import { fireEvent, render, screen } from '@testing-library/react'
import type { Peer } from '@tlwb/engine'
import { beforeEach, describe, expect, it } from 'vitest'
import { PresenceStack } from '../../src/board/components/presence-stack'
import type {
  BoardSession,
  SessionSnapshot,
} from '../../src/board/session/board-session'
import { openBoardSession } from '../../src/board/session/board-session'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

const snapshot: SessionSnapshot = {
  boardId: 'ps',
  role: 'edit',
  storage: 'persistent',
  status: 'connected',
  closeCode: null,
}

/** Only what the presence stack reads; peers come straight from awareness. */
function sessionShowing(peers: Peer[]): BoardSession {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    presence: () => ({
      getPeers: () => peers,
      subscribe: () => () => undefined,
    }),
  } as unknown as BoardSession
}

const peer = (color: string): Peer => ({
  id: '2',
  name: 'Mallory',
  color,
  cursor: null,
  selectedIds: [],
  isAgent: false,
})

describe('PresenceStack', () => {
  it('keeps a peer colour that is not a colour out of the style attribute', () => {
    // The awareness protocol is open to anyone holding a link, view
    // links included, and the engine only checks that the colour is a
    // string: a `url(...)` here would have every other participant's
    // browser fetch the writer's address.
    render(
      <PresenceStack
        session={sessionShowing([peer('url(https://attacker.example/beacon)')])}
        identity={identity}
        onRename={() => undefined}
        onShare={() => undefined}
        menu={null}
      />,
    )
    const avatar = screen.getByRole('button', { name: 'Mallory' })
    expect(avatar.getAttribute('style')).not.toContain('url(')
    expect(avatar.getAttribute('style')).toContain('var(--muted)')
  })

  it('paints a well-formed peer colour as it is', () => {
    render(
      <PresenceStack
        session={sessionShowing([peer('#E03131')])}
        identity={identity}
        onRename={() => undefined}
        onShare={() => undefined}
        menu={null}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Mallory' }).getAttribute('style'),
    ).toContain('#E03131')
  })

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

  it('marks the agent avatar with the bot icon and badge', () => {
    render(
      <PresenceStack
        session={sessionShowing([
          {
            id: 'a',
            name: 'Claude',
            color: '#6E56CF',
            cursor: null,
            selectedIds: [],
            isAgent: true,
          },
        ])}
        identity={identity}
        onRename={() => undefined}
        onShare={() => undefined}
        menu={null}
      />,
    )
    const avatar = screen.getByRole('button', { name: 'Claude (agent)' })
    expect(avatar.querySelectorAll('svg')).toHaveLength(2)
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
