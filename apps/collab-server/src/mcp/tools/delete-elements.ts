import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BoardChange, BoardElement } from '@tlwb/engine'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { assertCaller, type Caller } from '../caller'
import { agentDeps, type McpDeps } from '../server'
import { guarded, jsonResult, ToolError } from '../tool-error'
import { agentNameParam, idsSchema, presenceFor } from './elements'
import { boardParam } from './read-board'

export function registerDeleteElements(
  server: McpServer,
  deps: McpDeps,
  caller: Caller,
): void {
  server.registerTool(
    'delete_elements',
    {
      description:
        'Delete elements by id. The whole batch is refused if an id is unknown.',
      inputSchema: {
        board: boardParam,
        ids: idsSchema(deps.config.mcpMaxBatch),
        agentName: agentNameParam,
      },
    },
    ({ board, ids, agentName }) => {
      const context: { tool: string; boardId?: string } = {
        tool: 'delete_elements',
      }
      return guarded(context, async () => {
        await assertCaller(deps, caller)
        const ref = parseBoardRef(board)
        context.boardId = ref.boardId
        return withBoard(agentDeps(deps), ref, 'edit', async (client) => {
          const targets: BoardElement[] = []
          for (const id of ids) {
            const element = client.store.getElement(id)
            if (!element) {
              throw new ToolError(`element ${id} not found`)
            }
            targets.push(element)
          }
          const changes: BoardChange[] = ids.map((id) => ({
            kind: 'delete',
            id,
          }))
          await client.mutate((store) => store.applyChanges(changes, 'remote'))
          // Bounds read before the deletion: the cursor lands where the
          // last element was.
          const presence = presenceFor(targets, agentName)
          client.present({ ...presence, selectedIds: [] })
          return jsonResult({ deleted: ids })
        })
      })
    },
  )
}
