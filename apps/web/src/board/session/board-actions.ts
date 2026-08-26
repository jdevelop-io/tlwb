import { exportSnapshot, importSnapshot } from '@tlwb/engine'
import {
  createAssetStore,
  createBoardDoc,
  createYjsBoardStore,
  persistBoard,
} from '@tlwb/store-yjs'
import { nanoid } from 'nanoid'
import type { BoardSession } from './board-session'
import { clearAliasesTo, clearKeys } from './keys'
import { removeRecent } from './recents'

export function download(
  blob: Blob,
  filename: string,
  doc: Document = document,
): void {
  const url = URL.createObjectURL(blob)
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** A new local board holding a copy of this one; returns its id. */
export async function duplicateBoard(
  session: BoardSession,
  newId: string = nanoid(),
  now: () => number = Date.now,
): Promise<string> {
  const doc = createBoardDoc()
  const store = createYjsBoardStore(doc)
  const persistence = persistBoard(doc, newId)
  const assets = createAssetStore(newId)
  await persistence.whenLoaded
  const snapshot = exportSnapshot(session.store)
  importSnapshot(store, {
    ...snapshot,
    meta: { name: `${snapshot.meta.name} copy`, createdAt: now() },
  })
  for (const element of snapshot.elements) {
    if (element.type === 'image') {
      const blob = await session.assets().get(element.assetHash)
      if (blob) {
        await assets.put(blob)
      }
    }
  }
  await persistence.destroy()
  await assets.destroy()
  return newId
}

/** Forgets the board on this device; a hosted board lives on elsewhere. */
export async function removeBoard(
  session: BoardSession,
  storage: Storage = localStorage,
): Promise<void> {
  const { boardId } = session.getSnapshot()
  const persistence = session.persistence()
  const assets = session.assets()
  await session.destroy()
  await persistence?.clear()
  await assets.delete()
  clearKeys(boardId, storage)
  clearAliasesTo(boardId, storage)
  removeRecent(boardId, storage)
}
