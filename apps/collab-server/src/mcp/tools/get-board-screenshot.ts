import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { imageBlock, loadImages, renderPng } from '../render'
import { agentDeps, type McpDeps } from '../server'
import { guarded, ToolError } from '../tool-error'
import { boardParam } from './read-board'

export const scaleParam = z
  .number()
  .min(0.25)
  .max(3)
  .default(1)
  .describe('Pixels per world unit; 2 for a sharper image')

export function registerGetBoardScreenshot(
  server: McpServer,
  deps: McpDeps,
  _ip: string,
): void {
  server.registerTool(
    'get_board_screenshot',
    {
      description:
        'Render the whole board as a PNG, as the editor exports it, for visual verification.',
      inputSchema: { board: boardParam, scale: scaleParam },
    },
    ({ board, scale }) =>
      guarded({ tool: 'get_board_screenshot' }, async () => {
        const ref = parseBoardRef(board)
        return withBoard(agentDeps(deps), ref, 'view', async (client) => {
          const elements = client.store.listElements()
          const png = await renderPng(elements, {
            scale,
            maxPixels: deps.config.mcpMaxImagePixels,
            resolveImage: await loadImages(deps.db, ref.boardId, elements),
          })
          if (!png) {
            throw new ToolError(
              `board ${ref.boardId} is too large to render; lower scale`,
            )
          }
          return { content: [imageBlock(png)] }
        })
      }),
  )
}
