import { useEffect, useRef, useState } from 'react'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import { type StoredKeys, shareLink } from '../session/keys'
import { shareBoard } from '../session/share'
import './share-dialog.css'

export function ShareDialog(props: {
  session: BoardSession
  open: boolean
  onClose: () => void
  share?: (session: BoardSession) => Promise<StoredKeys>
}) {
  const { session, open, onClose } = props
  const share = props.share ?? ((target: BoardSession) => shareBoard(target))
  const snapshot = useSession(session)
  const dialogRef = useRef<HTMLDialogElement>(null)
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
    const dialog = dialogRef.current
    if (!dialog || typeof dialog.showModal !== 'function') {
      return
    }
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

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
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // The link stays selected in the input for a manual copy.
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="share-dialog"
      onClose={onClose}
      open={open || undefined}
    >
      <h2>Share this board</h2>
      {!keys ? (
        <>
          <p>
            Sharing moves the board to the server so others can open it. It
            stays on this device too.
          </p>
          {error ? <p className="error">{error}</p> : null}
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void create()}
          >
            {busy ? 'Creating…' : 'Create link'}
          </button>
        </>
      ) : (
        <>
          <fieldset className="share-role">
            {keys?.editKey ? (
              <label>
                <input
                  type="radio"
                  name="role"
                  aria-label="Can edit"
                  checked={effectiveRole === 'edit'}
                  onChange={() => setRole('edit')}
                />
                Can edit
              </label>
            ) : null}
            {keys?.viewKey ? (
              <label>
                <input
                  type="radio"
                  name="role"
                  aria-label="View only"
                  checked={effectiveRole === 'view'}
                  onChange={() => setRole('view')}
                />
                View only
              </label>
            ) : null}
          </fieldset>
          <div className="share-link">
            <input
              aria-label="Share link"
              readOnly
              value={link ?? ''}
              onFocus={(event) => event.target.select()}
            />
            <button
              type="button"
              onClick={() => void copy()}
              aria-live="polite"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <section className="share-agents">
            <h3>Agents</h3>
            <p>
              Connect Claude Code or any MCP client to this board. Coming with
              the MCP server; see the repository README for progress.
            </p>
          </section>
        </>
      )}
      <button type="button" className="close" onClick={onClose}>
        Close
      </button>
    </dialog>
  )
}
