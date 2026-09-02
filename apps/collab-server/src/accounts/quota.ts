import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { mcpUsage } from '../db/schema'

/** 'YYYY-MM' in UTC, the natural key `mcp_usage` counts against. */
export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

/**
 * Spends one unit of `userId`'s quota for `month`, up to `limit`. False
 * once exhausted; the counter itself stops climbing past `limit`.
 *
 * A `limit < 1` is refused outright: an unconditional first insert would
 * otherwise spend one unit before any row exists to check a limit
 * against.
 */
export async function spendQuota(
  db: Db,
  userId: string,
  month: string,
  limit: number,
): Promise<boolean> {
  if (limit < 1) {
    return false
  }
  const rows = await db
    .insert(mcpUsage)
    .values({ userId, month, count: 1 })
    .onConflictDoUpdate({
      target: [mcpUsage.userId, mcpUsage.month],
      set: { count: sql`${mcpUsage.count} + 1` },
      setWhere: sql`${mcpUsage.count} < ${limit}`,
    })
    .returning({ count: mcpUsage.count })
  return rows.length > 0
}

export async function readUsage(
  db: Db,
  userId: string,
  month: string,
): Promise<number> {
  const [row] = await db
    .select({ count: mcpUsage.count })
    .from(mcpUsage)
    .where(and(eq(mcpUsage.userId, userId), eq(mcpUsage.month, month)))
  return row?.count ?? 0
}
