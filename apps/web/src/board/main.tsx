import { nanoid } from 'nanoid'
import { createRoot } from 'react-dom/client'
import { BoardApp } from './components/board-app'
import { NotFound } from './components/not-found'
import { openBoardSession } from './session/board-session'
import { loadIdentity } from './session/identity'
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
  const identity = loadIdentity()
  const session = await openBoardSession({ boardId, fresh, identity })
  if (session === 'not-found') {
    createRoot(root).render(<NotFound />)
    return
  }
  if (import.meta.env.DEV) {
    // End-to-end tests read the store through this handle.
    ;(window as unknown as { tlwb: unknown }).tlwb = { session }
  }
  createRoot(root).render(<BoardApp session={session} identity={identity} />)
}

void main()
