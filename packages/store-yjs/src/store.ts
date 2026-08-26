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
  type ElementMap,
  elementToMap,
  getElementsMap,
  getMetaMap,
  LOCAL_ORIGIN,
  REMOTE_ORIGIN,
  readElement,
} from './document'

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
  const cache = new Map<ElementId, BoardElement>()
  let sorted: BoardElement[] | null = null
  const listeners = new Set<(event: BoardStoreEvent) => void>()

  for (const [id, map] of elements) {
    cache.set(id, readElement(map))
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
            if (map) {
              const element = readElement(map)
              cache.set(id, element)
              changes.push({ kind: 'create', element })
            }
          }
        }
      } else {
        const mapEvent = event as Y.YMapEvent<unknown>
        const id = String(mapEvent.path[0])
        const map = mapEvent.target as ElementMap
        const props: Record<string, unknown> = {}
        for (const key of mapEvent.keysChanged) {
          props[key] = map.get(key)
        }
        cache.set(id, readElement(map))
        changes.push({ kind: 'update', id, props: props as ElementProps })
      }
    }
    sorted = null
    emit({ kind: 'changes', changes, origin: originOf(transaction) })
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
    stopCapturing() {},
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    undo() {},
    redo() {},
    canUndo: () => false,
    canRedo: () => false,
    clearHistory() {},
  }
}
