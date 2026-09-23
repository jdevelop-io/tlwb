import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import type { DashboardBoard } from './api'
import { relativeTime } from './relative-time'

export function BoardCard(props: {
  board: DashboardBoard
  onDelete: (id: string) => void
}) {
  const { board } = props
  const [thumbnailBroken, setThumbnailBroken] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="board-card">
      <button
        type="button"
        className="card-more"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        aria-label={`More about ${board.name}`}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={16} />
      </button>
      {menuOpen ? (
        <menu className="card-menu">
          <li>
            <a href={`/b/${board.id}`}>Open</a>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                if (confirm(`Delete "${board.name}"? This cannot be undone.`)) {
                  props.onDelete(board.id)
                }
              }}
            >
              Delete
            </button>
          </li>
        </menu>
      ) : null}
      <a href={`/b/${board.id}`} className="card-thumb">
        {thumbnailBroken ? (
          <span className="card-empty">nothing here yet...</span>
        ) : (
          <img
            src={`/api/me/boards/${board.id}/thumbnail`}
            alt={`Thumbnail of ${board.name}`}
            loading="lazy"
            onError={() => setThumbnailBroken(true)}
          />
        )}
      </a>
      <div className="card-body">
        <a href={`/b/${board.id}`} className="card-name">
          {board.name}
        </a>
        <div className="card-row">
          <span className="card-time">
            Edited {relativeTime(board.updatedAt)}
          </span>
          {board.shared ? <span className="pill">Shared</span> : null}
          {board.agent ? <span className="pill pill-agent">Claude</span> : null}
        </div>
      </div>
    </div>
  )
}
