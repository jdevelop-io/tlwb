import { useEffect, useMemo, useState } from 'react'
import { adoptBrowserBoards } from '../auth/adopt'
import { authClient } from '../auth/client'
import { Notice } from '../board/components/notice'
import { writeKeys } from '../board/session/keys'
import {
  createHostedBoard as defaultCreateHostedBoard,
  ServerError,
} from '../board/session/server'
import {
  createApiKey,
  type DashboardBoard,
  deleteBoard,
  fetchBoards,
  fetchMe,
  fetchUsage,
  type MeResponse,
  openPortal,
  revokeApiKey,
  startCheckout,
} from './api'
import { BoardCard } from './board-card'
import './dashboard.css'
import { Settings } from './settings'

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 30000

export interface DashboardDeps {
  fetchMe: typeof fetchMe
  fetchBoards: typeof fetchBoards
  deleteBoard: typeof deleteBoard
  createApiKey: typeof createApiKey
  revokeApiKey: typeof revokeApiKey
  fetchUsage: typeof fetchUsage
  startCheckout: typeof startCheckout
  openPortal: typeof openPortal
  createHostedBoard: typeof defaultCreateHostedBoard
  signOut: () => Promise<unknown>
  deleteUser: () => Promise<unknown>
  navigate: (path: string) => void
  adopt: () => Promise<unknown>
}

const defaultDeps: DashboardDeps = {
  fetchMe,
  fetchBoards,
  deleteBoard,
  createApiKey,
  revokeApiKey,
  fetchUsage,
  startCheckout,
  openPortal,
  createHostedBoard: defaultCreateHostedBoard,
  signOut: () => authClient.signOut(),
  deleteUser: () => authClient.deleteUser(),
  navigate: (path: string) => location.assign(path),
  adopt: adoptBrowserBoards,
}

export function DashboardApp(props: { deps?: Partial<DashboardDeps> }) {
  const deps = useMemo(() => ({ ...defaultDeps, ...props.deps }), [props.deps])
  const [me, setMe] = useState<MeResponse | null>(null)
  const [boards, setBoards] = useState<DashboardBoard[]>([])
  const [cap, setCap] = useState<number | null>(null)
  const [capMessage, setCapMessage] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await deps.fetchMe()
      if (cancelled) {
        return
      }
      if (!result) {
        deps.navigate('/login?from=/dashboard')
        return
      }
      setMe(result)
    })()
    return () => {
      cancelled = true
    }
  }, [deps])

  useEffect(() => {
    let cancelled = false
    const refreshBoards = async (): Promise<void> => {
      try {
        const result = await deps.fetchBoards()
        if (!cancelled) {
          setBoards(result.boards)
          setCap(result.cap)
        }
      } catch {
        // Keep whatever list is already on screen; the grid stays usable.
      }
    }
    void (async () => {
      try {
        await deps.adopt()
      } catch {
        // adopt() must never block the board list from loading.
      } finally {
        await refreshBoards()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [deps])

  useEffect(() => {
    if (new URLSearchParams(location.search).get('checkout') !== 'success') {
      return
    }
    setConfirming(true)
    let elapsed = 0
    const timer = setInterval(() => {
      void (async () => {
        elapsed += POLL_INTERVAL_MS
        const result = await deps.fetchMe().catch(() => null)
        if (result?.user.plan === 'pro') {
          setMe(result)
          setConfirming(false)
          clearInterval(timer)
          return
        }
        if (elapsed >= POLL_TIMEOUT_MS) {
          // Gives up polling but keeps the notice: the webhook may
          // simply be slow, and there is nothing wrong to report.
          clearInterval(timer)
        }
      })()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [deps])

  useEffect(() => {
    if (!toast) {
      return
    }
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const createBoard = async (): Promise<void> => {
    setCapMessage(false)
    try {
      const hosted = await deps.createHostedBoard()
      writeKeys(hosted.boardId, {
        editKey: hosted.editKey,
        viewKey: hosted.viewKey,
      })
      deps.navigate(`/b/${hosted.boardId}`)
    } catch (error) {
      if (error instanceof ServerError && error.status === 403) {
        setCapMessage(true)
      } else {
        setToast('Could not create the board, try again')
      }
    }
  }

  const deleteBoardById = async (id: string): Promise<void> => {
    try {
      await deps.deleteBoard(id)
      setBoards((current) => current.filter((board) => board.id !== id))
    } catch {
      setToast('Could not delete the board, try again')
    }
  }

  const upgrade = async (interval: 'month' | 'year'): Promise<void> => {
    try {
      const url = await deps.startCheckout(interval)
      location.assign(url)
    } catch {
      setToast('Could not start checkout, try again')
    }
  }

  const signOut = async (): Promise<void> => {
    try {
      await deps.signOut()
      deps.navigate('/')
    } catch {
      setToast('Could not sign out, try again')
    }
  }

  if (!me) {
    return null
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <a href="/" className="dashboard-wordmark">
          tlwb
        </a>
        <div className="dashboard-user">
          {me.user.image ? (
            <img
              src={me.user.image}
              alt={`${me.user.name}'s avatar`}
              className="dashboard-avatar"
            />
          ) : (
            <span className="dashboard-avatar dashboard-avatar-initial">
              {me.user.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="dashboard-user-name">{me.user.name}</span>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {confirming ? <Notice kind="banner">Payment confirming…</Notice> : null}

      <section className="dashboard-boards">
        <div className="dashboard-boards-toolbar">
          <button type="button" onClick={() => void createBoard()}>
            New board
          </button>
          {cap !== null ? (
            <span className="dashboard-gauge">
              {boards.length}/{cap} boards
            </span>
          ) : null}
          {cap !== null && me.billing ? (
            <div className="dashboard-upgrade">
              <button type="button" onClick={() => void upgrade('month')}>
                Upgrade monthly
              </button>
              <button type="button" onClick={() => void upgrade('year')}>
                Upgrade yearly
              </button>
            </div>
          ) : null}
        </div>
        {capMessage ? (
          <p className="dashboard-cap-message">
            You have reached your board limit.
            {me.billing ? (
              <button type="button" onClick={() => void upgrade('month')}>
                Upgrade
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="dashboard-grid">
          {boards.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              onDelete={(id) => void deleteBoardById(id)}
            />
          ))}
        </div>
      </section>

      <Settings user={me.user} billing={me.billing} deps={deps} />

      {toast ? (
        <Notice kind="toast" onClose={() => setToast(null)}>
          {toast}
        </Notice>
      ) : null}
    </div>
  )
}
