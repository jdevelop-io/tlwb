import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { usePeers } from '../hooks/use-peers'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import type { Identity } from '../session/identity'
import { AgentIcon } from './agent-icon'
import './presence-stack.css'

/**
 * A peer's colour arrives over the awareness protocol, where the server
 * gates nothing by role: anyone holding a link, a view link included,
 * publishes whatever string they like and the engine only checks that
 * it is one. It lands in a style attribute here, so `url(...)` would
 * make every other participant's browser fetch an address of the
 * writer's choosing. Only a plain hex colour goes through.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function ringColor(color: string): string {
  return HEX_COLOR.test(color) ? color : 'var(--color-ink-secondary)'
}

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
      style={{ '--ring': ringColor(props.color) } as CSSProperties}
      title={props.name}
      aria-label={props.isAgent ? `${props.name} (agent)` : props.name}
      onClick={props.onClick}
    >
      {props.isAgent ? (
        <>
          <AgentIcon size={16} color="var(--color-agent)" />
          <span className="avatar-badge">
            <AgentIcon size={8} color="#FFFFFF" strokeWidth={2.5} />
          </span>
        </>
      ) : (
        initial
      )}
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
      <div className="presence-avatars">
        {peers.map((peer) => (
          <Avatar
            key={peer.id}
            name={peer.name}
            color={peer.color}
            isAgent={peer.isAgent}
          />
        ))}
      </div>
      {snapshot.role !== 'view' ? (
        <button
          type="button"
          className="button-primary"
          onClick={props.onShare}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <circle
              cx="6"
              cy="12"
              r="2.5"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.8"
            />
            <circle
              cx="17.5"
              cy="5.5"
              r="2.5"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.8"
            />
            <circle
              cx="17.5"
              cy="18.5"
              r="2.5"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.8"
            />
            <path
              d="M8.3 10.8 L15.2 6.8 M8.3 13.2 L15.2 17.2"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          Share
        </button>
      ) : null}
      {props.menu}
    </div>
  )
}
