import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import { apiKeys, user } from '../db/schema'
import { generateKey, hashKey } from '../keys'

export const API_KEY_PREFIX = 'tlwb_'

export interface ApiKeySummary {
  id: string
  name: string
  boardIds: string[] | null
  createdAt: string
  lastUsedAt: string | null
}

export async function issueApiKey(
  db: Db,
  userId: string,
  options: { name: string; boardIds: string[] | null },
): Promise<{ id: string; key: string }> {
  const key = generateKey()
  const id = randomBytes(16).toString('base64url')
  await db.insert(apiKeys).values({
    id,
    userId,
    keyHash: hashKey(key),
    name: options.name,
    boardIds: options.boardIds,
  })
  return { id, key: `${API_KEY_PREFIX}${key}` }
}

export async function listApiKeys(
  db: Db,
  userId: string,
): Promise<ApiKeySummary[]> {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      boardIds: apiKeys.boardIds,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    boardIds: row.boardIds,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }))
}

export async function revokeApiKey(
  db: Db,
  userId: string,
  id: string,
): Promise<boolean> {
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id })
  return revoked.length === 1
}

export async function revokeAllApiKeys(db: Db, userId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
}

/** Null for an unprefixed, unknown or revoked key; otherwise its user,
 * plan and scope. Stamps `lastUsedAt`, fire and forget: this must never
 * block or fail the call that is resolving the key. */
export async function resolveApiKey(
  db: Db,
  bearer: string,
): Promise<{
  userId: string
  plan: 'free' | 'pro'
  keyId: string
  boardIds: string[] | null
} | null> {
  if (!bearer.startsWith(API_KEY_PREFIX)) {
    return null
  }
  const keyHash = hashKey(bearer.slice(API_KEY_PREFIX.length))
  const [row] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      plan: user.plan,
      boardIds: apiKeys.boardIds,
    })
    .from(apiKeys)
    .innerJoin(user, eq(apiKeys.userId, user.id))
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
  if (!row) {
    return null
  }
  // Fire and forget: the caller must never wait on, or fail because of,
  // this stamp.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {})
  return {
    userId: row.userId,
    plan: row.plan === 'pro' ? 'pro' : 'free',
    keyId: row.id,
    boardIds: row.boardIds,
  }
}
