import type { McpDeps } from './server'
import { ToolError } from './tool-error'

/**
 * Who is calling an MCP tool, distinct from board access (which the
 * share link alone grants): `anonymous` and `invalid` never carry a
 * user, and `keyed` asks the extension for a unit of budget per call
 * and, when `boardIds` is non-null, restricts the boards it may reach.
 */
export type Caller =
  | { kind: 'anonymous'; ip: string }
  | { kind: 'invalid'; ip: string }
  | {
      kind: 'keyed'
      ip: string
      userId: string
      boardIds: string[] | null
    }

/**
 * The first check every tool runs. Anonymous callers pass through
 * untouched (the per-IP app limiter already ran); an invalid key is
 * refused outright; a keyed caller asks the extension to spend one
 * unit for its owner and is refused when it declines.
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
  const ok = deps.extension.mcpKeys
    ? await deps.extension.mcpKeys.spend(caller.userId)
    : true
  if (!ok) {
    throw new ToolError('API key quota exhausted')
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
