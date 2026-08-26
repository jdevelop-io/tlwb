import type {
  BoardChange,
  BoardElement,
  BoardMeta,
  BoardStore,
  BoardStoreEvent,
  ChangeOrigin,
  ElementId,
  ElementProps,
} from '@tlwb/engine'
import { sortByIndex } from '@tlwb/engine'
import type * as Y from 'yjs'
import {
  deepFreeze,
  elementToMap,
  getElementsMap,
  getMetaMap,
  isElementMap,
  LOCAL_ORIGIN,
  REMOTE_ORIGIN,
  readElement,
} from './document'
import { createUndoManager } from './undo'

const DEFAULT_META: BoardMeta = { name: 'Untitled', createdAt: 0 }

/**
 * BoardStore over a Y.Doc. Every event, whatever wrote the document
 * (this store, the network, IndexedDB, undo), is derived from the
 * document's own observers, so a batch that changes nothing emits
 * nothing.
 */
export function createYjsBoardStore(doc: Y.Doc): BoardStore {
  const elements = getElementsMap(doc)
  const meta = getMetaMap(doc)
  const undoManager = createUndoManager(elements)
  const cache = new Map<ElementId, BoardElement>()
  let sorted: BoardElement[] | null = null
  const listeners = new Set<(event: BoardStoreEvent) => void>()

  for (const [id, map] of elements) {
    if (isElementMap(map)) {
      cache.set(id, readElement(map))
    }
  }

  function emit(event: BoardStoreEvent): void {
    for (const listener of listeners) {
      listener(event)
    }
  }

  function originOf(transaction: Y.Transaction): ChangeOrigin {
    const origin: unknown = transaction.origin
    if (origin === LOCAL_ORIGIN || origin === REMOTE_ORIGIN) {
      return origin
    }
    if (origin === undoManager) {
      return 'undo'
    }
    return REMOTE_ORIGIN
  }

  elements.observeDeep((events, transaction) => {
    const changes: BoardChange[] = []
    for (const event of events) {
      if (event.target === elements) {
        for (const [id, change] of event.changes.keys) {
          if (change.action === 'delete') {
            cache.delete(id)
            changes.push({ kind: 'delete', id })
          } else {
            const map = elements.get(id)
            if (isElementMap(map)) {
              const element = readElement(map)
              cache.set(id, element)
              changes.push({ kind: 'create', element })
            }
          }
        }
      } else {
        const id = String(event.path[0])
        const map = elements.get(id)
        // Anything the handler cannot read as one element's map is
        // skipped: an exception here would escape through applyUpdate
        // and take the client's synchronization loop down with it.
        if (!isElementMap(map) || event.target !== map) {
          continue
        }
        const props: Record<string, unknown> = {}
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) {
          props[key] = map.get(key)
        }
        cache.set(id, readElement(map))
        changes.push({ kind: 'update', id, props: props as ElementProps })
      }
    }
    sorted = null
    // A batch that cancels itself out changes nothing: no event at all.
    if (changes.length > 0) {
      emit({ kind: 'changes', changes, origin: originOf(transaction) })
    }
  })

  function getMeta(): BoardMeta {
    return {
      name: (meta.get('name') as string | undefined) ?? DEFAULT_META.name,
      createdAt:
        (meta.get('createdAt') as number | undefined) ?? DEFAULT_META.createdAt,
    }
  }

  meta.observe(() => {
    emit({ kind: 'meta', meta: getMeta() })
  })

  function applyOne(change: BoardChange): void {
    switch (change.kind) {
      case 'create':
        elements.set(
          change.element.id,
          elementToMap(deepFreeze(change.element)),
        )
        break
      case 'update': {
        const map = elements.get(change.id)
        if (map) {
          for (const [key, value] of Object.entries(change.props)) {
            map.set(key, value)
          }
        }
        break
      }
      case 'delete':
        elements.delete(change.id)
        break
    }
  }

  return {
    getElement: (id) => cache.get(id),
    listElements() {
      if (!sorted) {
        sorted = sortByIndex([...cache.values()])
        // Frozen rather than copied per call: the contract forbids
        // exposing internal state to callers, and the render loop wants
        // the array identity to stay stable between reads.
        Object.freeze(sorted)
      }
      return sorted
    },
    getMeta,
    setMeta(patch) {
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          meta.set(key, value)
        }
      }, LOCAL_ORIGIN)
    },
    applyChanges(changes, origin = LOCAL_ORIGIN) {
      doc.transact(() => {
        for (const change of changes) {
          applyOne(change)
        }
      }, origin)
    },
    stopCapturing() {
      undoManager.stopCapturing()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    undo() {
      undoManager.stopCapturing()
      undoManager.undo()
    },
    redo() {
      undoManager.stopCapturing()
      undoManager.redo()
    },
    canUndo: () => undoManager.canUndo(),
    canRedo: () => undoManager.canRedo(),
    clearHistory() {
      undoManager.stopCapturing()
      undoManager.clear()
    },
  }
}
