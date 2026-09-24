import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { readBoardStore } from '../src/board-read'
import { putAsset } from '../src/db/assets'
import {
  appendUpdate,
  claimBoard,
  compactBoard,
  countOwnedBoards,
  createBoard,
  deleteBoardRows,
  disownBoards,
  findBoard,
  listOwnedBoards,
  loadBoard,
  markShared,
} from '../src/db/boards'
import { connectDatabase } from '../src/db/client'
import { assets, boards, boardUpdates } from '../src/db/schema'
import { generateKey, hashKey } from '../src/keys'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function hashes() {
  return {
    editKeyHash: hashKey(generateKey()),
    viewKeyHash: hashKey(generateKey()),
  }
}

describe('boards', () => {
  it('creates once and reports the duplicate', async () => {
    const id = randomUUID()
    const keys = hashes()
    expect(await createBoard(database.db, id, keys)).toBe('created')
    expect(await createBoard(database.db, id, hashes())).toBe('exists')
    const found = await findBoard(database.db, id)
    expect(found?.editKeyHash.equals(keys.editKeyHash)).toBe(true)
    expect(found?.viewKeyHash.equals(keys.viewKeyHash)).toBe(true)
    expect(await findBoard(database.db, randomUUID())).toBeUndefined()
  })

  it('findBoard returns the owner', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    expect((await findBoard(database.db, id))?.ownerId).toBeNull()
    // `ownerId` is an opaque column with no foreign key: whoever the
    // extension's `identify` says a request is.
    const ownerId = randomUUID()
    await database.db.update(boards).set({ ownerId }).where(eq(boards.id, id))
    expect((await findBoard(database.db, id))?.ownerId).toBe(ownerId)
  })

  it('markShared sets sharedAt only on the first call', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    await markShared(database.db, id)
    const [firstRow] = await database.db
      .select({ sharedAt: boards.sharedAt })
      .from(boards)
      .where(eq(boards.id, id))
    expect(firstRow?.sharedAt).not.toBeNull()
    const firstSharedAt = firstRow?.sharedAt
    await markShared(database.db, id)
    const [secondRow] = await database.db
      .select({ sharedAt: boards.sharedAt })
      .from(boards)
      .where(eq(boards.id, id))
    expect(secondRow?.sharedAt).toEqual(firstSharedAt)
  })

  it('loads an empty board as no snapshot and no updates', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    expect(await loadBoard(database.db, id)).toEqual({
      snapshot: null,
      snapshotSeq: 0,
      updates: [],
    })
    expect(await loadBoard(database.db, randomUUID())).toBeUndefined()
  })

  it('appends updates in order and loads them back', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    const first = await appendUpdate(database.db, id, new Uint8Array([1, 2]))
    const second = await appendUpdate(database.db, id, new Uint8Array([3]))
    expect(second).toBeGreaterThan(first)
    const loaded = await loadBoard(database.db, id)
    expect(loaded?.updates.map((row) => row.seq)).toEqual([first, second])
    expect([...(loaded?.updates[0]?.update ?? [])]).toEqual([1, 2])
  })

  it('compacts into a snapshot and drops the covered updates', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    const doc = new Y.Doc()
    const seqs: number[] = []
    for (const key of ['a', 'b', 'c']) {
      const before = Y.encodeStateVector(doc)
      doc.getMap('elements').set(key, key)
      seqs.push(
        await appendUpdate(database.db, id, Y.encodeStateAsUpdate(doc, before)),
      )
    }
    await compactBoard(
      database.db,
      id,
      Y.encodeStateAsUpdate(doc),
      seqs[1] as number,
    )
    const loaded = await loadBoard(database.db, id)
    expect(loaded?.snapshotSeq).toBe(seqs[1])
    expect(loaded?.updates.map((row) => row.seq)).toEqual([seqs[2]])
    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, loaded?.snapshot as Buffer)
    for (const row of loaded?.updates ?? []) {
      Y.applyUpdate(rebuilt, row.update)
    }
    expect(rebuilt.getMap('elements').toJSON()).toEqual({
      a: 'a',
      b: 'b',
      c: 'c',
    })
    doc.destroy()
    rebuilt.destroy()
  })

  it('ignores a stale compaction instead of losing updates', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    const doc = new Y.Doc()
    const seqs: number[] = []
    for (const key of ['a', 'b', 'c']) {
      const before = Y.encodeStateVector(doc)
      doc.getMap('elements').set(key, key)
      seqs.push(
        await appendUpdate(database.db, id, Y.encodeStateAsUpdate(doc, before)),
      )
    }
    await compactBoard(
      database.db,
      id,
      Y.encodeStateAsUpdate(doc),
      seqs[1] as number,
    )
    // A compaction that started before this one finished, covering only
    // the first update, arrives after it: it must not rewind the
    // snapshot or delete the update its own stale snapshot never
    // covered.
    await compactBoard(
      database.db,
      id,
      Y.encodeStateAsUpdate(doc),
      seqs[0] as number,
    )
    const loaded = await loadBoard(database.db, id)
    expect(loaded?.snapshotSeq).toBe(seqs[1])
    expect(loaded?.updates.map((row) => row.seq)).toEqual([seqs[2]])
    doc.destroy()
  })
})

