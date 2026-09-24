import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Config } from '../config'
import type { Db } from '../db/client'
import type { Extension } from '../extension'
import type { IpLimiter } from '../rate-limit'
import type { RoomRegistry } from '../rooms'
import type { AgentDeps } from './agent-client'
import type { Caller } from './caller'
import { registerAddElements } from './tools/add-elements'
import { registerCreateBoard } from './tools/create-board'
import { registerDeleteElements } from './tools/delete-elements'
import { registerGetBoardScreenshot } from './tools/get-board-screenshot'
import { registerReadBoard } from './tools/read-board'
import { registerUpdateElements } from './tools/update-elements'

export interface McpDeps {
  db: Db
  config: Config
  rooms: RoomRegistry
  /** The board creation bucket, shared with `POST /boards`. */
  createLimiter: IpLimiter
  /**
   * The render bucket, spent only by the two tools that rasterize.
   * Rasterizing blocks the event loop for its whole duration, so the
   * general MCP limit is too generous to bound it on its own.
   */
  renderLimiter: IpLimiter
  extension: Extension
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
 * One server per request: the transport is stateless, and the caller
 * (its address, and its API key identity if any) is captured here for
 * the tools that limit or meter per caller.
 */
export function createMcpServer(deps: McpDeps, caller: Caller): McpServer {
  const server = new McpServer({ name: 'tlwb', version: '0.0.0' })
  registerCreateBoard(server, deps, caller)
  registerReadBoard(server, deps, caller)
  registerAddElements(server, deps, caller)
  registerUpdateElements(server, deps, caller)
  registerDeleteElements(server, deps, caller)
  registerGetBoardScreenshot(server, deps, caller)
  return server
}
