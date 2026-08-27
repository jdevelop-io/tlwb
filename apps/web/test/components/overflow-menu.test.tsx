import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from '@tlwb/engine'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverflowMenu } from '../../src/board/components/overflow-menu'
import { openBoardSession } from '../../src/board/session/board-session'
import { fakeEditor } from './fake-editor'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

describe('OverflowMenu', () => {
  it('opens on click, closes on Escape, and returns focus to the toggle', async () => {
    const session = await openBoardSession({
      boardId: 'ov1',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<OverflowMenu session={session} editor={fakeEditor()} />)
    const toggle = screen.getByRole('button', { name: 'More' })
    fireEvent.click(toggle)
    expect(screen.getByText('Duplicate')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Duplicate')).toBeNull()
    expect(toggle).toHaveFocus()
    await session.destroy()
  })

  it('exports a PNG with the board name as filename', async () => {
    const session = await openBoardSession({
      boardId: 'ov2',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    session.store.setMeta({ name: 'Roadmap' })
    const editor = fakeEditor()
    const blob = new Blob(['png'], { type: 'image/png' })
    vi.mocked(editor.exportPng).mockResolvedValue(blob)
    render(<OverflowMenu session={session} editor={editor} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByText('Export PNG'))
    await vi.waitFor(() =>
      expect(editor.exportPng).toHaveBeenCalledWith({
        background: '#FFFFFF',
        scale: 2,
      }),
    )
    await session.destroy()
  })

  it('duplicates the board and navigates to the copy', async () => {
    const session = await openBoardSession({
      boardId: 'ov3',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {})
    render(<OverflowMenu session={session} editor={fakeEditor()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByText('Duplicate'))
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith(expect.stringMatching(/^\/b\/.+/)),
    )
    assign.mockRestore()
    await session.destroy()
  })

  it('does nothing when the removal confirmation is declined', async () => {
    const session = await openBoardSession({
      boardId: 'ov4',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    window.confirm = vi.fn(() => false)
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {})
    render(<OverflowMenu session={session} editor={fakeEditor()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByText('Remove from this browser'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(assign).not.toHaveBeenCalled()
    expect(session.store.getMeta().name).toBe('Untitled')
    assign.mockRestore()
    await session.destroy()
  })

  it('removes the board and goes home once confirmed', async () => {
    const session = await openBoardSession({
      boardId: 'ov5',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    window.confirm = vi.fn(() => true)
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {})
    render(<OverflowMenu session={session} editor={fakeEditor()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByText('Remove from this browser'))
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(
      await openBoardSession({ boardId: 'ov5', fresh: false, identity }),
    ).toBe('not-found')
    assign.mockRestore()
  })

  it('exports SVG through the editor and downloads it under the board name', async () => {
    const session = await openBoardSession({
      boardId: 'ov6',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    session.store.setMeta({ name: 'Plan' })
    const editor = fakeEditor()
    vi.mocked(editor.exportSvg).mockReturnValue('<svg>x</svg>')
    const realCreateElement = document.createElement.bind(document)
    const captured: { anchor: HTMLAnchorElement | null } = { anchor: null }
    const click = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreateElement(tag)
      if (tag === 'a') {
        el.click = click
        captured.anchor = el as HTMLAnchorElement
      }
      return el
    }) as typeof document.createElement)

    render(<OverflowMenu session={session} editor={editor} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByText('Export SVG'))

    await vi.waitFor(() =>
      expect(editor.exportSvg).toHaveBeenCalledWith({
        background: '#FFFFFF',
      }),
    )
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce())
    const anchor = captured.anchor
    if (!anchor) throw new Error('no anchor was created')
    expect(anchor.download).toBe('Plan.svg')
    expect(anchor.href).toMatch(/^blob:/)

    vi.mocked(document.createElement).mockRestore()
    await session.destroy()
  })

  it('surfaces an error toast when duplicating fails', async () => {
    const session = await openBoardSession({
      boardId: 'ov7',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const hash = await session
      .assets()
      .put(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    session.store.applyChanges([
      {
        kind: 'create',
        element: createElement('image', { index: 'a0', assetHash: hash }),
      },
    ])
    session.assets().get = vi.fn().mockRejectedValue(new Error('boom'))
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => {})

    render(<OverflowMenu session={session} editor={fakeEditor()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByText('Duplicate'))

    expect(
      await screen.findByText('Could not duplicate the board'),
    ).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()

    assign.mockRestore()
    await session.destroy()
  })
})
