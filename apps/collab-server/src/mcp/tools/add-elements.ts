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
  _ip: string,
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
    ({ board, elements, agentName }) =>
      guarded({ tool: 'add_elements' }, async () => {
        const ref = parseBoardRef(board)
        if (elements.some((element) => element.type === 'image')) {
          throw new ToolError('image elements cannot be added over MCP')
        }
        return withBoard(agentDeps(deps), ref, 'edit', async (client) => {
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
      }),
  )
}
