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
 * Awaits one teardown call without letting its failure escape or block
 * whatever else needs tearing down. IndexedDB opening (and therefore
 * closing) can genuinely reject -- private browsing, quota -- and this
 * runs on every dashboard load, so one failing close must never skip
 * the others or turn into an exception of its own.
 */
async function settle(action: Promise<unknown> | undefined): Promise<void> {
  try {
    await action
  } catch {
    // Best-effort: nothing to report here, nothing to escalate to.
  }
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
      await settle(persistence?.destroy())
      return null
    }

    const hosted = await createHostedBoard()
    hostedPersistence = persistBoard(doc, hosted.boardId)

    // Only this region -- the newly hosted mirror and its assets -- is
    // ever rolled back. The source persistence is left alone (a retry
    // should find the original board untouched), and nothing past this
    // block rolls anything back at all: once the board is adopted
    // below, a failure closing a connection must not delete a mirror
    // the keys, alias and recents already point at.
    try {
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
    } catch (error) {
      await settle(hostedPersistence?.clear())
      await settle(localAssets?.destroy())
      throw error
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

    await settle(persistence?.destroy())
    await settle(hostedPersistence?.destroy())
    await settle(localAssets?.destroy())

    return { boardId: hosted.boardId, editKey: hosted.editKey }
  } catch {
    // Whatever the inner region above already rolled back stays rolled
    // back; this only closes the source binding this attempt opened.
    await settle(persistence?.destroy())
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
