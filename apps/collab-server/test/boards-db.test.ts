import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  appendUpdate,
  compactBoard,
  createBoard,
  findBoard,
  loadBoard,
} from '../src/db/boards'
import { connectDatabase } from '../src/db/client'
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
