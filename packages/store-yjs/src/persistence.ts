import { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'

export interface BoardPersistence {
  /** Resolves once the stored updates have been applied to the doc. */
  whenLoaded: Promise<void>
  /** Stops mirroring the doc and closes the database. */
  destroy(): Promise<void>
}

/**
 * Mirrors the doc into IndexedDB under a per-board database. The load
 * applies stored updates as a foreign transaction, so the store reports
 * it as 'remote' and it never enters the undo stack.
 *
 * When IndexedDB is unavailable (private browsing, quota), `whenLoaded`
 * rejects instead of hanging: the in-memory document keeps working and
 * the client decides what to show.
 */
export function persistBoard(doc: Y.Doc, boardId: string): BoardPersistence {
  const persistence = new IndexeddbPersistence(`tlwb:board:${boardId}`, doc)
  // `whenSynced` only settles on the 'synced' event, so a database that
  // never opens would leave the caller waiting forever. `_db` is the
  // library's own open promise, an implementation detail we rely on to
  // surface that failure. A successful open resolves to a promise that
  // never settles, so the race keeps waiting on the load.
  const whenOpenFails = persistence._db.then<never>(
    () => new Promise<never>(() => undefined),
  )
  return {
    whenLoaded: Promise.race([
      persistence.whenSynced.then(() => undefined),
      whenOpenFails,
    ]),
    destroy: () => persistence.destroy(),
  }
}
