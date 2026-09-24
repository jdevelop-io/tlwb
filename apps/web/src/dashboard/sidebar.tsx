import { AgentIcon } from '../board/components/agent-icon'
import { Logotype } from '../board/components/logotype'

const NAV = [
  { key: 'boards', label: 'Boards', href: '/dashboard' },
  { key: 'agents', label: 'Agents', href: '/dashboard/agents' },
  { key: 'settings', label: 'Settings', href: '/dashboard/settings' },
] as const

function NavIcon(props: { name: (typeof NAV)[number]['key'] }) {
  if (props.name === 'agents') return <AgentIcon size={18} />
  if (props.name === 'boards') {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </svg>
    )
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function Sidebar(props: {
  active: 'boards' | 'agents' | 'settings'
  user: { name: string; image: string | null; plan: 'free' | 'pro' }
  boardCount: number
  cap: number | null
  billing: boolean
  onUpgrade: () => void
}) {
  const { user, boardCount, cap } = props
  const free = user.plan === 'free' && cap !== null
  const plan = free
    ? `Free · ${boardCount}/${cap} boards`
    : `Pro · ${boardCount} boards`
  return (
    <aside className="sidebar">
      <Logotype size="sidebar" href="/" />
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <a
            key={item.key}
            href={item.href}
            className="nav-item"
            aria-current={props.active === item.key ? 'page' : undefined}
          >
            <NavIcon name={item.key} />
            {item.label}
          </a>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-account">
        <div className="account-user">
          {user.image ? (
            <img className="avatar-ring" src={user.image} alt="" />
          ) : (
            <span className="avatar-ring">
              {user.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            <div className="account-name">{user.name}</div>
            <div className="account-plan">{plan}</div>
          </div>
        </div>
        {free ? (
          <div className="account-gauge">
            <div
              className="gauge-track"
              role="progressbar"
              aria-label="Boards used"
              aria-valuemin={0}
              aria-valuemax={cap}
              aria-valuenow={boardCount}
            >
              <div
                className="gauge-fill"
                style={{ width: `${Math.min(100, (boardCount / cap) * 100)}%` }}
              />
            </div>
            {props.billing ? (
              <button
                type="button"
                className="gauge-upgrade"
                onClick={props.onUpgrade}
              >
                Upgrade
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
