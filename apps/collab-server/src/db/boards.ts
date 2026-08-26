import { and, asc, eq, gt, lte } from 'drizzle-orm'
import type { KeyHashes } from '../keys'
import type { Db } from './client'
import { boards, boardUpdates } from './schema'

export interface BoardRecord {
  id: string
  editKeyHash: Buffer
  viewKeyHash: Buffer
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
): Promise<'created' | 'exists'> {
  const rows = await db
    .insert(boards)
    .values({
      id,
      editKeyHash: Buffer.from(hashes.editKeyHash),
      viewKeyHash: Buffer.from(hashes.viewKeyHash),
    })
    .onConflictDoNothing()
    .returning({ id: boards.id })
  return rows.length > 0 ? 'created' : 'exists'
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
    })
    .from(boards)
    .where(eq(boards.id, id))
  return row
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

export async function loadBoard(
  db: Db,
  id: string,
): Promise<LoadedBoard | undefined> {
  const [board] = await db
    .select({ snapshot: boards.snapshot, snapshotSeq: boards.snapshotSeq })
    .from(boards)
    .where(eq(boards.id, id))
  if (!board) {
    return undefined
  }
  const updates = await db
    .select({ seq: boardUpdates.seq, update: boardUpdates.update })
    .from(boardUpdates)
    .where(
      and(
        eq(boardUpdates.boardId, id),
        gt(boardUpdates.seq, board.snapshotSeq),
      ),
    )
    .orderBy(asc(boardUpdates.seq))
  return { snapshot: board.snapshot, snapshotSeq: board.snapshotSeq, updates }
}

/** Replaces the snapshot and drops every update it covers, atomically. */
export async function compactBoard(
  db: Db,
  boardId: string,
  snapshot: Uint8Array,
  upToSeq: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(boards)
      .set({
        snapshot: Buffer.from(snapshot),
        snapshotSeq: upToSeq,
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId))
    await tx
      .delete(boardUpdates)
      .where(
        and(eq(boardUpdates.boardId, boardId), lte(boardUpdates.seq, upToSeq)),
      )
  })
}
