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

export interface BoardStoreEvent {
  changes: BoardChange[]
  origin: ChangeOrigin
}

export interface BoardStore {
  getElement(id: ElementId): BoardElement | undefined
  /** All elements, sorted by fractional index (back to front). */
  listElements(): BoardElement[]
  getMeta(): BoardMeta
  setMeta(patch: Partial<BoardMeta>): void
  /** Applies the batch atomically and emits exactly one event. */
  applyChanges(changes: BoardChange[], origin?: ChangeOrigin): void
  subscribe(listener: (event: BoardStoreEvent) => void): () => void
}
