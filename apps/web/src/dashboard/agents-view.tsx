import { AgentIcon } from '../board/components/agent-icon'
import type { ApiKeySummary, DashboardBoard } from './api'
import { relativeTime } from './relative-time'

const KeyIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="8" cy="16" r="3.5" />
    <path d="M10.5 13.5 19 5" />
    <path d="M15.5 8.5l3 3" />
  </svg>
)

const Plus = (props: { size: number }) => (
  <svg
    width={props.size}
    height={props.size}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      d="M12 5v14M5 12h14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

function activity(lastUsedAt: string | null, now: number): string {
  if (!lastUsedAt) {
    return 'Never used'
  }
  return `Active ${relativeTime(lastUsedAt, now).replace(/^(\d+)m ago$/, '$1 min ago')}`
}

export function AgentsView(props: {
  keys: ApiKeySummary[]
  boards: DashboardBoard[]
  onRevoke: (id: string) => void
  onOpenNewToken: () => void
  now?: number
}) {
  const now = props.now ?? Date.now()
  return (
    <>
      <header className="main-header">
        <div>
          <h1>Agents</h1>
          <p className="main-subline">
            Connect your AI agents to your boards through MCP.
          </p>
        </div>
        <button
          type="button"
          className="button-primary"
          onClick={props.onOpenNewToken}
        >
          <Plus size={16} />
          New token
        </button>
      </header>
      <ul className="token-list">
        {props.keys.map((key) => (
          <li key={key.id} className="token-card">
            <span
              className={`token-icon${key.lastUsedAt ? ' token-icon-agent' : ''}`}
            >
              {key.lastUsedAt ? (
                <AgentIcon size={20} color="var(--color-agent)" />
              ) : (
                <KeyIcon />
              )}
            </span>
            <div className="token-text">
              <div className="token-name">{key.name || 'Unnamed token'}</div>
              <div className="token-meta">
                <span>
                  {key.boardIds
                    ? `${key.boardIds.length} boards`
                    : 'All boards'}
                </span>
                <span aria-hidden="true">·</span>
                {key.lastUsedAt ? (
                  <span className="dot dot-success" aria-hidden="true" />
                ) : null}
                <span>{activity(key.lastUsedAt, now)}</span>
              </div>
            </div>
            <button
              type="button"
              className="button-quiet token-revoke"
              onClick={() => props.onRevoke(key.id)}
            >
              Revoke
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="ghost-card token-ghost"
            onClick={props.onOpenNewToken}
          >
            <Plus size={16} />
            New token
          </button>
        </li>
      </ul>
      <p className="caption">
        Revoking a token disconnects its agent immediately.
      </p>
    </>
  )
}
