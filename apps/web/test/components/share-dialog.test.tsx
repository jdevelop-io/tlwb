import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBoardDoc, createLocalAwareness } from '@tlwb/store-yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareDialog } from '../../src/board/components/share-dialog'
import { openBoardSession } from '../../src/board/session/board-session'
import { writeKeys } from '../../src/board/session/keys'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => {
  localStorage.clear()
  // happy-dom's <dialog> has no showModal; the component guards it.
})

describe('ShareDialog', () => {
  it('offers to create a link on a local board and shows the links after', async () => {
    const session = await openBoardSession({
      boardId: 'sd1',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const share = vi.fn(async () => ({ editKey: 'e', viewKey: 'v' }))
    render(
      <ShareDialog
        session={session}
        open
        onClose={() => undefined}
        share={share}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() => expect(share).toHaveBeenCalledWith(session))
    await waitFor(() =>
      expect(
        (
          screen.getByRole('textbox', {
            name: 'Share link',
          }) as HTMLInputElement
        ).value,
      ).toContain('#edit=e'),
    )
    fireEvent.click(screen.getByRole('radio', { name: 'View only' }))
    expect(
      (screen.getByRole('textbox', { name: 'Share link' }) as HTMLInputElement)
        .value,
    ).toContain('#view=v')
    await session.destroy()
  })

  it('reports a failed share and stays local', async () => {
    const session = await openBoardSession({
      boardId: 'sd2',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const share = vi.fn(async () => {
      throw new Error('down')
    })
    render(
      <ShareDialog
        session={session}
        open
        onClose={() => undefined}
        share={share}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() =>
      expect(
        screen.getByText('Could not create the link, try again'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Create link' })).toBeEnabled()
    await session.destroy()
  })

  it('shows only the links whose keys it holds', async () => {
    writeKeys('sd3', { viewKey: 'v' })
    const session = await openBoardSession({
      boardId: 'sd3',
      fresh: true,
      identity,
      connect: () => ({
        provider: {} as never,
        awareness: createLocalAwareness(createBoardDoc()),
        getStatus: () => 'connected',
        subscribeStatus: () => () => undefined,
        subscribeClose: () => () => undefined,
        reconnect: () => undefined,
        destroy: () => undefined,
      }),
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<ShareDialog session={session} open onClose={() => undefined} />)
    expect(screen.queryByRole('radio', { name: 'Can edit' })).toBeNull()
    expect(
      (screen.getByRole('textbox', { name: 'Share link' }) as HTMLInputElement)
        .value,
    ).toContain('#view=v')
    await session.destroy()
  })

  it('leaves the link selectable when the clipboard write is refused', async () => {
    writeKeys('sd4', { editKey: 'e', viewKey: 'v' })
    const session = await openBoardSession({
      boardId: 'sd4',
      fresh: true,
      identity,
      connect: () => ({
        provider: {} as never,
        awareness: createLocalAwareness(createBoardDoc()),
        getStatus: () => 'connected',
        subscribeStatus: () => () => undefined,
        subscribeClose: () => () => undefined,
        reconnect: () => undefined,
        destroy: () => undefined,
      }),
    })
    if (session === 'not-found') throw new Error('unexpected')
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('denied'),
    )
    render(<ShareDialog session={session} open onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalled(),
    )
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    await session.destroy()
  })
})
