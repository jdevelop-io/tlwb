import type { BoardElement, ElementId, ElementProps } from '../model/element'
import { sortByIndex } from '../model/ordering'
import type {
  BoardChange,
  BoardMeta,
  BoardStore,
  BoardStoreEvent,
  ChangeOrigin,
} from './types'

export class InMemoryBoardStore implements BoardStore {
  private elements = new Map<ElementId, BoardElement>()
  private meta: BoardMeta = { name: 'Untitled', createdAt: Date.now() }
  private listeners = new Set<(event: BoardStoreEvent) => void>()
  private undoStack: BoardChange[][] = []
  private redoStack: BoardChange[][] = []

  getElement(id: ElementId): BoardElement | undefined {
    const element = this.elements.get(id)
    return element ? { ...element } : undefined
  }

  listElements(): BoardElement[] {
    return sortByIndex([...this.elements.values()].map((element) => ({ ...element })))
  }

  getMeta(): BoardMeta {
    return { ...this.meta }
  }

  setMeta(patch: Partial<BoardMeta>): void {
    this.meta = { ...this.meta, ...patch }
  }

  applyChanges(changes: BoardChange[], origin: ChangeOrigin = 'local'): void {
    const inverse = this.invertBatch(changes)
    for (const change of changes) {
      this.applyOne(change)
    }
    if (origin === 'local') {
      this.undoStack.push(inverse)
      this.redoStack = []
    }
    this.emit({ changes, origin })
  }

  subscribe(listener: (event: BoardStoreEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  undo(): void {
    const batch = this.undoStack.pop()
    if (!batch) return
    const redo = this.invertBatch(batch)
    for (const change of batch) {
      this.applyOne(change)
    }
    this.redoStack.push(redo)
    this.emit({ changes: batch, origin: 'undo' })
  }

  redo(): void {
    const batch = this.redoStack.pop()
    if (!batch) return
    const undo = this.invertBatch(batch)
    for (const change of batch) {
      this.applyOne(change)
    }
    this.undoStack.push(undo)
    this.emit({ changes: batch, origin: 'undo' })
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  protected applyOne(change: BoardChange): void {
    switch (change.kind) {
      case 'create':
        this.elements.set(change.element.id, change.element)
        break
      case 'update': {
        const element = this.elements.get(change.id)
        if (element) {
          this.elements.set(change.id, {
            ...element,
            ...change.props,
          } as BoardElement)
        }
        break
      }
      case 'delete':
        this.elements.delete(change.id)
        break
    }
  }

  protected emit(event: BoardStoreEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  /**
   * Builds the inverse batch BEFORE the batch is applied, reading the
   * current state for prior values. Reversed so inverses replay in the
   * correct order.
   */
  private invertBatch(changes: BoardChange[]): BoardChange[] {
    const inverses: BoardChange[] = []
    for (const change of changes) {
      const inverse = this.invertOne(change)
      if (inverse) inverses.push(inverse)
    }
    return inverses.reverse()
  }

  private invertOne(change: BoardChange): BoardChange | null {
    switch (change.kind) {
      case 'create':
        return { kind: 'delete', id: change.element.id }
      case 'delete': {
        const element = this.elements.get(change.id)
        return element ? { kind: 'create', element } : null
      }
      case 'update': {
        const element = this.elements.get(change.id)
        if (!element) return null
        const prior: Record<string, unknown> = {}
        for (const key of Object.keys(change.props)) {
          prior[key] = (element as unknown as Record<string, unknown>)[key]
        }
        return { kind: 'update', id: change.id, props: prior as ElementProps }
      }
    }
  }
}
