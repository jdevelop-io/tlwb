import { useEffect, useRef, useState } from 'react'
import type { Me } from '../../auth/client'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import { BoardMenu } from './board-menu'
import './top-bar.css'

function useBoardName(session: BoardSession): string {
  const [name, setName] = useState(session.store.getMeta().name)
  useEffect(
    () =>
      session.store.subscribe((event) => {
        if (event.kind === 'meta') {
          setName(event.meta.name)
        }
      }),
    [session],
  )
  useEffect(() => {
    document.title = `${name || 'Untitled'} · tlwb`
  }, [name])
  return name
}

export function TopBar(props: { session: BoardSession; me: Me | null }) {
  const { session, me } = props
  const snapshot = useSession(session)
  const name = useBoardName(session)
  const [draft, setDraft] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLAnchorElement>(null)
  const cancelledRef = useRef(false)

  const commit = (): void => {
    if (cancelledRef.current) {
      cancelledRef.current = false
    } else if (draft !== null && draft.trim() !== name) {
      session.store.setMeta({ name: draft.trim() || 'Untitled' })
    }
    setDraft(null)
  }

  useEffect(() => {
    if (!menuOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  const indicator =
    snapshot.role === 'local'
      ? snapshot.storage === 'memory'
        ? 'Not saved'
        : 'Saved'
      : snapshot.status === 'connected'
        ? 'Synced'
        : 'Offline'

  return (
    <header className="top-bar">
      <a
        ref={menuButtonRef}
        href={me ? '/dashboard' : '/'}
        className="logo"
        aria-label="tlwb menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.preventDefault()
          setMenuOpen((open) => !open)
        }}
      >
        tlwb
      </a>
      {menuOpen ? (
        <BoardMenu
          currentId={snapshot.boardId}
          me={me}
          hosted={snapshot.role !== 'local'}
        />
      ) : null}
      <input
        className="board-name"
        aria-label="Board name"
        value={draft ?? name}
        readOnly={snapshot.role === 'view'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            cancelledRef.current = true
            event.currentTarget.blur()
          }
        }}
      />
      <span className="indicator">{indicator}</span>
    </header>
  )
}
