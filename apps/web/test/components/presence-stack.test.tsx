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
})
