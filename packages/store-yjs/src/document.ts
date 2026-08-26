import type { BoardElement } from '@tlwb/engine'
import * as Y from 'yjs'

/** Transaction origin of a batch this client authored and can undo. */
export const LOCAL_ORIGIN = 'local'
/** Transaction origin of a batch applied on behalf of someone else. */
export const REMOTE_ORIGIN = 'remote'

/** One element: a Y.Map with one key per BoardElement property. */
export type ElementMap = Y.Map<unknown>
/** The board: element id to its ElementMap. */
export type ElementsMap = Y.Map<ElementMap>

/** A fresh, empty board document. Exported so callers never import yjs. */
export function createBoardDoc(): Y.Doc {
  return new Y.Doc()
}

export function getElementsMap(doc: Y.Doc): ElementsMap {
  return doc.getMap<ElementMap>('elements')
}

export function getMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>('meta')
}

/**
 * A peer can write anything under an element id. The observer and the
 * readers below assume a Y.Map, so anything else is skipped rather than
 * crashing the transaction it arrived in. This is not element
 * validation: the properties inside the map stay unchecked.
 */
export function isElementMap(value: unknown): value is ElementMap {
  return value instanceof Y.Map
}

export function elementToMap(element: BoardElement): ElementMap {
  return new Y.Map(Object.entries(element))
}

/**
 * Rebuilds a frozen BoardElement from its map. Nothing is validated:
 * the store contract leaves that to the trust boundaries (server, MCP).
 */
export function readElement(map: ElementMap): BoardElement {
  return deepFreeze(map.toJSON() as BoardElement)
}

/**
 * Same contract as the engine's in-memory store: freezes a value and
 * everything reachable from it so callers cannot mutate stored state.
 * Duplicated rather than exported from the engine, which withholds its
 * own helpers from the public API.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const nested of Object.values(value)) {
    deepFreeze(nested)
  }
  return value
}
