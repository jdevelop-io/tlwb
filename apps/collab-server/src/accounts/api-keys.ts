import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import { apiKeys, user } from '../db/schema'
import { generateKey, hashKey } from '../keys'

export const API_KEY_PREFIX = 'tlwb_'

/** Revokes any active key for `userId`, issues a new one, returns the clear key. */
export async function issueApiKey(db: Db, userId: string): Promise<string> {
  const key = generateKey()
  const keyHash = hashKey(key)
  await db.transaction(async (tx) => {
    await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    await tx.insert(apiKeys).values({
      id: randomBytes(16).toString('base64url'),
      userId,
      keyHash,
    })
  })
  return `${API_KEY_PREFIX}${key}`
}

export async function revokeApiKey(db: Db, userId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
}

/** Null for an unprefixed, unknown or revoked key; otherwise its user and plan. */
export async function resolveApiKey(
  db: Db,
  bearer: string,
): Promise<{ userId: string; plan: 'free' | 'pro' } | null> {
  if (!bearer.startsWith(API_KEY_PREFIX)) {
    return null
  }
  const keyHash = hashKey(bearer.slice(API_KEY_PREFIX.length))
  const [row] = await db
    .select({ userId: apiKeys.userId, plan: user.plan })
    .from(apiKeys)
    .innerJoin(user, eq(apiKeys.userId, user.id))
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
  if (!row) {
    return null
  }
  return { userId: row.userId, plan: row.plan === 'pro' ? 'pro' : 'free' }
}
