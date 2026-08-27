import { createAssetStore, persistBoard } from '@tlwb/store-yjs'
import type { BoardSession } from './board-session'
import { type StoredKeys, writeAlias, writeKeys } from './keys'
import { removeRecent, touchRecent } from './recents'
import {
  createHostedBoard as defaultCreate,
  uploadAsset as defaultUpload,
} from './server'

export interface ShareDeps {
  createHostedBoard?: typeof defaultCreate
  uploadAsset?: typeof defaultUpload
  history?: Pick<History, 'replaceState'>
  storage?: Storage
  now?: () => number
}

/**
 * Turns a local board into a hosted one. Nothing local changes before
 * the server has answered, and a failed upload removes what was written
 * under the new id, so a failure there leaves the board where it was.
 * Two things it does not undo: the board the server has already
 * created, along with whatever assets reached it, stays there
 * orphaned; and past the upload loop there is no rollback at all, so a
 * failure while clearing the old databases leaves them on the device
 * with the board already hosted under its new id.
 */
export async function shareBoard(
  session: BoardSession,
  deps: ShareDeps = {},
): Promise<StoredKeys> {
  const createHostedBoard = deps.createHostedBoard ?? defaultCreate
  const uploadAsset = deps.uploadAsset ?? defaultUpload
  const history = deps.history ?? window.history
  const storage = deps.storage ?? localStorage
  const now = deps.now ?? Date.now
  const oldId = session.getSnapshot().boardId

  const hosted = await createHostedBoard()
  const keys: StoredKeys = { editKey: hosted.editKey, viewKey: hosted.viewKey }

  const persistence = persistBoard(session.doc, hosted.boardId)
  const assets = createAssetStore(hosted.boardId)
  try {
    await persistence.whenLoaded
    const hashes = new Set(
      session.store
        .listElements()
        .flatMap((element) =>
          element.type === 'image' ? [element.assetHash] : [],
        ),
    )
    for (const hash of hashes) {
      const blob = await session.assets().get(hash)
      if (!blob) {
        continue
      }
      await uploadAsset(hosted.boardId, hash, blob, hosted.editKey)
      await assets.put(blob)
    }
  } catch (error) {
    await persistence.clear()
    await assets.delete()
    throw error
  }

  writeKeys(hosted.boardId, keys, storage)
  writeAlias(oldId, hosted.boardId, storage)
  removeRecent(oldId, storage)
  touchRecent(
    {
      id: hosted.boardId,
      name: session.store.getMeta().name,
      updatedAt: now(),
    },
    storage,
  )
  const oldPersistence = session.persistence()
  const oldAssets = session.assets()
  session.adoptHosting({ boardId: hosted.boardId, keys, persistence, assets })
  await oldPersistence?.clear()
  await oldAssets.delete()
  history.replaceState(null, '', `/b/${hosted.boardId}`)
  return keys
}
