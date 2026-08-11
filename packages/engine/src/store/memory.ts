import type { BoardElement, ElementId, ElementProps } from '../model/element'
import { sortByIndex } from '../model/ordering'
import type {
  BoardChange,
  BoardMeta,
  BoardStore,
  BoardStoreEvent,
  ChangeOrigin,
} from './types'

/**
 * Freezes a value and everything reachable from it. Elements carry
 * nested structures (`points` and its `Point` objects, arrow bindings)
 * that a shallow copy would still share, so the store freezes on write
 * instead of copying on read: callers cannot mutate stored state, and
 * the read path stays allocation-free per element for the render loop.
 * Already-frozen values are left alone, which also stops the walk from
 * revisiting a structure the store has frozen before.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const nested of Object.values(value)) {
    deepFreeze(nested)
  }
  return value
}

export class InMemoryBoardStore implements BoardStore {
  private elements = new Map<ElementId, BoardElement>()
  private meta: BoardMeta = { name: 'Untitled', createdAt: Date.now() }
  private listeners = new Set<(event: BoardStoreEvent) => void>()
  private undoStack: BoardChange[][] = []
  private redoStack: BoardChange[][] = []
  private capturing = false

  getElement(id: ElementId): BoardElement | undefined {
    return this.elements.get(id)
  }

  listElements(): BoardElement[] {
    return sortByIndex([...this.elements.values()])
  }

  getMeta(): BoardMeta {
    return { ...this.meta }
  }

  setMeta(patch: Partial<BoardMeta>): void {
    this.meta = { ...this.meta, ...patch }
    this.emit({ kind: 'meta', meta: this.getMeta() })
  }

  applyChanges(changes: BoardChange[], origin: ChangeOrigin = 'local'): void {
    const inverse = this.invertBatch(changes)
    for (const change of changes) {
      this.applyOne(change)
    }
    if (origin === 'local' && inverse.length > 0) {
      const open = this.capturing ? this.undoStack.at(-1) : undefined
      if (open) {
        // The merged entry replays the newest inverses first.
        this.undoStack[this.undoStack.length - 1] = [...inverse, ...open]
      } else {
        this.undoStack.push(inverse)
        this.capturing = true
      }
      this.redoStack = []
    }
    // No else branch: a batch from elsewhere does not touch the capture,
    // so consecutive local batches keep coalescing across it.
    this.emit({ kind: 'changes', changes: [...changes], origin })
  }

  stopCapturing(): void {
    this.capturing = false
  }

  subscribe(listener: (event: BoardStoreEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  undo(): void {
    this.capturing = false
    const batch = this.undoStack.pop()
    if (!batch) return
    const redo = this.invertBatch(batch)
    for (const change of batch) {
      this.applyOne(change)
    }
    this.redoStack.push(redo)
    this.emit({ kind: 'changes', changes: batch, origin: 'undo' })
  }

  redo(): void {
    this.capturing = false
    const batch = this.redoStack.pop()
    if (!batch) return
    const undo = this.invertBatch(batch)
    for (const change of batch) {
      this.applyOne(change)
    }
    this.undoStack.push(undo)
    this.emit({ kind: 'changes', changes: batch, origin: 'undo' })
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clearHistory(): void {
    this.capturing = false
    this.undoStack = []
    this.redoStack = []
  }

  protected applyOne(change: BoardChange): void {
    switch (change.kind) {
      case 'create':
        this.elements.set(change.element.id, deepFreeze(change.element))
        break
      case 'update': {
        const element = this.elements.get(change.id)
        if (element) {
          this.elements.set(
            change.id,
            deepFreeze({ ...element, ...change.props } as BoardElement),
          )
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
