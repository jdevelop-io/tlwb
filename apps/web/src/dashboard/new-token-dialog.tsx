import { useEffect, useMemo, useState } from 'react'
import { useModalDialog } from '../board/hooks/use-modal-dialog'
import type { ApiKeySummary } from './api'
import './dashboard.css'

const POLL_MS = 3000

export function NewTokenDialog(props: {
  open: boolean
  boards: { id: string; name: string }[]
  presetBoardId?: string
  createApiKey: (input: {
    name: string
    boardIds: string[] | null
  }) => Promise<{ id: string; key: string }>
  fetchApiKeys: () => Promise<ApiKeySummary[]>
  onClose: () => void
}) {
  const dialogRef = useModalDialog(props.open)
  const [name, setName] = useState('Claude')
  const [scope, setScope] = useState<'all' | 'some'>(
    props.presetBoardId ? 'some' : 'all',
  )
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(props.presetBoardId ? [props.presetBoardId] : []),
  )
  const [created, setCreated] = useState<{ id: string; key: string } | null>(
    null,
  )
  const [connected, setConnected] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open || !created || connected) {
      return
    }
    const timer = setInterval(() => {
      void props
        .fetchApiKeys()
        .then((keys) => {
          if (keys.find((key) => key.id === created.id)?.lastUsedAt) {
            setConnected(true)
          }
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [props.open, created, connected, props.fetchApiKeys])

  // The dialog stays mounted between opens (its parent only toggles
  // `open`), so closing it must reset everything scoped to one run:
  // otherwise the next open would resume mid-flow, and the previous
  // token's key would linger in memory instead of going away with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: presetBoardId only seeds the reset, it must not itself trigger one
  useEffect(() => {
    if (props.open) {
      return
    }
    setName('Claude')
    setScope(props.presetBoardId ? 'some' : 'all')
    setChecked(new Set(props.presetBoardId ? [props.presetBoardId] : []))
    setCreated(null)
    setConnected(false)
    setCopied(false)
    setError(null)
  }, [props.open])

  const snippet = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            tlwb: {
              type: 'http',
              url: `${location.origin}/mcp`,
              headers: { Authorization: `Bearer ${created?.key ?? ''}` },
            },
          },
        },
        null,
        2,
      ),
    [created],
  )

  const create = async (): Promise<void> => {
    setError(null)
    try {
      setCreated(
        await props.createApiKey({
          name: name.trim(),
          boardIds: scope === 'some' ? [...checked] : null,
        }),
      )
    } catch {
      setError('Could not create the token, try again')
    }
  }

  const toggle = (id: string): void =>
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
    } catch {
      // The snippet stays selectable for a manual copy.
    }
  }

  const canCreate =
    name.trim().length > 0 && (scope === 'all' || checked.size > 0)

  return (
    <dialog
      ref={dialogRef}
      className="dialog new-token"
      onClose={props.onClose}
    >
      <header className="dialog-header">
        <h2 className="dialog-title">New token</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="Close"
          onClick={props.onClose}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M18 6 6 18M6 6l12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <section className="step">
        <span className="step-number">1</span>
        <div className="step-body">
          <h3>Name your token</h3>
          <input
            aria-label="Token name"
            value={name}
            disabled={created !== null}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="scope">
            <label>
              <input
                type="radio"
                name="scope"
                aria-label="All boards"
                checked={scope === 'all'}
                disabled={created !== null}
                onChange={() => setScope('all')}
              />
              All boards
            </label>
            <label>
              <input
                type="radio"
                name="scope"
                aria-label="Only specific boards"
                checked={scope === 'some'}
                disabled={created !== null}
                onChange={() => setScope('some')}
              />
              Only specific boards
            </label>
          </div>
          {scope === 'all' ? (
            <p className="caption">
              All boards is the default. You can restrict this token to specific
              boards.
            </p>
          ) : (
            <>
              <ul className="board-picker">
                {props.boards.map((board) => (
                  <li key={board.id}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={board.name}
                        checked={checked.has(board.id)}
                        disabled={created !== null}
                        onChange={() => toggle(board.id)}
                      />
                      {board.name}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="caption caption-strong">
                {checked.size} {checked.size === 1 ? 'board' : 'boards'}{' '}
                selected
              </p>
              <p className="caption">
                Your agent will only see the boards you check.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="step">
        <span className="step-number">2</span>
        <div className="step-body">
          <h3>Add tlwb to your MCP client</h3>
          <p className="step-sub">
            Paste this configuration into Claude Code, Claude Desktop, or any
            MCP client.
          </p>
          {created ? (
            <div className="snippet">
              <pre>{snippet}</pre>
              <button
                type="button"
                className="snippet-copy"
                aria-label={copied ? 'Copied' : 'Copy configuration'}
                onClick={() => void copy()}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button-primary"
              disabled={!canCreate}
              onClick={() => void create()}
            >
              Create token
            </button>
          )}
          {error ? <p className="error">{error}</p> : null}
        </div>
      </section>

      <section className="step">
        <span className="step-number">3</span>
        <div className="step-body">
          <h3>Test the connection</h3>
          <p className="step-sub">
            Ask your agent to read one of your boards. This chip flips the
            moment its first call arrives.
          </p>
          <span className={`chip${connected ? ' chip-connected' : ''}`}>
            <span className="dot" aria-hidden="true" />
            {connected ? 'Connected' : 'Waiting for your agent...'}
          </span>
        </div>
      </section>

      <footer className="dialog-footer">
        <hr className="divider" />
        <div className="dialog-actions">
          <button
            type="button"
            className="button-quiet"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={props.onClose}
          >
            Done
          </button>
        </div>
      </footer>
    </dialog>
  )
}
