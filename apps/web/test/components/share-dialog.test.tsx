import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBoardDoc, createLocalAwareness } from '@tlwb/store-yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareDialog } from '../../src/board/components/share-dialog'
import type { BoardSession } from '../../src/board/session/board-session'
import { openBoardSession } from '../../src/board/session/board-session'
import { writeKeys } from '../../src/board/session/keys'

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

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('ShareDialog', () => {
  it('opens through showModal, not through the open attribute', async () => {
    const session = await openBoardSession({
      boardId: 'sd0',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    // Only showModal gives the backdrop, the focus trap, and dismissal
    // on Escape. Rendering `open` would open the dialog non-modally and,
    // worse, leave `dialog.open` already true by the time the effect
    // runs, so showModal would never fire.
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close')
    const { rerender } = render(
      <ShareDialog session={session} open={false} onClose={() => undefined} />,
    )
    expect(showModal).not.toHaveBeenCalled()
    expect(document.querySelector('dialog')?.open).toBe(false)

    rerender(<ShareDialog session={session} open onClose={() => undefined} />)
    expect(showModal).toHaveBeenCalledOnce()

    rerender(
      <ShareDialog session={session} open={false} onClose={() => undefined} />,
    )
    expect(close).toHaveBeenCalledOnce()
    await session.destroy()
  })

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
    fireEvent.click(screen.getByRole('radio', { name: 'Can view' }))
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

  it('disables Can edit and shows the view link on a view-only board', async () => {
    writeKeys('sd3', { viewKey: 'v' })
    const session = await openBoardSession({
      boardId: 'sd3',
      fresh: true,
      identity,
      connect: hostedConnect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<ShareDialog session={session} open onClose={() => undefined} />)
    expect(screen.getByRole('radio', { name: 'Can edit' })).toBeDisabled()
    expect(
      (screen.getByRole('textbox', { name: 'Share link' }) as HTMLInputElement)
        .value,
    ).toContain('#view=v')
    await session.destroy()
  })

  it('disables Can view on a board reached only through an edit link', async () => {
    writeKeys('sd5', { editKey: 'e' })
    const session = await openBoardSession({
      boardId: 'sd5',
      fresh: true,
      identity,
      connect: hostedConnect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<ShareDialog session={session} open onClose={() => undefined} />)
    expect(screen.getByRole('radio', { name: 'Can view' })).toBeDisabled()
    expect(
      (screen.getByRole('textbox', { name: 'Share link' }) as HTMLInputElement)
        .value,
    ).toContain('#edit=e')
    await session.destroy()
  })

  it('leaves the link selectable when the clipboard write is refused', async () => {
    writeKeys('sd4', { editKey: 'e', viewKey: 'v' })
    const session = await openBoardSession({
      boardId: 'sd4',
      fresh: true,
      identity,
      connect: hostedConnect,
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

describe('ShareDialog, hosted', () => {
  let session: BoardSession
  let boardId: string

  beforeEach(async () => {
    boardId = `sdh${Math.random().toString(36).slice(2)}`
    writeKeys(boardId, { editKey: 'e', viewKey: 'v' })
    const opened = await openBoardSession({
      boardId,
      fresh: true,
      identity,
      connect: hostedConnect,
    })
    if (opened === 'not-found') throw new Error('unexpected')
    session = opened
  })

  afterEach(async () => {
    await session.destroy()
  })

  function renderHosted(props: { onConnectAgent?: () => void } = {}) {
    render(
      <ShareDialog
        session={session}
        open
        onClose={() => undefined}
        onConnectAgent={props.onConnectAgent}
      />,
    )
  }

  it('offers the agent connection and the segmented access control', async () => {
    const onConnectAgent = vi.fn()
    renderHosted({ onConnectAgent })
    expect(screen.getByRole('radio', { name: 'Can view' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Can edit' })).toBeChecked()
    expect(
      screen.getByText('Anyone with the link can jump in, no account needed.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect an agent' }))
    expect(onConnectAgent).toHaveBeenCalled()
  })

  it('shows the MCP endpoint when no agent connection is wired', () => {
    renderHosted()
    expect(screen.queryByRole('link', { name: 'Connect an agent' })).toBeNull()
    expect(screen.getByText(`${location.origin}/mcp`)).toBeInTheDocument()
  })
})
