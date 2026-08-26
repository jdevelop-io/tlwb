import type { BoardStore } from '@tlwb/engine'
import type {
  AssetStore,
  BoardConnection,
  BoardPersistence,
  ConnectionStatus,
  Presence,
} from '@tlwb/store-yjs'
import {
  connectBoard,
  createAssetStore,
  createBoardDoc,
  createLocalAwareness,
  createPresence,
  createYjsBoardStore,
  persistBoard,
} from '@tlwb/store-yjs'
import type { Identity } from './identity'
import { createImageCache, type ImageCache } from './image-cache'
import {
  type BoardRole,
  clearKeys,
  readKeys,
  roleOf,
  type StoredKeys,
  tokenOf,
  writeKeys,
} from './keys'
import { touchRecent } from './recents'
import { fetchAsset, socketUrl, uploadAsset } from './server'

export type BoardDoc = ReturnType<typeof createBoardDoc>
export type StorageMode = 'persistent' | 'memory'

export interface SessionSnapshot {
  boardId: string
  role: BoardRole
  storage: StorageMode
  status: ConnectionStatus | 'local'
  closeCode: number | null
}

export interface HostingHandoff {
  boardId: string
  keys: StoredKeys
  persistence: BoardPersistence
  assets: AssetStore
}

export interface BoardSessionOptions {
  boardId: string
  /** Just created from `/b/new`: write the meta instead of probing. */
  fresh: boolean
  identity: Identity
  connect?: typeof connectBoard
  storage?: Storage
  now?: () => number
}

export interface BoardSession {
  readonly doc: BoardDoc
  readonly store: BoardStore
  readonly images: ImageCache
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  keys(): StoredKeys | null
  assets(): AssetStore
  persistence(): BoardPersistence | null
  presence(): Presence
  connection(): BoardConnection | null
  setIdentity(identity: Identity): void
  /**
   * The migration hands over the hosted databases and keys. The
   * caller keeps ownership of what this replaces: it must clear the
   * outgoing persistence and delete the outgoing asset store once the
   * handoff completes. This method never disposes of them itself.
   */
  adoptHosting(handoff: HostingHandoff): void
  /** The server refused a write (4403): keep the key as a view key. */
  becomeViewer(): void
  /** The server no longer knows this link (4401, 4404). */
  forgetKeys(): void
  destroy(): Promise<void>
}

const RECENTS_DEBOUNCE_MS = 1_000

