import type { AssetStore, BoardPersistence } from '@tlwb/store-yjs'
import {
  createAssetStore,
  createBoardDoc,
  createYjsBoardStore,
  persistBoard,
} from '@tlwb/store-yjs'
import {
  readKeys,
  type StoredKeys,
  writeAlias,
  writeKeys,
} from '../board/session/keys'
import {
  listRecents,
  removeRecent,
  touchRecent,
} from '../board/session/recents'
import {
  createHostedBoard as defaultCreateHostedBoard,
  uploadAsset as defaultUploadAsset,
  requestAdoption,
} from '../board/session/server'

export interface Adoptable {
  boardId: string
  editKey: string
}

/** Hosted boards created in this browser: both keys held locally. */
export function collectAdoptables(
  storage: Storage = localStorage,
): Adoptable[] {
  return listRecents(storage).flatMap((board) => {
    const keys = readKeys(board.id, storage)
    return keys?.editKey && keys.viewKey
      ? [{ boardId: board.id, editKey: keys.editKey }]
      : []
  })
}

export interface HostLocalBoardDeps {
  createHostedBoard?: typeof defaultCreateHostedBoard
  uploadAsset?: typeof defaultUploadAsset
  storage?: Storage
  now?: () => number
}

/**
 * Hosts one local (never-hosted) recents entry, returns its Adoptable,
 * or null when the local database is empty or hosting fails. The share
 * flow without a live session: it opens the local doc straight from
 * IndexedDB rather than through a BoardSession. Wrapped entirely in
 * try/catch because this runs on every dashboard load and must never
 * break the page it runs on.
 */
export async function hostLocalBoard(
  localId: string,
  deps: HostLocalBoardDeps = {},
): Promise<Adoptable | null> {
  const createHostedBoard = deps.createHostedBoard ?? defaultCreateHostedBoard
  const uploadAsset = deps.uploadAsset ?? defaultUploadAsset
  const storage = deps.storage ?? localStorage
  const now = deps.now ?? Date.now

  // Hoisted above the try so a mid-flow failure can still close (and,
  // for the newly hosted id, clear) whatever this attempt opened.
  // Without this, adoption running again on the next dashboard load
  // finds the source recents entry untouched, retries from scratch,
  // and leaks another orphaned hosted board and database each time.
  let persistence: BoardPersistence | null = null
  let hostedPersistence: BoardPersistence | null = null
  let localAssets: AssetStore | null = null

  try {
    const doc = createBoardDoc()
    const store = createYjsBoardStore(doc)
    persistence = persistBoard(doc, localId)
    await persistence.whenLoaded

    if (store.listElements().length === 0 && store.getMeta().createdAt === 0) {
      // Nothing worth hosting: never-created or already-emptied board.
      await persistence.destroy()
      return null
    }

    const hosted = await createHostedBoard()
    hostedPersistence = persistBoard(doc, hosted.boardId)
    await hostedPersistence.whenLoaded

    localAssets = createAssetStore(localId)
    const hashes = new Set(
      store
        .listElements()
        .flatMap((element) =>
          element.type === 'image' ? [element.assetHash] : [],
        ),
    )
    for (const hash of hashes) {
      const blob = await localAssets.get(hash)
      if (blob) {
        await uploadAsset(hosted.boardId, hash, blob, hosted.editKey)
      }
    }

    const keys: StoredKeys = {
      editKey: hosted.editKey,
      viewKey: hosted.viewKey,
    }
    writeKeys(hosted.boardId, keys, storage)
    writeAlias(localId, hosted.boardId, storage)
    removeRecent(localId, storage)
    touchRecent(
      { id: hosted.boardId, name: store.getMeta().name, updatedAt: now() },
      storage,
    )

    await persistence.destroy()
    await hostedPersistence.destroy()
    await localAssets.destroy()

    return { boardId: hosted.boardId, editKey: hosted.editKey }
  } catch {
    // The source database stays intact for a retry; the local mirror
    // this attempt created under the new id is cleared rather than
    // left as an orphaned partial database (the server-side board it
    // is attached to cannot be un-created from here).
    await persistence?.destroy()
    await hostedPersistence?.clear()
    await localAssets?.destroy()
    return null
  }
}

/**
 * The whole flow, safe to run on every dashboard load: claims boards
 * this browser already hosted, then hosts and claims local-only ones
 * too. Any failure degrades to adopting nothing rather than throwing.
 */
export async function adoptBrowserBoards(
  deps: { storage?: Storage; fetchFn?: typeof fetch } = {},
): Promise<{ adopted: string[]; skipped: string[] }> {
  const storage = deps.storage ?? localStorage
  try {
    const hosted = collectAdoptables(storage)
    const locals = listRecents(storage).filter(
      (board) => readKeys(board.id, storage) === null,
    )
    for (const local of locals) {
      const adoptable = await hostLocalBoard(local.id, { storage })
      if (adoptable) {
        hosted.push(adoptable)
      }
    }
    if (hosted.length === 0) {
      return { adopted: [], skipped: [] }
    }
    return await requestAdoption(hosted.slice(0, 50), deps.fetchFn)
  } catch {
    return { adopted: [], skipped: [] }
  }
}
