import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Config } from '../config'
import type { Db } from '../db/client'
import type { IpLimiter } from '../rate-limit'
import type { RoomRegistry } from '../rooms'
import type { AgentDeps } from './agent-client'
import { registerAddElements } from './tools/add-elements'
import { registerCreateBoard } from './tools/create-board'
import { registerDeleteElements } from './tools/delete-elements'
import { registerReadBoard } from './tools/read-board'
import { registerUpdateElements } from './tools/update-elements'

export interface McpDeps {
  db: Db
  config: Config
  rooms: RoomRegistry
  /** The board creation bucket, shared with `POST /boards`. */
  createLimiter: IpLimiter
  now?: () => number
}

export function agentDeps(deps: McpDeps): AgentDeps {
  return {
    db: deps.db,
    rooms: deps.rooms,
    presenceMs: deps.config.mcpPresenceMs,
  }
}

export function shareUrls(
  config: Config,
  boardId: string,
  editKey: string,
  viewKey: string,
): { editUrl: string; viewUrl: string } {
  // `*` opens CORS to every origin but names none: fall back to a
  // relative link the operator's own host completes.
  const base = config.publicUrl === '*' ? '' : config.publicUrl
  return {
    editUrl: `${base}/b/${boardId}#edit=${editKey}`,
    viewUrl: `${base}/b/${boardId}#view=${viewKey}`,
  }
}

/**
 * One server per request: the transport is stateless, and the calling
 * address is captured here for the tools that limit per address.
 */
export function createMcpServer(deps: McpDeps, ip: string): McpServer {
  const server = new McpServer({ name: 'tlwb', version: '0.0.0' })
  registerCreateBoard(server, deps, ip)
  registerReadBoard(server, deps, ip)
  registerAddElements(server, deps, ip)
  registerUpdateElements(server, deps, ip)
  registerDeleteElements(server, deps, ip)
  return server
}
