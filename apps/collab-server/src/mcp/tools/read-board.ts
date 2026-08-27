import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { agentDeps, type McpDeps } from '../server'
import { guarded, jsonResult } from '../tool-error'

export const boardParam = z
  .string()
  .describe(
    'Share URL of the board: https://<host>/b/<id>#edit=<key> or #view=<key>',
  )

export function registerReadBoard(
  server: McpServer,
  deps: McpDeps,
  _ip: string,
): void {
  server.registerTool(
    'read_board',
    {
      description:
        'Read a board: its meta (name, createdAt) and every element in stacking order, exactly as the editor holds them.',
      inputSchema: { board: boardParam },
    },
    ({ board }) =>
      guarded({ tool: 'read_board' }, async () => {
        const ref = parseBoardRef(board)
        return withBoard(agentDeps(deps), ref, 'view', async (client) =>
          jsonResult({
            meta: client.store.getMeta(),
            elements: client.store.listElements(),
          }),
        )
      }),
  )
}
