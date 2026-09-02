import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { issueBoard } from '../../issue-board'
import { withBoard } from '../agent-client'
import { assertCaller, type Caller } from '../caller'
import { agentDeps, type McpDeps, shareUrls } from '../server'
import { guarded, jsonResult, ToolError } from '../tool-error'

export function registerCreateBoard(
  server: McpServer,
  deps: McpDeps,
  caller: Caller,
): void {
  const now = deps.now ?? Date.now
  server.registerTool(
    'create_board',
    {
      description:
        'Create a new hosted whiteboard. Returns its edit URL (share it to let others draw) and its view URL (read-only). Pass one of them as `board` to the other tools.',
      inputSchema: {
        name: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .describe('Board title'),
      },
    },
    ({ name }) => {
      // No board id exists until `issueBoard` succeeds: left unset
      // rather than logged as a placeholder that looks like one.
      const context: { tool: string; boardId?: string } = {
        tool: 'create_board',
      }
      return guarded(context, async () => {
        await assertCaller(deps, caller)
        // A keyed caller is bounded by their monthly quota instead: the
        // per-address creation limiter only guards anonymous callers.
        if (
          caller.kind === 'anonymous' &&
          !deps.createLimiter.take(caller.ip)
        ) {
          throw new ToolError(
            'too many boards created from this address, retry later',
          )
        }
        const issued = await issueBoard(deps.db)
        if (!issued) {
          throw new Error('board id collision')
        }
        context.boardId = issued.boardId
        await withBoard(
          agentDeps(deps),
          { boardId: issued.boardId, key: issued.editKey },
          'edit',
          (client) =>
            client.mutate((store) =>
              store.setMeta({ name: name ?? 'Untitled', createdAt: now() }),
            ),
        )
        return jsonResult({
          boardId: issued.boardId,
          ...shareUrls(
            deps.config,
            issued.boardId,
            issued.editKey,
            issued.viewKey,
          ),
        })
      })
    },
  )
}
