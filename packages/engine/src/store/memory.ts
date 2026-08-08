import type { BoardElement, ElementId } from '../model/element'
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
  }

  applyChanges(changes: BoardChange[], origin: ChangeOrigin = 'local'): void {
    for (const change of changes) {
      this.applyOne(change)
    }
    this.emit({ changes, origin })
  }

  subscribe(listener: (event: BoardStoreEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
}
