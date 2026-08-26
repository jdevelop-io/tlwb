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
 */
export function persistBoard(doc: Y.Doc, boardId: string): BoardPersistence {
  const persistence = new IndexeddbPersistence(`tlwb:board:${boardId}`, doc)
  return {
    whenLoaded: persistence.whenSynced.then(() => undefined),
    destroy: () => persistence.destroy(),
  }
}
