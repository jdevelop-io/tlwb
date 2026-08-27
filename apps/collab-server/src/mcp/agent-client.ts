import type { BoardStore, Point } from '@tlwb/engine'
import { createYjsBoardStore } from '@tlwb/store-yjs'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { Db } from '../db/client'
import type { Role } from '../keys'
import {
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
} from '../protocol'
import type { RoomConnection } from '../room'
import type { RoomRegistry } from '../rooms'
import { type BoardRef, resolveBoardRole } from './board-ref'
import { ToolError } from './tool-error'

/** One fixed colour for every agent: the badge, not the colour, tells them apart. */
export const AGENT_COLOR = '#7C3AED'

export interface AgentDeps {
  db: Db
  rooms: RoomRegistry
  /** How long the agent stays visible after a mutation. */
  presenceMs: number
}

export interface AgentPresence {
  name: string
  cursor: Point | null
  selectedIds: string[]
}

export interface AgentClient {
  readonly boardId: string
  readonly role: Role
  /** The mirror: what the room holds, plus this call's own mutations. */
  readonly store: BoardStore
  /**
   * Runs `fn` on the mirror and submits every update it produced to the
   * room as one message. Resolves once the room accepted it; rejects
   * with a ToolError carrying the room's reason otherwise.
   */
  mutate(fn: (store: BoardStore) => void): Promise<void>
  /**
   * Publishes the agent on the awareness protocol. The connection then
   * outlives `withBoard` by `presenceMs`, and leaving removes the state.
   */
  present(presence: AgentPresence): void
}

function rejection(boardId: string, reason: string): ToolError {
  if (reason === 'document too large') {
    return new ToolError(`board ${boardId} exceeds the size limit`)
  }
  if (reason === 'read-only link') {
    return new ToolError(`board ${boardId} is view-only with this link`)
  }
  return new ToolError(`elements rejected: ${reason}`)
}

/**
 * A virtual connection to the in-memory room: the agent takes the exact
 * path a browser takes (sync, update, awareness through
 * `handleMessage`), so validation, persistence, and relay need nothing
 * agent-specific. One mirror per call; nothing survives between calls.
 */
export async function withBoard<T>(
  deps: AgentDeps,
  ref: BoardRef,
  needs: Role,
  run: (client: AgentClient) => Promise<T>,
): Promise<T> {
  const role = await resolveBoardRole(deps.db, ref)
  if (needs === 'edit' && role !== 'edit') {
    throw new ToolError(`board ${ref.boardId} is view-only with this link`)
  }
  const room = await deps.rooms.acquire(ref.boardId)
  if (!room) {
    throw new ToolError(`board ${ref.boardId} not found`)
  }

  const mirror = new Y.Doc()
  let closed: { code: number; reason: string } | null = null
  const connection: RoomConnection = {
    role,
    send(data) {
      const message = decodeMessage(data)
      if (message.kind === 'sync-update') {
        Y.applyUpdate(mirror, message.update, 'room')
      }
      // The room's own step 1 and awareness broadcasts need no answer.
    },
    close(code, reason) {
      closed = { code, reason }
    },
  }
  let hold = false
  const store = createYjsBoardStore(mirror)

  const client: AgentClient = {
    boardId: ref.boardId,
    role,
    store,
    async mutate(fn) {
      const emitted: Uint8Array[] = []
      const capture = (update: Uint8Array) => {
        emitted.push(update)
      }
      mirror.on('update', capture)
      try {
        fn(store)
      } finally {
        mirror.off('update', capture)
      }
      if (emitted.length === 0) {
        return
      }
      await room.handleMessage(
        connection,
        encodeUpdate(Y.mergeUpdates(emitted)),
      )
      if (closed) {
        throw rejection(ref.boardId, closed.reason)
      }
    },
    present(presence) {
      const awareness = new Awareness(mirror)
      awareness.setLocalState({
        ...presence,
        color: AGENT_COLOR,
        isAgent: true,
      })
      const message = encodeAwareness(awareness, [awareness.clientID])
      // Destroyed right away: the bytes are built, and a live Awareness
      // keeps a timer running.
      awareness.destroy()
      void room.handleMessage(connection, message)
      hold = true
    },
  }

  const leave = () => {
    room.leave(connection)
    deps.rooms.release(ref.boardId)
    mirror.destroy()
  }

  room.join(connection)
  try {
    // The room answers step 1 with step 2, applied to the mirror in `send`.
    await room.handleMessage(connection, encodeSyncStep1(mirror))
    return await run(client)
  } finally {
    if (hold && !closed) {
      setTimeout(leave, deps.presenceMs).unref()
    } else {
      leave()
    }
  }
}
