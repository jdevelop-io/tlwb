import { monthOf, spendQuota } from '../accounts/quota'
import type { McpDeps } from './server'
import { ToolError } from './tool-error'

/**
 * Who is calling an MCP tool, distinct from board access (which the
 * share link alone grants): `anonymous` and `invalid` never carry a
 * user, and `keyed` meters against a monthly quota and, when
 * `boardIds` is non-null, restricts the boards it may reach.
 */
export type Caller =
  | { kind: 'anonymous'; ip: string }
  | { kind: 'invalid'; ip: string }
  | {
      kind: 'keyed'
      ip: string
      userId: string
      plan: 'free' | 'pro'
      boardIds: string[] | null
    }

/**
 * The first check every tool runs. Anonymous callers pass through
 * untouched (the per-IP app limiter already ran); an invalid key is
 * refused outright; a keyed caller spends one unit of their monthly
 * quota and is refused once it is exhausted.
 */
export async function assertCaller(
  deps: McpDeps,
  caller: Caller,
): Promise<void> {
  if (caller.kind === 'anonymous') {
    return
  }
  if (caller.kind === 'invalid') {
    throw new ToolError('invalid API key')
  }
  const now = deps.now ?? Date.now
  const limit =
    caller.plan === 'pro' ? deps.config.mcpQuotaPro : deps.config.mcpQuotaFree
  const ok = await spendQuota(deps.db, caller.userId, monthOf(now()), limit)
  if (!ok) {
    throw new ToolError('monthly quota reached, resets on the 1st')
  }
}

/**
 * The board-scope check every tool runs once it knows which board it
 * targets. A session caller (`anonymous`/`invalid`) is authorized by
 * its own session, not by a token, so it is never checked here. A
 * keyed caller with `boardIds: null` reaches every board its share
 * key resolves (the same access an anonymous caller gets from the
 * link, see the header comment above); a non-null scope narrows that
 * down to the exact allow-list.
 */
export function assertBoardAllowed(caller: Caller, boardId: string): void {
  if (
    caller.kind === 'keyed' &&
    caller.boardIds &&
    !caller.boardIds.includes(boardId)
  ) {
    throw new ToolError(`this token is not allowed on board ${boardId}`)
  }
}