export async function openBoardSession(
  options: BoardSessionOptions,
): Promise<BoardSession | 'not-found'> {
  const storage = options.storage ?? localStorage
  const now = options.now ?? Date.now
  const doc = createBoardDoc()
  const store = createYjsBoardStore(doc)
  let boardId = options.boardId
  let keys = readKeys(boardId, storage)
  let persistence: BoardPersistence | null = persistBoard(doc, boardId)
  let storageMode: StorageMode = 'persistent'
  try {
    await persistence.whenLoaded
  } catch {
    persistence = null
    storageMode = 'memory'
  }

  if (options.fresh) {
    store.setMeta({ name: 'Untitled', createdAt: now() })
  } else if (!keys && store.getMeta().createdAt === 0) {
    // Nothing stored here and no key to fetch it with.
    await persistence?.clear()
    return 'not-found'
  }

  let assets = createAssetStore(boardId)
  let identity = options.identity
  let connectFn = options.connect ?? connectBoard
  let connection: BoardConnection | null = null
  let presence!: Presence
  let localAwareness: ReturnType<typeof createLocalAwareness> | null = null
  let status: ConnectionStatus | 'local' = 'local'
  let closeCode: number | null = null
  let unsubscribeConnection: () => void = () => undefined
  let destroyed = false
  const listeners = new Set<() => void>()
  let snapshot: SessionSnapshot

  const notify = (): void => {
    snapshot = {
      boardId,
      role: roleOf(keys),
      storage: storageMode,
      status,
      closeCode,
    }
    for (const listener of listeners) {
      listener()
    }
  }

  const images = createImageCache({
    assets,
    fetchRemote: (hash) => remoteFetcher(hash),
    upload: null,
    onLoaded: () => notify(),
  })

  function remoteFetcher(hash: string): Promise<Blob | null> {
    const token = keys ? tokenOf(keys) : null
    return token ? fetchAsset(boardId, hash, token) : Promise.resolve(null)
  }

  function refreshUpload(): void {
    const editKey = keys?.editKey
    images.setUpload(
      editKey
        ? (hash, blob) => uploadAsset(boardId, hash, blob, editKey)
        : null,
    )
  }

  function attachPresence(awareness: Parameters<typeof createPresence>[0]) {
    presence = createPresence(awareness, { ...identity, isAgent: false })
  }

  /** Stops the current connection, if any, keeping nothing subscribed. */
  function teardownConnection(): void {
    unsubscribeConnection()
    unsubscribeConnection = () => undefined
    connection?.destroy()
    connection?.awareness.destroy()
    connection = null
  }

  /**
   * Tears the current connection down and starts a fresh one for
   * whatever role the session is now in: a socket carrying the current
   * token, or none at all for a local role. Every key transition
   * (`adoptHosting`, `becomeViewer`, `forgetKeys`) goes through this, so
   * a stale socket never outlives the token it was opened with. A no-op
   * once the session is destroyed, so a late transition cannot open a
   * new socket on a torn-down session.
   */
  function restartConnection(): void {
    if (destroyed) {
      return
    }
    teardownConnection()
    presence?.destroy()
    localAwareness?.destroy()
    localAwareness = null
    closeCode = null
    const token = keys ? tokenOf(keys) : null
    if (!token) {
      localAwareness = createLocalAwareness(doc)
      attachPresence(localAwareness)
      status = 'local'
      return
    }
    connection = connectFn(doc, { url: socketUrl(), boardId, token })
    status = connection.getStatus()
    const stopStatus = connection.subscribeStatus((next) => {
      status = next
      notify()
    })
    const stopClose = connection.subscribeClose((code) => {
      closeCode = code
      notify()
    })
    unsubscribeConnection = () => {
      stopStatus()
      stopClose()
    }
    attachPresence(connection.awareness)
  }

  restartConnection()
  refreshUpload()

  let recentsTimer: ReturnType<typeof setTimeout> | null = null
  const touch = (): void => {
    touchRecent(
      { id: boardId, name: store.getMeta().name, updatedAt: now() },
      storage,
    )
  }
  touch()
  const unsubscribeStore = store.subscribe(() => {
    if (recentsTimer) {
      clearTimeout(recentsTimer)
    }
    recentsTimer = setTimeout(touch, RECENTS_DEBOUNCE_MS)
  })

  notify()

  const session = {
    doc,
    store,
    images,
    // Test seam: swapped by the adoption test.
    connectFn,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    keys: () => keys,
    assets: () => assets,
    persistence: () => persistence,
    presence: () => presence,
    connection: () => connection,
    setIdentity(next: Identity) {
      identity = next
      presence.destroy()
      const awareness = connection?.awareness ?? localAwareness
      if (awareness) {
        attachPresence(awareness)
      }
      notify()
    },
    adoptHosting(handoff: HostingHandoff) {
      connectFn = session.connectFn
      boardId = handoff.boardId
      keys = handoff.keys
      persistence = handoff.persistence
      assets = handoff.assets
      images.setAssets(assets)
      images.setFetchRemote((hash) => remoteFetcher(hash))
      refreshUpload()
      restartConnection()
      touch()
      notify()
    },
    becomeViewer() {
      if (keys?.editKey) {
        keys = { viewKey: keys.editKey }
        writeKeys(boardId, keys, storage)
        refreshUpload()
        restartConnection()
        notify()
      }
    },
    forgetKeys() {
      keys = null
      clearKeys(boardId, storage)
      refreshUpload()
      restartConnection()
      notify()
    },
    async destroy() {
      if (recentsTimer) {
        clearTimeout(recentsTimer)
      }
      destroyed = true
      unsubscribeStore()
      teardownConnection()
      presence.destroy()
      localAwareness?.destroy()
      images.destroy()
      await persistence?.destroy()
      await assets.destroy()
    },
  }
  return session
}
