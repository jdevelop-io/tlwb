import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TopBar } from '../../src/board/components/top-bar'
import { openBoardSession } from '../../src/board/session/board-session'
import { touchRecent } from '../../src/board/session/recents'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

describe('TopBar', () => {
  it('renames the board through the meta and the document title', async () => {
    const session = await openBoardSession({
      boardId: 'top1',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<TopBar session={session} />)
    const name = screen.getByRole('textbox', { name: 'Board name' })
    expect(name).toHaveValue('Untitled')
    fireEvent.change(name, { target: { value: 'Roadmap' } })
    fireEvent.blur(name)
    expect(session.store.getMeta().name).toBe('Roadmap')
    expect(document.title).toBe('Roadmap · tlwb')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    await session.destroy()
  })

  it('lists recent boards in the menu, current one excluded', async () => {
    touchRecent({ id: 'other', name: 'Other', updatedAt: 1 })
    const session = await openBoardSession({
      boardId: 'top2',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<TopBar session={session} />)
    fireEvent.click(screen.getByRole('button', { name: 'tlwb menu' }))
    expect(screen.getByRole('link', { name: 'New board' })).toHaveAttribute(
      'href',
      '/b/new',
    )
    expect(screen.getByRole('link', { name: /Other/ })).toHaveAttribute(
      'href',
      '/b/other',
    )
    expect(screen.queryByRole('link', { name: /Untitled/ })).toBeNull()
    await session.destroy()
  })

  it('reverts the name and writes nothing to the store on Escape', async () => {
    const session = await openBoardSession({
      boardId: 'top3',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const setMeta = vi.spyOn(session.store, 'setMeta')
    render(<TopBar session={session} />)
    const name = screen.getByRole('textbox', { name: 'Board name' })
    name.focus()
    fireEvent.change(name, { target: { value: 'Discarded' } })
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(name).toHaveValue('Untitled')
    expect(setMeta).not.toHaveBeenCalled()
    await session.destroy()
  })

  it('closes the menu on Escape and returns focus to the toggle', async () => {
    const session = await openBoardSession({
      boardId: 'top4',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<TopBar session={session} />)
    const toggle = screen.getByRole('button', { name: 'tlwb menu' })
    fireEvent.click(toggle)
    expect(
      screen.getByRole('navigation', { name: 'Boards' }),
    ).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('navigation', { name: 'Boards' })).toBeNull()
    expect(toggle).toHaveFocus()
    await session.destroy()
  })

  it('removes the escape listener once the menu is closed', async () => {
    const session = await openBoardSession({
      boardId: 'top5',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<TopBar session={session} />)
    const toggle = screen.getByRole('button', { name: 'tlwb menu' })
    fireEvent.click(toggle) // open
    fireEvent.click(toggle) // close
    const name = screen.getByRole('textbox', { name: 'Board name' })
    name.focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(name).toHaveFocus()
    expect(screen.queryByRole('navigation', { name: 'Boards' })).toBeNull()
    await session.destroy()
  })
})
