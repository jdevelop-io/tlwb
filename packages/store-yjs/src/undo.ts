import * as Y from 'yjs'
import { type ElementsMap, LOCAL_ORIGIN } from './document'

/**
 * Undo restricted to what this client wrote. Only the elements map is
 * in scope: like the in-memory store, a meta change is not undoable.
 * The infinite capture timeout makes consecutive local batches coalesce
 * into one entry until stopCapturing closes it, which is the store
 * contract's rule for gestures.
 */
export function createUndoManager(elements: ElementsMap): Y.UndoManager {
  return new Y.UndoManager(elements, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: Number.POSITIVE_INFINITY,
  })
}
