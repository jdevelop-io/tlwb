import { useEffect, useMemo, useState } from 'react'
import { adoptBrowserBoards } from '../auth/adopt'
import { authClient } from '../auth/client'
import { Notice } from '../board/components/notice'
import { writeKeys } from '../board/session/keys'
import {
  createHostedBoard as defaultCreateHostedBoard,
  ServerError,
} from '../board/session/server'
import { AgentsView } from './agents-view'
import {
  type ApiKeySummary,
  createApiKey,
  type DashboardBoard,
  deleteBoard,
  fetchApiKeys,
  fetchBoards,
  fetchMe,
  fetchUsage,
  type MeResponse,
  openPortal,
  revokeApiKey,
  startCheckout,
} from './api'
import { BoardsView } from './boards-view'
import './dashboard.css'
import { NewTokenDialog } from './new-token-dialog'
import { Settings } from './settings'
import { Sidebar } from './sidebar'

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 30000

export interface DashboardDeps {
  fetchMe: typeof fetchMe
  fetchBoards: typeof fetchBoards
  deleteBoard: typeof deleteBoard
  startCheckout: typeof startCheckout
  openPortal: typeof openPortal
  createHostedBoard: typeof defaultCreateHostedBoard
  fetchApiKeys: typeof fetchApiKeys
  fetchUsage: typeof fetchUsage
  createApiKey: typeof createApiKey
  revokeApiKey: typeof revokeApiKey
  signOut: () => Promise<unknown>
  deleteUser: () => Promise<unknown>
  navigate: (path: string) => void
  adopt: () => Promise<unknown>
  pathname?: string
}

const defaultDeps: DashboardDeps = {
  fetchMe,
  fetchBoards,
  deleteBoard,
  startCheckout,
  openPortal,
  createHostedBoard: defaultCreateHostedBoard,
  fetchApiKeys,
  fetchUsage,
  createApiKey,
  revokeApiKey,
  signOut: () => authClient.signOut(),
  deleteUser: () => authClient.deleteUser(),
  navigate: (path: string) => location.assign(path),
  adopt: adoptBrowserBoards,
}

function viewFor(pathname: string): 'boards' | 'agents' | 'settings' {
  return pathname.endsWith('/agents')
    ? 'agents'
    : pathname.endsWith('/settings')
      ? 'settings'
      : 'boards'
}

export function DashboardApp(props: { deps?: Partial<DashboardDeps> }) {
  const deps = useMemo(() => ({ ...defaultDeps, ...props.deps }), [props.deps])
  const [me, setMe] = useState<MeResponse | null>(null)
  const [boards, setBoards] = useState<DashboardBoard[]>([])
  const [cap, setCap] = useState<number | null>(null)
  const [capMessage, setCapMessage] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([])
  const [usage, setUsage] = useState<{
    count: number
    limit: number
  } | null>(null)
  const [newTokenOpen, setNewTokenOpen] = useState(false)
  const view = viewFor(deps.pathname ?? location.pathname)

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

  const refreshKeys = async (): Promise<void> => {
    try {
      setApiKeys(await deps.fetchApiKeys())
    } catch {
      // Keep whatever list is already on screen; the agents view stays usable.
    }
  }

  const refreshUsage = async (): Promise<void> => {
    try {
      setUsage(await deps.fetchUsage())
    } catch {
      // Informational only; the agents view stays usable without it.
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKeys/refreshUsage are redefined every render, only their call needs to react to view/deps
  useEffect(() => {
    if (view !== 'agents') {
      return
    }
    void refreshKeys()
    void refreshUsage()
  }, [view, deps])

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

  const revoke = async (id: string): Promise<void> => {
    try {
      await deps.revokeApiKey(id)
      setApiKeys((current) => current.filter((key) => key.id !== id))
    } catch {
      setToast('Could not revoke the token, try again')
    }
  }

  if (!me) {
    return null
  }

  return (
    <div className="dashboard">
      <Sidebar
        active={view}
        user={me.user}
        boardCount={boards.length}
        cap={cap}
        billing={me.billing}
        onUpgrade={() => void upgrade('month')}
      />
      <main className="dashboard-main">
        {confirming ? <Notice kind="banner">Payment confirming…</Notice> : null}
        {view === 'boards' ? (
          <BoardsView
            me={me}
            boards={boards}
            cap={cap}
            capReached={capMessage}
            onCreate={() => void createBoard()}
            onDelete={(id) => void deleteBoardById(id)}
            onUpgrade={() => void upgrade('month')}
          />
        ) : view === 'agents' ? (
          <AgentsView
            keys={apiKeys}
            usage={usage}
            onRevoke={(id) => void revoke(id)}
            onOpenNewToken={() => setNewTokenOpen(true)}
          />
        ) : (
          <Settings
            user={me.user}
            billing={me.billing}
            deps={deps}
            onSignOut={() => void signOut()}
          />
        )}
      </main>
      <NewTokenDialog
        open={newTokenOpen}
        boards={boards}
        createApiKey={deps.createApiKey}
        fetchApiKeys={deps.fetchApiKeys}
        onClose={() => {
          setNewTokenOpen(false)
          void refreshKeys()
        }}
      />
      {toast ? (
        <Notice kind="toast" onClose={() => setToast(null)}>
          {toast}
        </Notice>
      ) : null}
    </div>
  )
}
