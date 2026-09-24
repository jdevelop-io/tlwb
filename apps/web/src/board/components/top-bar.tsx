import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import type { AccountProps } from './board-app'
import { BoardMenu } from './board-menu'
import { Logotype } from './logotype'
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

export function TopBar(props: {
  session: BoardSession
  account?: AccountProps
}) {
  const { session, account } = props
  const snapshot = useSession(session)
  const name = useBoardName(session)
  const [draft, setDraft] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
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
      <Logotype size="editor" href={account?.homeHref ?? '/'} />
      <button
        ref={menuButtonRef}
        type="button"
        className="menu-toggle"
        aria-label="tlwb menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <ChevronDown size={16} />
      </button>
      {menuOpen ? (
        <BoardMenu currentId={snapshot.boardId} items={account?.menuItems} />
      ) : null}
      <span className="top-bar-divider" aria-hidden="true" />
      <input
        ref={nameInputRef}
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
      <button
        type="button"
        className="rename"
        aria-label="Rename board"
        onClick={() => nameInputRef.current?.focus()}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span className="indicator">
        {indicator === 'Saved' || indicator === 'Synced' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 12.5 L 9.5 18 L 20 6.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        <span>{indicator}</span>
      </span>
    </header>
  )
}
