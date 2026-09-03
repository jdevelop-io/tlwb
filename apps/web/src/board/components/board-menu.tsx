import { useState } from 'react'
import type { Me } from '../../auth/client'
import { readKeys } from '../session/keys'
import { listRecents } from '../session/recents'
import { requestAdoption } from '../session/server'

function relative(updatedAt: number): string {
  const minutes = Math.round((Date.now() - updatedAt) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

function AdoptEntry(props: { boardId: string; editKey: string }) {
  const [adopted, setAdopted] = useState(false)

  if (adopted) {
    return (
      <button type="button" disabled>
        In your account
      </button>
    )
  }

  const click = async (): Promise<void> => {
    const result = await requestAdoption([
      { boardId: props.boardId, editKey: props.editKey },
    ])
    if (result.adopted.includes(props.boardId)) {
      setAdopted(true)
    }
  }

  return (
    <button type="button" onClick={() => void click()}>
      Add to my account
    </button>
  )
}

export function BoardMenu(props: {
  currentId: string
  me: Me | null
  hosted: boolean
}) {
  const recents = listRecents().filter((item) => item.id !== props.currentId)
  const keys = readKeys(props.currentId)
  const canAdopt =
    props.me !== null &&
    props.hosted &&
    Boolean(keys?.editKey) &&
    Boolean(keys?.viewKey)
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
      {canAdopt && keys?.editKey ? (
        <AdoptEntry boardId={props.currentId} editKey={keys.editKey} />
      ) : null}
      <a href="/">Home</a>
    </nav>
  )
}
