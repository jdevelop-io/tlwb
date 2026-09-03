import { and, asc, count, desc, eq, gt, isNull, lte } from 'drizzle-orm'
import type { KeyHashes } from '../keys'
import type { Db } from './client'
import { assets, boards, boardUpdates } from './schema'

export interface BoardRecord {
  id: string
  editKeyHash: Buffer
  viewKeyHash: Buffer
  ownerId: string | null
}

export interface OwnedBoard {
  id: string
  updatedAt: Date
  sharedAt: Date | null
  agentAt: Date | null
}

export interface LoadedBoard {
  snapshot: Buffer | null
  snapshotSeq: number
  updates: { seq: number; update: Buffer }[]
}

export async function createBoard(
  db: Db,
  id: string,
  hashes: KeyHashes,
  ownerId?: string,
): Promise<'created' | 'exists'> {
  const rows = await db
    .insert(boards)
    .values({
      id,
      editKeyHash: Buffer.from(hashes.editKeyHash),
      viewKeyHash: Buffer.from(hashes.viewKeyHash),
      ownerId,
    })
    .onConflictDoNothing()
    .returning({ id: boards.id })
  return rows.length > 0 ? 'created' : 'exists'
}

/** Claims an unowned board for `ownerId`; true only if this call did it. */
export async function claimBoard(
  db: Db,
  boardId: string,
  ownerId: string,
): Promise<boolean> {
  const rows = await db
    .update(boards)
    .set({ ownerId })
    .where(and(eq(boards.id, boardId), isNull(boards.ownerId)))
    .returning({ id: boards.id })
  return rows.length > 0
}

/**
 * Re-anonymizes every board `ownerId` owns by clearing `owner_id`,
 * without touching the board rows or their keys: share links keep
 * resolving exactly as they did before.
 */
export async function disownBoards(db: Db, ownerId: string): Promise<void> {
  await db
    .update(boards)
    .set({ ownerId: null })
    .where(eq(boards.ownerId, ownerId))
}

export async function countOwnedBoards(
  db: Db,
  ownerId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(boards)
    .where(eq(boards.ownerId, ownerId))
  return row?.value ?? 0
}

export async function listOwnedBoards(
  db: Db,
  ownerId: string,
): Promise<OwnedBoard[]> {
  return db
    .select({
      id: boards.id,
      updatedAt: boards.updatedAt,
      sharedAt: boards.sharedAt,
      agentAt: boards.agentAt,
    })
    .from(boards)
    .where(eq(boards.ownerId, ownerId))
    .orderBy(desc(boards.updatedAt))
}

export async function readThumbnail(
  db: Db,
  boardId: string,
): Promise<{ thumbnail: Buffer | null; thumbnailSeq: number | null }> {
  const [row] = await db
    .select({ thumbnail: boards.thumbnail, thumbnailSeq: boards.thumbnailSeq })
    .from(boards)
    .where(eq(boards.id, boardId))
  return row ?? { thumbnail: null, thumbnailSeq: null }
}

export async function writeThumbnail(
  db: Db,
  boardId: string,
  png: Uint8Array,
  seq: number,
): Promise<void> {
  await db
    .update(boards)
    .set({ thumbnail: Buffer.from(png), thumbnailSeq: seq })
    .where(eq(boards.id, boardId))
}

/** Purges a board and everything it owns: its updates, its assets, itself. */
export async function deleteBoardRows(db: Db, boardId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(boardUpdates).where(eq(boardUpdates.boardId, boardId))
    await tx.delete(assets).where(eq(assets.boardId, boardId))
    await tx.delete(boards).where(eq(boards.id, boardId))
  })
}

export async function findBoard(
  db: Db,
  id: string,
): Promise<BoardRecord | undefined> {
  const [row] = await db
    .select({
      id: boards.id,
      editKeyHash: boards.editKeyHash,
      viewKeyHash: boards.viewKeyHash,
      ownerId: boards.ownerId,
    })
    .from(boards)
    .where(eq(boards.id, id))
  return row
}

/**
 * Records that a board has been shared, once: only the first call
 * writes `sharedAt`, so an already-shared board is untouched and the
 * timestamp keeps naming the first share, not the most recent one.
 */
export async function markShared(db: Db, boardId: string): Promise<void> {
  await db
    .update(boards)
    .set({ sharedAt: new Date() })
    .where(and(eq(boards.id, boardId), isNull(boards.sharedAt)))
}

/**
 * Records that a board has been touched by an agent over MCP, once: only
 * the first call writes `agentAt`, mirroring `markShared`.
 */
export async function markAgentSeen(db: Db, boardId: string): Promise<void> {
  await db
    .update(boards)
    .set({ agentAt: new Date() })
    .where(and(eq(boards.id, boardId), isNull(boards.agentAt)))
}

/** Durability before relay: returns the sequence number once written. */
export async function appendUpdate(
  db: Db,
  boardId: string,
  update: Uint8Array,
): Promise<number> {
  const [row] = await db
    .insert(boardUpdates)
    .values({ boardId, update: Buffer.from(update) })
    .returning({ seq: boardUpdates.seq })
  if (!row) {
    throw new Error('insert returned no row')
  }
  return row.seq
}

/**
 * Both selects run inside one REPEATABLE READ transaction so they see a
 * single consistent snapshot: without it, a compaction that commits
 * between the two plain SELECTs below could be read half-applied (the
 * new, higher `snapshotSeq` from the first select, then the updates it
 * covers already deleted by the second), silently losing them from the
 * document this call builds.
 */
export async function loadBoard(
  db: Db,
  id: string,
): Promise<LoadedBoard | undefined> {
  return db.transaction(
    async (tx) => {
      const [board] = await tx
        .select({ snapshot: boards.snapshot, snapshotSeq: boards.snapshotSeq })
        .from(boards)
        .where(eq(boards.id, id))
      if (!board) {
        return undefined
      }
      const updates = await tx
        .select({ seq: boardUpdates.seq, update: boardUpdates.update })
        .from(boardUpdates)
        .where(
          and(
            eq(boardUpdates.boardId, id),
            gt(boardUpdates.seq, board.snapshotSeq),
          ),
        )
        .orderBy(asc(boardUpdates.seq))
      return {
        snapshot: board.snapshot,
        snapshotSeq: board.snapshotSeq,
        updates,
      }
    },
    { isolationLevel: 'repeatable read' },
  )
}

/**
 * Replaces the snapshot and drops every update it covers, atomically.
 * The write only moves `snapshot_seq` forward: a caller offering an
 * older snapshot than the stored one is a no-op rather than a rollback
 * that would delete updates the new snapshot does not contain.
 */
export async function compactBoard(
  db: Db,
  boardId: string,
  snapshot: Uint8Array,
  upToSeq: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(boards)
      .set({
        snapshot: Buffer.from(snapshot),
        snapshotSeq: upToSeq,
        updatedAt: new Date(),
      })
      .where(and(eq(boards.id, boardId), lte(boards.snapshotSeq, upToSeq)))
      .returning({ id: boards.id })
    if (updated.length === 0) {
      return
    }
    await tx
      .delete(boardUpdates)
      .where(
        and(eq(boardUpdates.boardId, boardId), lte(boardUpdates.seq, upToSeq)),
      )
  })
}
