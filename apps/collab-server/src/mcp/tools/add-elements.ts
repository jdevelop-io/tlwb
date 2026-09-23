import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type BoardChange,
  type BoardElement,
  createElement,
  type ElementProps,
  type ElementType,
  indexAfter,
} from '@tlwb/engine'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { assertBoardAllowed, assertCaller, type Caller } from '../caller'
import { agentDeps, type McpDeps } from '../server'
import { guarded, jsonResult, ToolError } from '../tool-error'
import {
  agentNameParam,
  type ElementInput,
  elementInputSchema,
  presenceFor,
} from './elements'
import { boardParam } from './read-board'

function build(input: ElementInput, index: string): BoardElement {
  const { type, id, ...props } = input
  return createElement(type as ElementType, {
    index,
    id,
    ...(props as ElementProps),
  })
}

export function registerAddElements(
  server: McpServer,
  deps: McpDeps,
  caller: Caller,
): void {
  server.registerTool(
    'add_elements',
    {
      description:
        'Add elements to a board (rectangle, ellipse, diamond, line, arrow, draw, text). Unspecified style takes the editor defaults. Set `id` on a shape to bind an arrow to it in the same batch. The whole batch is refused if one element is invalid.',
      inputSchema: {
        board: boardParam,
        elements: elementInputSchema(deps.config.mcpMaxBatch),
        agentName: agentNameParam,
      },
    },
    ({ board, elements, agentName }) => {
      const context: { tool: string; boardId?: string } = {
        tool: 'add_elements',
      }
      return guarded(context, async () => {
        await assertCaller(deps, caller)
        const ref = parseBoardRef(board)
        assertBoardAllowed(caller, ref.boardId)
        context.boardId = ref.boardId
        if (elements.some((element) => element.type === 'image')) {
          throw new ToolError('image elements cannot be added over MCP')
        }
        return withBoard(agentDeps(deps), ref, 'edit', async (client) => {
          // A create with an id already on the board replaces it
          // (`store.ts`'s `elements.set`), so a collision here must
          // refuse the whole batch rather than silently overwrite, the
          // same way an unknown id refuses update_elements and
          // delete_elements.
          const seen = new Set<string>()
          for (const input of elements) {
            if (input.id === undefined) {
              continue
            }
            if (seen.has(input.id) || client.store.getElement(input.id)) {
              throw new ToolError(`element ${input.id} already exists`)
            }
            seen.add(input.id)
          }
          let index = client.store.listElements().at(-1)?.index ?? null
          const created = elements.map((input) => {
            index = indexAfter(index)
            return build(input, index)
          })
          const changes: BoardChange[] = created.map((element) => ({
            kind: 'create',
            element,
          }))
          await client.mutate((store) => store.applyChanges(changes, 'remote'))
          client.present(presenceFor(created, agentName))
          return jsonResult({ ids: created.map((element) => element.id) })
        })
      })
    },
  )
}
