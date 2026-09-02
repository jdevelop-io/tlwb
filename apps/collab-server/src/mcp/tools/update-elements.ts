import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BoardChange, BoardElement, ElementProps } from '@tlwb/engine'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { assertCaller, type Caller } from '../caller'
import { agentDeps, type McpDeps } from '../server'
import { guarded, jsonResult, ToolError } from '../tool-error'
import { agentNameParam, elementPatchSchema, presenceFor } from './elements'
import { boardParam } from './read-board'

export function registerUpdateElements(
  server: McpServer,
  deps: McpDeps,
  caller: Caller,
): void {
  server.registerTool(
    'update_elements',
    {
      description:
        'Update properties of existing elements. Each entry names an id and only the properties to change; `type` cannot change. The whole batch is refused if an id is unknown or a value is invalid.',
      inputSchema: {
        board: boardParam,
        updates: elementPatchSchema(deps.config.mcpMaxBatch),
        agentName: agentNameParam,
      },
    },
    ({ board, updates, agentName }) => {
      const context: { tool: string; boardId?: string } = {
        tool: 'update_elements',
      }
      return guarded(context, async () => {
        await assertCaller(deps, caller)
        const ref = parseBoardRef(board)
        context.boardId = ref.boardId
        return withBoard(agentDeps(deps), ref, 'edit', async (client) => {
          for (const { id } of updates) {
            if (!client.store.getElement(id)) {
              throw new ToolError(`element ${id} not found`)
            }
          }
          const changes: BoardChange[] = updates.map(({ id, ...props }) => ({
            kind: 'update',
            id,
            props: props as ElementProps,
          }))
          await client.mutate((store) => store.applyChanges(changes, 'remote'))
          const touched = updates
            .map(({ id }) => client.store.getElement(id))
            .filter((element): element is BoardElement => element !== undefined)
          client.present(presenceFor(touched, agentName))
          return jsonResult({ updated: updates.map(({ id }) => id) })
        })
      })
    },
  )
}
