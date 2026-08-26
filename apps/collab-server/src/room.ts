import { validateElement } from '@tlwb/engine'
import {
  Awareness,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { Role } from './keys'
import {
  awarenessClientIds,
  CLOSE,
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
} from './protocol'

export interface RoomConnection {
  role: Role
  send(data: Uint8Array): void
  close(code: number, reason: string): void
}

export interface RoomOptions {
  maxMessageBytes: number
  maxDocBytes: number
  maxAwarenessBytes: number
  /** Resolves once the update is durable; rejects on a storage failure. */
  persist(update: Uint8Array): Promise<void>
}

export interface Room {
  readonly doc: Y.Doc
  join(connection: RoomConnection): void
  leave(connection: RoomConnection): void
  handleMessage(connection: RoomConnection, data: Uint8Array): Promise<void>
  connectionCount(): number
  closeAll(code: number, reason: string): void
  destroy(): void
}

function metaProblem(meta: Y.Map<unknown>): string | null {
  const name = meta.get('name')
  if (name !== undefined && typeof name !== 'string') {
    return 'meta.name'
  }
  const createdAt = meta.get('createdAt')
  if (createdAt !== undefined && !Number.isFinite(createdAt)) {
    return 'meta.createdAt'
  }
  return null
}

/**
 * One board in memory. Every incoming update lands on a staging
 * document first; only a validated update reaches the room document,
 * whose own `update` event relays it. Messages are processed one at a
 * time per room so staging always equals the room document plus the
 * update under examination.
 */
export function createRoom(doc: Y.Doc, options: RoomOptions): Room {
  const connections = new Set<RoomConnection>()
  const awarenessIds = new Map<RoomConnection, Set<number>>()
  const awareness = new Awareness(doc)
  awareness.setLocalState(null)
  let staging = new Y.Doc()
  Y.applyUpdate(staging, Y.encodeStateAsUpdate(doc))
  let queue: Promise<void> = Promise.resolve()

  const relay = (update: Uint8Array, origin: unknown) => {
    const message = encodeUpdate(update)
    for (const connection of connections) {
      if (connection !== origin) {
        connection.send(message)
      }
    }
  }
  doc.on('update', relay)

  awareness.on(
    'update',
    ({
      added,
      updated,
      removed,
    }: {
      added: number[]
      updated: number[]
      removed: number[]
    }) => {
      const message = encodeAwareness(awareness, [
        ...added,
        ...updated,
        ...removed,
      ])
      for (const connection of connections) {
        connection.send(message)
      }
    },
  )

  function rebuildStaging(): void {
    staging.destroy()
    staging = new Y.Doc()
    Y.applyUpdate(staging, Y.encodeStateAsUpdate(doc))
  }

  function reject(
    connection: RoomConnection,
    code: number,
    reason: string,
  ): void {
    rebuildStaging()
    connection.close(code, reason)
  }

  // ponytail: O(connections) scan per announced id; a room has a
  // handful of live connections, not thousands. Switch to a reverse
  // id -> owner map if a board's connection count ever makes this show
  // up in profiling.
  function ownedByAnother(connection: RoomConnection, id: number): boolean {
    for (const [owner, ids] of awarenessIds) {
      if (owner !== connection && ids.has(id)) {
        return true
      }
    }
    return false
  }

  /** Null when every touched element and the meta are well-formed. */
  function findProblem(touched: Set<string>): string | null {
    const elements = staging.getMap('elements')
    for (const id of touched) {
      const raw = elements.get(id)
      if (raw === undefined) {
        continue // deleted
      }
      if (!(raw instanceof Y.Map) || !validateElement(raw.toJSON())) {
        return `element ${id}`
      }
    }
    return metaProblem(staging.getMap('meta'))
  }

  async function processUpdate(
    connection: RoomConnection,
    update: Uint8Array,
  ): Promise<void> {
    const elements = staging.getMap('elements')
    const touched = new Set<string>()
    let changed = false
    const onElements = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      for (const event of events) {
        if (event.target === elements && event instanceof Y.YMapEvent) {
          for (const key of event.keysChanged) {
            touched.add(key)
          }
        } else {
          touched.add(String(event.path[0]))
        }
      }
    }
    // The bytes integrating this message actually produced. Collected
    // rather than kept as only the last: a single incoming message can
    // make staging fire `update` more than once.
    const emitted: Uint8Array[] = []
    const onUpdate = (data: Uint8Array) => {
      changed = true
      emitted.push(data)
    }
    elements.observeDeep(onElements)
    staging.on('update', onUpdate)
    let applied = true
    try {
      Y.applyUpdate(staging, update)
    } catch {
      applied = false
    } finally {
      elements.unobserveDeep(onElements)
      staging.off('update', onUpdate)
    }
    if (!applied) {
      reject(connection, CLOSE.invalid, 'malformed update')
      return
    }
    // An update whose dependencies are missing is parked by Yjs instead
    // of throwing: a struct dependency goes to `pendingStructs`, a
    // delete-set dependency to `pendingDs`, and either way staging
    // neither changes nor fires `update`, yet the parked bytes stay
    // queued and would silently merge into (or ride along with) a
    // later message. A single ordered WebSocket, synced through step 1
    // and step 2, can only reference structs the server already holds,
    // because staging always equals the room document.
    if (
      staging.store.pendingStructs !== null ||
      staging.store.pendingDs !== null
    ) {
      reject(connection, CLOSE.invalid, 'out-of-order update')
      return
    }
    if (!changed) {
      return // nothing new: an empty step 2 or a replay
    }
    if (connection.role === 'view') {
      reject(connection, CLOSE.readOnly, 'read-only link')
      return
    }
    const problem = findProblem(touched)
    if (problem) {
      reject(connection, CLOSE.invalid, problem)
      return
    }
    if (Y.encodeStateAsUpdate(staging).byteLength > options.maxDocBytes) {
      reject(connection, CLOSE.tooLarge, 'document too large')
      return
    }
    // Persist and relay exactly what integrating this message produced,
    // never a full re-encode: `Y.encodeStateAsUpdate(staging)` carries
    // the document's entire delete set, which would make the persisted
    // update log grow as O(updates x deletions) instead of O(this
    // update). `changed` is true here, so `emitted` is never empty.
    const diff = Y.mergeUpdates(emitted)
    try {
      await options.persist(diff)
    } catch {
      reject(connection, CLOSE.storage, 'storage failure')
      return
    }
    Y.applyUpdate(doc, diff, connection)
  }

  async function process(
    connection: RoomConnection,
    data: Uint8Array,
  ): Promise<void> {
    if (!connections.has(connection)) {
      return
    }
    try {
      await processMessage(connection, data)
    } catch {
      // Anything unexpected (a socket that throws on send, a doc that
      // fails to apply a diff it should accept) closes the offending
      // connection instead of wedging every other connection's queue.
      connection.close(CLOSE.invalid, 'internal error')
    }
  }

  async function processMessage(
    connection: RoomConnection,
    data: Uint8Array,
  ): Promise<void> {
    if (data.byteLength > options.maxMessageBytes) {
      connection.close(CLOSE.tooLarge, 'message too large')
      return
    }
    const message = decodeMessage(data)
    switch (message.kind) {
      case 'sync-step1': {
        let step2: Uint8Array
        try {
          // The state vector is attacker-controlled bytes that
          // `decodeMessage` never validates beyond its own framing.
          step2 = encodeSyncStep2(doc, message.stateVector)
        } catch {
          connection.close(CLOSE.invalid, 'malformed state vector')
          return
        }
        connection.send(step2)
        return
      }
      case 'sync-update':
        await processUpdate(connection, message.update)
        return
      case 'awareness': {
        if (data.byteLength > options.maxAwarenessBytes) {
          connection.close(CLOSE.tooLarge, 'awareness too large')
          return
        }
        let ids: number[]
        try {
          ids = awarenessClientIds(message.update)
        } catch {
          return
        }
        const owned = awarenessIds.get(connection) ?? new Set<number>()
        for (const id of ids) {
          // A connection can announce any clientID (awareness content is
          // never validated), but only the connection that announced it
          // first may later remove it on leave: otherwise one peer could
          // claim another's clientID and wipe their cursor on leave.
          if (!ownedByAnother(connection, id)) {
            owned.add(id)
          }
        }
        awarenessIds.set(connection, owned)
        try {
          applyAwarenessUpdate(awareness, message.update, connection)
        } catch {
          // Malformed awareness payload: ignore it, do not break the room.
        }
        return
      }
      case 'query-awareness':
        connection.send(
          encodeAwareness(awareness, [...awareness.getStates().keys()]),
        )
        return
      case 'unknown':
        return
    }
  }

  function leave(connection: RoomConnection): void {
    connections.delete(connection)
    const owned = awarenessIds.get(connection)
    awarenessIds.delete(connection)
    if (owned && owned.size > 0) {
      removeAwarenessStates(awareness, [...owned], null)
    }
  }

  return {
    doc,
    join(connection) {
      connections.add(connection)
      connection.send(encodeSyncStep1(doc))
      const states = [...awareness.getStates().keys()]
      if (states.length > 0) {
        connection.send(encodeAwareness(awareness, states))
      }
    },
    leave,
    handleMessage(connection, data) {
      // ponytail: one queue per room serializes every message; per-board
      // throughput is bounded by persistence latency. Batch inserts if
      // it shows.
      //
      // `process` never rejects (it catches everything itself), but the
      // chain is decoupled from the per-call result anyway: a rejection
      // must never be able to wedge every later message in this room.
      const next = queue.then(() => process(connection, data))
      queue = next.catch(() => {})
      return next
    },
    connectionCount: () => connections.size,
    closeAll(code, reason) {
      for (const connection of [...connections]) {
        connection.close(code, reason)
        leave(connection)
      }
    },
    destroy() {
      doc.off('update', relay)
      awareness.destroy()
      staging.destroy()
      connections.clear()
      awarenessIds.clear()
    },
  }
}