describe('claimBoard', () => {
  it('claims an unowned board once; a later claim cannot steal it', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    const ownerId = randomUUID()
    expect(await claimBoard(database.db, id, ownerId)).toBe(true)
    expect((await findBoard(database.db, id))?.ownerId).toBe(ownerId)
    expect(await claimBoard(database.db, id, randomUUID())).toBe(false)
    expect((await findBoard(database.db, id))?.ownerId).toBe(ownerId)
  })
})

describe('disownBoards', () => {
  it('clears owner_id on every board it owns, leaving other owners alone', async () => {
    const ownerId = randomUUID()
    const otherOwnerId = randomUUID()
    const mine = randomUUID()
    const theirs = randomUUID()
    await createBoard(database.db, mine, hashes(), ownerId)
    await createBoard(database.db, theirs, hashes(), otherOwnerId)
    await disownBoards(database.db, ownerId)
    expect((await findBoard(database.db, mine))?.ownerId).toBeNull()
    expect((await findBoard(database.db, theirs))?.ownerId).toBe(otherOwnerId)
  })
})

describe('countOwnedBoards and listOwnedBoards', () => {
  it('counts and lists only the boards owned by that id', async () => {
    const ownerId = randomUUID()
    const first = randomUUID()
    const second = randomUUID()
    await createBoard(database.db, first, hashes(), ownerId)
    await createBoard(database.db, second, hashes(), ownerId)
    expect(await countOwnedBoards(database.db, ownerId)).toBe(2)
    expect(await countOwnedBoards(database.db, randomUUID())).toBe(0)
    const listed = await listOwnedBoards(database.db, ownerId)
    expect(listed.map((board) => board.id).sort()).toEqual(
      [first, second].sort(),
    )
  })
})

describe('deleteBoardRows', () => {
  it('purges the board, its updates, and its assets together', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    await appendUpdate(database.db, id, new Uint8Array([1]))
    await putAsset(database.db, {
      boardId: id,
      hash: 'a'.repeat(64),
      mime: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    })
    await deleteBoardRows(database.db, id)
    expect(await findBoard(database.db, id)).toBeUndefined()
    expect(
      await database.db
        .select()
        .from(boardUpdates)
        .where(eq(boardUpdates.boardId, id)),
    ).toEqual([])
    expect(
      await database.db.select().from(assets).where(eq(assets.boardId, id)),
    ).toEqual([])
  })
})

describe('readBoardStore', () => {
  it('is undefined for a board that does not exist', async () => {
    expect(await readBoardStore(database.db, randomUUID())).toBeUndefined()
  })

  it('rebuilds a readable store at the latest persisted sequence', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    const doc = new Y.Doc()
    const seq = await appendUpdate(database.db, id, Y.encodeStateAsUpdate(doc))
    doc.destroy()
    const loaded = await readBoardStore(database.db, id)
    expect(loaded?.latestSeq).toBe(seq)
    expect(loaded?.store.listElements()).toEqual([])
  })
})
