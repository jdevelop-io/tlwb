import { and, eq } from 'drizzle-orm'
import type { Db } from './client'
import { assets } from './schema'

export async function putAsset(
  db: Db,
  input: { boardId: string; hash: string; mime: string; bytes: Uint8Array },
): Promise<'created' | 'exists'> {
  const rows = await db
    .insert(assets)
    .values({ ...input, bytes: Buffer.from(input.bytes) })
    .onConflictDoNothing()
    .returning({ hash: assets.hash })
  return rows.length > 0 ? 'created' : 'exists'
}

export async function getAsset(
  db: Db,
  boardId: string,
  hash: string,
): Promise<{ mime: string; bytes: Buffer } | undefined> {
  const [row] = await db
    .select({ mime: assets.mime, bytes: assets.bytes })
    .from(assets)
    .where(and(eq(assets.boardId, boardId), eq(assets.hash, hash)))
  return row
}
