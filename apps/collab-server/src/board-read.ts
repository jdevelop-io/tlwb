import { createYjsBoardStore } from '@tlwb/store-yjs'
import * as Y from 'yjs'
import { loadBoard } from './db/boards'
import type { Db } from './db/client'

/** The persisted board as a readable store, outside any live room. */
export async function readBoardStore(db: Db, boardId: string) {
  const loaded = await loadBoard(db, boardId)
  if (!loaded) {
    return undefined
  }
  const doc = new Y.Doc()
  if (loaded.snapshot) {
    Y.applyUpdate(doc, loaded.snapshot)
  }
  for (const row of loaded.updates) {
    Y.applyUpdate(doc, row.update)
  }
  return {
    store: createYjsBoardStore(doc),
    latestSeq: loaded.updates.at(-1)?.seq ?? loaded.snapshotSeq,
  }
}
