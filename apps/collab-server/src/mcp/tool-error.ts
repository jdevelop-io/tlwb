import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { log } from '../log'

/** A failure the agent can act on: its message is the whole answer. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

/**
 * Runs a tool body: a ToolError becomes the tool's error text, anything
 * else becomes `internal error` with one log line, and every call logs
 * its outcome and duration. Never the key: `boardId` only.
 */
export async function guarded(
  context: { tool: string; boardId?: string },
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const started = Date.now()
  try {
    const result = await run()
    log({ event: 'mcp tool', ...context, ok: true, ms: Date.now() - started })
    return result
  } catch (error) {
    const ms = Date.now() - started
    if (error instanceof ToolError) {
      log({
        event: 'mcp tool',
        ...context,
        ok: false,
        ms,
        reason: error.message,
      })
      return errorResult(error.message)
    }
    log({ event: 'mcp tool failed', ...context, ms, error: String(error) })
    return errorResult('internal error')
  }
}
