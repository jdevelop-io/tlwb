import { nanoid } from 'nanoid'
import { createRoot } from 'react-dom/client'
import { fetchSession } from '../auth/client'
import { BoardApp } from './components/board-app'
import { NotFound } from './components/not-found'
import { openBoardSession } from './session/board-session'
import { identityFor, loadIdentity } from './session/identity'
import {
  keysFromFragment,
  readAlias,
  readKeys,
  writeKeys,
} from './session/keys'

async function main(): Promise<void> {
  const root = document.getElementById('root')
  if (!root) {
    return
  }
  // Started before the (mostly synchronous) board lookup below so it
  // overlaps with it rather than adding to the critical path.
  const mePromise = fetchSession()
  const match = /^\/b\/([A-Za-z0-9_-]+)$/.exec(location.pathname)
  if (!match) {
    location.replace('/')
    return
  }
  let boardId = match[1] as string
  let fresh = false
  if (boardId === 'new') {
    boardId = nanoid()
    fresh = true
    history.replaceState(null, '', `/b/${boardId}`)
  }
  const alias = readAlias(boardId)
  if (alias) {
    location.replace(`/b/${alias}${location.hash}`)
    return
  }
  const fromFragment = keysFromFragment(location.hash)
  if (fromFragment) {
    writeKeys(boardId, { ...readKeys(boardId), ...fromFragment })
    history.replaceState(null, '', `/b/${boardId}`)
  }
  const me = await mePromise
  const identity = identityFor(loadIdentity(), me)
  const session = await openBoardSession({ boardId, fresh, identity })
  if (session === 'not-found') {
    createRoot(root).render(<NotFound />)
    return
  }
  if (navigator.webdriver) {
    // End-to-end tests read the store through this handle. Gated on
    // automation rather than on the development build, so the journeys
    // exercise the same bundle Caddy serves; a link cannot turn it on,
    // and a browser nobody is driving never sets this flag.
    ;(window as unknown as { tlwb: unknown }).tlwb = { session }
  }
  createRoot(root).render(
    <BoardApp session={session} identity={identity} me={me} />,
  )
}

void main()
