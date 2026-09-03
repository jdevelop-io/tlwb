import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import type { DashboardBoard } from './api'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export function BoardCard(props: {
  board: DashboardBoard
  onDelete: (id: string) => void
}) {
  const { board } = props
  const [thumbnailBroken, setThumbnailBroken] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="board-card">
      <a href={`/b/${board.id}`} className="board-card-thumbnail">
        {thumbnailBroken ? (
          <div className="thumbnail-fallback" />
        ) : (
          <img
            src={`/api/me/boards/${board.id}/thumbnail`}
            alt={`Thumbnail of ${board.name}`}
            loading="lazy"
            onError={() => setThumbnailBroken(true)}
          />
        )}
      </a>
      <div className="board-card-body">
        <div className="board-card-title">
          <a href={`/b/${board.id}`}>{board.name}</a>
          <button
            type="button"
            className="board-card-menu-button"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label={`More about ${board.name}`}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen ? (
            <menu className="board-card-menu">
              <li>
                <a href={`/b/${board.id}`}>Open</a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    if (
                      confirm(`Delete "${board.name}"? This cannot be undone.`)
                    ) {
                      props.onDelete(board.id)
                    }
                  }}
                >
                  Delete
                </button>
              </li>
            </menu>
          ) : null}
        </div>
        <span className="board-card-updated">
          {dateFormat.format(new Date(board.updatedAt))}
        </span>
        <div className="board-card-badges">
          {board.shared ? <span className="badge">Shared</span> : null}
          {board.agent ? <span className="badge">Agent connected</span> : null}
        </div>
      </div>
    </div>
  )
}
