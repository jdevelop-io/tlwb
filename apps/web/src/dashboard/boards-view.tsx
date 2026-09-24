import type { DashboardBoard, MeResponse } from './api'
import { BoardCard } from './board-card'

const Lock = (props: { size: number }) => (
  <svg
    width={props.size}
    height={props.size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
)

export function BoardsView(props: {
  me: MeResponse
  boards: DashboardBoard[]
  cap: number | null
  capReached: boolean
  onCreate: () => void
  onDelete: (id: string) => void
  onUpgrade: () => void
}) {
  const { boards, cap } = props
  const over = cap !== null && boards.length > cap
  const full = cap !== null && boards.length >= cap
  return (
    <>
      <header className="main-header">
        <h1>My boards</h1>
        <button
          type="button"
          className="button-primary"
          onClick={props.onCreate}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          New board
        </button>
      </header>
      {over || props.capReached ? (
        <div className="quota-banner" role="status">
          <span className="quota-icon">
            <Lock size={20} />
          </span>
          <span className="quota-text">
            {over
              ? `You have ${boards.length} boards on the Free plan (${cap} included). Upgrade or free up space to create more.`
              : 'You have reached your board limit.'}
          </span>
          {props.me.billing ? (
            <button
              type="button"
              className="button-primary quota-upgrade"
              onClick={props.onUpgrade}
            >
              Upgrade
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="board-grid">
        {boards.map((board) => (
          <BoardCard key={board.id} board={board} onDelete={props.onDelete} />
        ))}
        {full ? (
          <div className="ghost-card board-ghost" aria-disabled="true">
            <Lock size={24} />
            <div className="ghost-text">
              <div>Board limit reached</div>
              <div className="caption">Upgrade to create more</div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="ghost-card board-ghost"
            onClick={props.onCreate}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            New board
          </button>
        )}
      </div>
    </>
  )
}
