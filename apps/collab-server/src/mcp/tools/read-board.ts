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
import { guarded, jsonResult, ToolError } from '../tool-error'

export const boardParam = z
  .string()
  .describe(
    'Share URL of the board: https://<host>/b/<id>#edit=<key> or #view=<key>',
  )

export function registerReadBoard(
  server: McpServer,
  deps: McpDeps,
  caller: Caller,
): void {
  server.registerTool(
    'read_board',
    {
      description:
        'Read a board: its meta (name, createdAt) and every element in stacking order, exactly as the editor holds them.',
      inputSchema: {
        board: boardParam,
        image: z
          .boolean()
          .default(false)
          .describe('Also return a PNG of the board'),
      },
    },
    ({ board, image }) => {
      const context: { tool: string; boardId?: string } = {
        tool: 'read_board',
      }
      return guarded(context, async () => {
        await assertCaller(deps, caller)
        const ref = parseBoardRef(board)
        context.boardId = ref.boardId
        return withBoard(agentDeps(deps), ref, 'view', async (client) => {
          const elements = client.store.listElements()
          const result = jsonResult({ meta: client.store.getMeta(), elements })
          if (!image) {
            return result
          }
          // Tested before loading a single asset: a board over the
          // ceiling must not pay for decoding every image it holds
          // first.
          if (exceedsPixelBudget(elements, 1, deps.config.mcpMaxImagePixels)) {
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
            scale: 1,
            maxPixels: deps.config.mcpMaxImagePixels,
            resolveImage: await loadImages(deps.db, ref.boardId, elements),
          })
          if (!png) {
            throw new ToolError(
              `board ${ref.boardId} is too large to render; lower scale`,
            )
          }
          return { content: [...result.content, imageBlock(png)] }
        })
      })
    },
  )
}
