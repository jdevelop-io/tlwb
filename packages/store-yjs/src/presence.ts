import type { ElementId, Peer, Point } from '@tlwb/engine'
import { sanitizePeers } from '@tlwb/engine'
import { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

export interface LocalPresence {
  name: string
  color: string
  isAgent: boolean
}

export interface Presence {
  setCursor(cursor: Point | null): void
  setSelection(ids: ElementId[]): void
  /** Every other well-formed collaborator; malformed states are dropped. */
  getPeers(): Peer[]
  /** Fires on any awareness change, local or remote. */
  subscribe(listener: () => void): () => void
  destroy(): void
}

/**
 * Awareness for a board with no connection: presence runs with zero
 * peers. A connected board uses its provider's awareness instead.
 */
export function createLocalAwareness(doc: Y.Doc): Awareness {
  return new Awareness(doc)
}

/**
 * Publishes this client on the awareness protocol and reads the others
 * back as the engine's Peer type. Ephemeral by construction: nothing
 * here touches the document.
 */
export function createPresence(
  awareness: Awareness,
  local: LocalPresence,
): Presence {
  awareness.setLocalState({ ...local, cursor: null, selectedIds: [] })

  return {
    setCursor(cursor) {
      awareness.setLocalStateField('cursor', cursor)
    },
    setSelection(ids) {
      awareness.setLocalStateField('selectedIds', ids)
    },
    getPeers() {
      const states: unknown[] = []
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId !== awareness.clientID && state) {
          states.push({ ...state, id: String(clientId) })
        }
      }
      return sanitizePeers(states)
    },
    subscribe(listener) {
      awareness.on('change', listener)
      return () => awareness.off('change', listener)
    },
    destroy() {
      awareness.setLocalState(null)
    },
  }
}
