import { type DBSchema, openDB } from 'idb'

export interface AssetStore {
  /** Stores the blob and returns its SHA-256 content hash (hex). */
  put(blob: Blob): Promise<string>
  get(hash: string): Promise<Blob | undefined>
  destroy(): Promise<void>
}

interface AssetSchema extends DBSchema {
  blobs: {
    key: string
    // Bytes and type rather than the Blob itself: an ArrayBuffer clones
    // identically in every IndexedDB implementation, a Blob does not.
    value: { type: string; bytes: ArrayBuffer }
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * Image blobs for one board, keyed by content hash, in IndexedDB. The
 * engine's image elements reference the hash; the client resolves it
 * through `get`. No garbage collection of orphaned blobs.
 */
export function createAssetStore(boardId: string): AssetStore {
  const db = openDB<AssetSchema>(`tlwb:assets:${boardId}`, 1, {
    upgrade(database) {
      database.createObjectStore('blobs')
    },
  })
  // Nothing awaits the open until the first call, which can be much
  // later; keep a failure from surfacing as an unhandled rejection with
  // no link to its cause. The callers below still see it.
  db.catch(() => undefined)
  return {
    async put(blob) {
      const bytes = await blob.arrayBuffer()
      const hash = await sha256Hex(bytes)
      await (await db).put('blobs', { type: blob.type, bytes }, hash)
      return hash
    },
    async get(hash) {
      const record = await (await db).get('blobs', hash)
      return record
        ? new Blob([record.bytes], { type: record.type })
        : undefined
    },
    async destroy() {
      ;(await db).close()
    },
  }
}
