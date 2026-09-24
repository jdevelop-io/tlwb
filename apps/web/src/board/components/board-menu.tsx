import type { ReactNode } from 'react'
import { listRecents } from '../session/recents'

function relative(updatedAt: number): string {
  const minutes = Math.round((Date.now() - updatedAt) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function BoardMenu(props: { currentId: string; items?: ReactNode }) {
  const recents = listRecents().filter((item) => item.id !== props.currentId)
  return (
    <nav className="board-menu" aria-label="Boards">
      <a href="/b/new">New board</a>
      {recents.length > 0 ? (
        <ul>
          {recents.slice(0, 10).map((item) => (
            <li key={item.id}>
              <a href={`/b/${item.id}`}>
                {item.name || 'Untitled'}{' '}
                <small>{relative(item.updatedAt)}</small>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {props.items}
      <a href="/">Home</a>
    </nav>
  )
}
