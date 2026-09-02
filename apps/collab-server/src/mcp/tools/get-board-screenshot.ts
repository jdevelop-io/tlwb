import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { assertCaller, type Caller } from '../caller'
import {
  exceedsPixelBudget,
  imageBlock,
  loadImages,
  renderPng,
} from '../render'
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
  caller: Caller,
): void {
  server.registerTool(
    'get_board_screenshot',
    {
      description:
        'Render the whole board as a PNG, as the editor exports it, for visual verification.',
      inputSchema: { board: boardParam, scale: scaleParam },
    },
    ({ board, scale }) => {
      const context: { tool: string; boardId?: string } = {
        tool: 'get_board_screenshot',
      }
      return guarded(context, async () => {
        await assertCaller(deps, caller)
        const ref = parseBoardRef(board)
        context.boardId = ref.boardId
        return withBoard(agentDeps(deps), ref, 'view', async (client) => {
          const elements = client.store.listElements()
          // Tested before loading a single asset: a board over the
          // ceiling must not pay for decoding every image it holds
          // first.
          if (
            exceedsPixelBudget(elements, scale, deps.config.mcpMaxImagePixels)
          ) {
            throw new ToolError(
              `board ${ref.boardId} is too large to render; lower scale`,
            )
          }
          // Spent only once a render is certain to run, so a board
          // refused for size costs the caller nothing.
          if (!deps.renderLimiter.take(caller.ip)) {
            throw new ToolError(
              'too many renders from this address, retry later',
            )
          }
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
      })
    },
  )
}
