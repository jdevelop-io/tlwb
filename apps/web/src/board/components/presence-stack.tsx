import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { usePeers } from '../hooks/use-peers'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import type { Identity } from '../session/identity'
import './presence-stack.css'

function Avatar(props: {
  name: string
  color: string
  isAgent: boolean
  onClick?: () => void
}) {
  const initial = props.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <button
      type="button"
      className={`avatar${props.isAgent ? ' avatar-agent' : ''}`}
      style={{ background: props.color }}
      title={props.name}
      aria-label={props.name}
      onClick={props.onClick}
    >
      {initial}
    </button>
  )
}

export function PresenceStack(props: {
  session: BoardSession
  identity: Identity
  onRename: (identity: Identity) => void
  onShare: () => void
  menu: ReactNode
}) {
  const peers = usePeers(props.session)
  const snapshot = useSession(props.session)
  const [renaming, setRenaming] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus()
    }
  }, [renaming])

  return (
    <div className="presence-stack">
      {renaming ? (
        <input
          ref={renameInputRef}
          aria-label="Your name"
          defaultValue={props.identity.name}
          onBlur={(event) => {
            const name = event.target.value.trim()
            if (name) {
              props.onRename({ ...props.identity, name })
            }
            setRenaming(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
        />
      ) : (
        <Avatar
          {...props.identity}
          isAgent={false}
          onClick={() => setRenaming(true)}
        />
      )}
      {peers.map((peer) => (
        <Avatar
          key={peer.id}
          name={peer.name}
          color={peer.color}
          isAgent={peer.isAgent}
        />
      ))}
      {snapshot.role !== 'view' ? (
        <button type="button" className="share" onClick={props.onShare}>
          Share
        </button>
      ) : null}
      {props.menu}
    </div>
  )
}
