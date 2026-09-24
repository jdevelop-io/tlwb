import { useEffect, useState } from 'react'
import { useModalDialog } from '../hooks/use-modal-dialog'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import { type StoredKeys, shareLink } from '../session/keys'
import { shareBoard } from '../session/share'
import { AgentIcon } from './agent-icon'
import './share-dialog.css'

export function ShareDialog(props: {
  session: BoardSession
  open: boolean
  onClose: () => void
  share?: (session: BoardSession) => Promise<StoredKeys>
  onConnectAgent?: () => void
}) {
  const { session, open, onClose } = props
  const share = props.share ?? ((target: BoardSession) => shareBoard(target))
  const snapshot = useSession(session)
  const dialogRef = useModalDialog(open)
  const [role, setRole] = useState<'edit' | 'view'>('edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Falls back to the session's own keys once a real share migrates it
  // (adoptHosting notifies session.keys() directly); kept for callers
  // (tests, injected `share`) that resolve keys without touching the
  // session.
  const [createdKeys, setCreatedKeys] = useState<StoredKeys | null>(null)

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const keys = session.keys() ?? createdKeys
  const effectiveRole = role === 'edit' && !keys?.editKey ? 'view' : role
  const link = keys
    ? shareLink(location.origin, snapshot.boardId, keys, effectiveRole)
    : null

  const create = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setCreatedKeys(await share(session))
    } catch {
      setError('Could not create the link, try again')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    if (!link || !navigator.clipboard) {
      return
    }
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // The link stays selected in the input for a manual copy.
    }
  }

  return (
    <dialog ref={dialogRef} className="dialog share-dialog" onClose={onClose}>
      <header className="dialog-header">
        <h2 className="dialog-title">Share this board</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="Close"
          onClick={onClose}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      {!keys ? (
        <>
          <p>
            Sharing moves the board to the server so others can open it. It
            stays on this device too.
          </p>
          {error ? <p className="error">{error}</p> : null}
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => void create()}
          >
            {busy ? 'Creating…' : 'Create link'}
          </button>
        </>
      ) : (
        <>
          <div className="share-link">
            <input
              aria-label="Share link"
              readOnly
              value={link ?? ''}
              onFocus={(event) => event.target.select()}
            />
            <button
              type="button"
              className="share-copy"
              aria-live="polite"
              onClick={() => void copy()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <rect
                  x="9"
                  y="9"
                  width="12"
                  height="12"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <fieldset className="share-access">
            <legend>Access</legend>
            <div className="segmented">
              <label>
                <input
                  type="radio"
                  name="role"
                  aria-label="Can view"
                  checked={effectiveRole === 'view'}
                  onChange={() => setRole('view')}
                  disabled={!keys?.viewKey}
                />
                Can view
              </label>
              <label>
                <input
                  type="radio"
                  name="role"
                  aria-label="Can edit"
                  checked={effectiveRole === 'edit'}
                  onChange={() => setRole('edit')}
                  disabled={!keys?.editKey}
                />
                Can edit
              </label>
            </div>
            <p className="caption">
              Anyone with the link can jump in, no account needed.
            </p>
          </fieldset>
          <hr className="divider" />
          <section className="share-agent">
            <span className="share-agent-icon">
              <AgentIcon size={20} color="var(--color-agent)" />
            </span>
            <div>
              <p className="share-agent-title">
                Let your agent work on this board
              </p>
              <p className="caption">
                It joins with its own cursor and draws live, through MCP.
              </p>
            </div>
          </section>
          {props.onConnectAgent ? (
            <button
              type="button"
              className="button-secondary"
              onClick={props.onConnectAgent}
            >
              Connect an agent
            </button>
          ) : (
            <p className="caption share-agent-endpoint">
              Point your agent at <code>{`${location.origin}/mcp`}</code> and
              hand it this board's edit link.
            </p>
          )}
        </>
      )}
    </dialog>
  )
}
