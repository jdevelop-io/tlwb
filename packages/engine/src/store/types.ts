import type { BoardElement, ElementId, ElementProps } from '../model/element'

export interface BoardMeta {
  name: string
  createdAt: number
}

export type BoardChange =
  | { kind: 'create'; element: BoardElement }
  | { kind: 'update'; id: ElementId; props: ElementProps }
  | { kind: 'delete'; id: ElementId }

/**
 * Where a batch of changes came from. 'local' batches are undoable by
 * this client; 'remote' batches (other collaborators, agents, imports)
 * are not; 'undo' marks batches emitted by undo/redo themselves.
 */
export type ChangeOrigin = 'local' | 'remote' | 'undo'

/**
 * Everything a store notifies its subscribers about, discriminated on
 * `kind`: a batch of element changes, or a board meta update.
 */
export type BoardStoreEvent =
  | { kind: 'changes'; changes: BoardChange[]; origin: ChangeOrigin }
  | { kind: 'meta'; meta: BoardMeta }

/**
 * Object-identity contract every implementation must uphold: repeated
 * reads of an unchanged element (via `getElement` or `listElements`)
 * return the very same object, and an update replaces that object
 * rather than mutating it in place. Callers, including the renderer,
 * rely on this to key caches off element identity instead of a value
 * comparison or a version counter.
 */
export interface BoardStore {
  getElement(id: ElementId): BoardElement | undefined
  /** All elements, sorted by fractional index (back to front). */
  listElements(): BoardElement[]
  getMeta(): BoardMeta
  /** Merges the patch into the board meta and emits a 'meta' event. */
  setMeta(patch: Partial<BoardMeta>): void
  /**
   * Applies every change in order, then emits exactly one 'changes'
   * event for the whole batch. Nothing is validated and nothing is
   * rolled back: an update or a delete naming an element the board does
   * not hold is ignored without throwing, and the other changes in the
   * batch still apply.
   */
  applyChanges(changes: BoardChange[], origin?: ChangeOrigin): void
  subscribe(listener: (event: BoardStoreEvent) => void): () => void
  /**
   * Reverts the newest local batch. No-op when nothing is undoable.
   *
   * The inverse of a batch is computed from the state at the time the
   * batch was applied. Undoing a property that a remote batch has since
   * changed therefore restores the value from before the local change
   * and discards the remote one, so "you only ever revert your own
   * actions" holds per batch, not per property. Implementations backed
   * by a CRDT may offer stronger, property-level semantics.
   */
  undo(): void
  /** Re-applies the newest undone batch. No-op when nothing is redoable. */
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  /**
   * Drops the undo and redo history. A whole-board replacement calls it
   * so the previous board's history cannot be replayed onto the new
   * content.
   */
  clearHistory(): void
}
