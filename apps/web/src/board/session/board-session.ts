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
  PERMANENT_CLOSE_CODES,
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
  /**
   * Try a keyless connection when there is no local key and no local
   * copy: a deployment that identifies visitors grants a board's owner
   * edit access with no key at all. Ignored whenever a key or a local
   * copy already answers the question. Off by default.
   */
  keylessOwner?: boolean
  connect?: typeof connectBoard
  storage?: Storage
  now?: () => number
  /** Overrides `OWNER_CONNECT_TIMEOUT_MS`; a test-only seam. */
  ownerConnectTimeoutMs?: number
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
  /**
   * The close code is delivered once: the consumer that acted on it
   * clears it here so the next arrival (even the same code) is a fresh
   * transition the caller can observe again.
   */
  acknowledgeClose(): void
  destroy(): Promise<void>
}

const RECENTS_DEBOUNCE_MS = 1_000

/**
 * How long the keyless owner-connect dial waits for a first outcome
 * before giving up. Without a ceiling, an unreachable server or a
 * close code the provider keeps retrying (never permanent, never
 * `connected`) leaves the promise below unsettled forever: the page
 * stays blank, since `openBoardSession` never returns.
 */
const OWNER_CONNECT_TIMEOUT_MS = 5_000

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

  // Set once, only for the cold-start case below: no key and no local
  // copy either, so the only thing left to ask is the server, and only
  // a visitor the deployment identifies stands any chance of an
  // owner's session granting them in. A share-link visitor still
  // carries a key by this point, so this never applies to them.
  let ownerConnect = false

  if (options.fresh) {
    store.setMeta({ name: 'Untitled', createdAt: now() })
  } else if (!keys && store.getMeta().createdAt === 0) {
    if (!options.keylessOwner) {
      // Nothing stored here and no key to fetch it with.
      await persistence?.clear()
      return 'not-found'
    }
    ownerConnect = true
  }

  let assets = createAssetStore(boardId)
  let identity = options.identity
  const connectFn = options.connect ?? connectBoard
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
      role: ownerConnect ? 'edit' : roleOf(keys),
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
   * token, one carrying no token at all for a visitor whose session
   * alone might grant them in (`ownerConnect`), or none for a local
   * role. Every key transition (`adoptHosting`, `becomeViewer`,
   * `forgetKeys`) goes through this, so a stale socket never outlives
   * the token it was opened with. A no-op once the session is
   * destroyed, so a late transition cannot open a new socket on a
   * torn-down session. Returns the connection it just opened (or null
   * for local mode), so the very first call can await its outcome from
   * a plain local rather than narrowing the outer `connection` variable,
   * which this function itself mutates.
   */
  function restartConnection(): BoardConnection | null {
    if (destroyed) {
      return null
    }
    teardownConnection()
    presence?.destroy()
    localAwareness?.destroy()
    localAwareness = null
    closeCode = null
    const token = keys ? tokenOf(keys) : null
    if (!token && !ownerConnect) {
      localAwareness = createLocalAwareness(doc)
      attachPresence(localAwareness)
      status = 'local'
      return null
    }
    const opened = connectFn(doc, {
      url: socketUrl(),
      boardId,
      token: token ?? undefined,
    })
    connection = opened
    status = opened.getStatus()
    const stopStatus = opened.subscribeStatus((next) => {
      status = next
      notify()
    })
    const stopClose = opened.subscribeClose((code) => {
      closeCode = code
      notify()
    })
    unsubscribeConnection = () => {
      stopStatus()
      stopClose()
    }
    attachPresence(opened.awareness)
    return opened
  }

  /** Tears down everything opened above and settles on 'not-found'. */
  async function abandonAsNotFound(): Promise<'not-found'> {
    ownerConnect = false
    teardownConnection()
    presence?.destroy()
    localAwareness?.destroy()
    await persistence?.destroy()
    await assets.destroy()
    return 'not-found'
  }

  const dialed = restartConnection()
  refreshUpload()

  if (ownerConnect && dialed) {
    // Wait for the very first outcome of the keyless dial above before
    // handing back a session: the server either grants edit (the
    // visitor really does own this board) or permanently refuses the
    // socket (they do not), and only the second case falls back to the
    // same 'not-found' an anonymous visitor with no key gets. A
    // transient close (a network blip, a server restart) is not a
    // refusal: the provider already retries those on its own (see
    // `shouldReconnect` in `connectBoard`), so this keeps waiting for
    // either a later 'connected' or a later permanent close instead of
    // giving up on the first hiccup.
    const conn = dialed
    let stopStatus: () => void = () => undefined
    let stopClose: () => void = () => undefined
    const granted = await new Promise<boolean>((resolve) => {
      const settle = (result: boolean): void => {
        clearTimeout(timer)
        stopStatus()
        stopClose()
        resolve(result)
      }
      // A few seconds is generous for a real connection outcome and
      // short enough that a visitor never stares at a blank page: past
      // it, this falls back to the same not-found an anonymous visitor
      // with no key gets, exactly like a permanent close would.
      const timer = setTimeout(
        () => settle(false),
        options.ownerConnectTimeoutMs ?? OWNER_CONNECT_TIMEOUT_MS,
      )
      stopStatus = conn.subscribeStatus((next: ConnectionStatus) => {
        if (next === 'connected') {
          settle(true)
        }
      })
      stopClose = conn.subscribeClose((code) => {
        if (code === null || !PERMANENT_CLOSE_CODES.has(code)) {
          return
        }
        settle(false)
      })
    })
    if (!granted) {
      return await abandonAsNotFound()
    }
  }

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
      // The server just told this connection (key-based or the owner's
      // session alone) that it is no longer good: give up on both
      // rather than immediately redialling with the session and
      // risking a reconnect loop against a board that keeps refusing.
      ownerConnect = false
      clearKeys(boardId, storage)
      refreshUpload()
      restartConnection()
      notify()
    },
    acknowledgeClose() {
      closeCode = null
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
