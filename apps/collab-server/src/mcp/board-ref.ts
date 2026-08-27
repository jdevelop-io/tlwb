import { findBoard } from '../db/boards'
import type { Db } from '../db/client'
import { type Role, resolveRole } from '../keys'
import { ToolError } from './tool-error'

export interface BoardRef {
  boardId: string
  key: string
}

export const BOARD_URL_HELP =
  'board must be a share URL like https://<host>/b/<id>#edit=<key> or #view=<key>'

// Same id alphabet and length bounds as the WebSocket path in ws.ts.
const BOARD_PATH = /^\/b\/([A-Za-z0-9_-]{8,64})$/
const FRAGMENT = /^(?:edit|view)=([A-Za-z0-9_-]+)$/

// A private base an absolute URL never has, used only to parse a
// host-less reference (`/b/<id>#edit=<key>`, as `create_board` returns
// when `PUBLIC_URL` is unset and `CORS_ORIGIN` is `*`) the same way as
// an absolute one. The host it would carry is never read.
const RELATIVE_BASE = 'http://mcp-relative.invalid'

/**
 * Only the path and the fragment are read: a self-hosted deployment
 * accepts its own links, and one without a public origin configured
 * still accepts the relative link it handed the agent. A key in the
 * query string is refused rather than tolerated, so nobody learns to
 * put it there.
 */
export function parseBoardRef(input: string): BoardRef {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    try {
      url = new URL(input, RELATIVE_BASE)
    } catch {
      throw new ToolError(BOARD_URL_HELP)
    }
  }
  const path = BOARD_PATH.exec(url.pathname)
  const fragment = FRAGMENT.exec(url.hash.slice(1))
  if (!path?.[1] || !fragment?.[1] || url.search !== '') {
    throw new ToolError(BOARD_URL_HELP)
  }
  return { boardId: path[1], key: fragment[1] }
}

export async function resolveBoardRole(db: Db, ref: BoardRef): Promise<Role> {
  const board = await findBoard(db, ref.boardId)
  if (!board) {
    throw new ToolError(`board ${ref.boardId} not found`)
  }
  const role = resolveRole(ref.key, board)
  if (!role) {
    throw new ToolError(`key does not match board ${ref.boardId}`)
  }
  return role
}
