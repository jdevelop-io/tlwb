import { monthOf, spendQuota } from '../accounts/quota'
import type { McpDeps } from './server'
import { ToolError } from './tool-error'

/**
 * Who is calling an MCP tool, distinct from board access (which the
 * share link alone grants): `anonymous` and `invalid` never carry a
 * user, and `keyed` only meters against a monthly quota, it does not
 * authorize any board.
 */
export type Caller =
  | { kind: 'anonymous'; ip: string }
  | { kind: 'invalid'; ip: string }
  | { kind: 'keyed'; ip: string; userId: string; plan: 'free' | 'pro' }

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
