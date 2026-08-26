import * as Y from 'yjs'
import type { Config } from './config'
import { appendUpdate, compactBoard, loadBoard } from './db/boards'
import type { Db } from './db/client'
import { log } from './log'
import { CLOSE } from './protocol'
import { createRoom, type Room } from './room'

export interface RoomRegistry {
  /** The room for a board, loaded on first use; undefined if the board does not exist. */
  acquire(boardId: string): Promise<Room | undefined>
  /** Called when a connection left; starts the idle timer on an empty room. */
  release(boardId: string): void
  shutdown(): Promise<void>
}

interface Entry {
  room: Room
  compact(): Promise<void>
  idleTimer: NodeJS.Timeout | null
}

export function createRooms(deps: { db: Db; config: Config }): RoomRegistry {
  const { db, config } = deps
  const entries = new Map<string, Promise<Entry | undefined>>()
  // Flipped once shutdown starts draining: stops release() from arming a
  // new idle timer, and stops an already-armed one from firing, on an
  // entry shutdown's own loop is about to (or already did) destroy.
  let stopped = false

  async function load(boardId: string): Promise<Entry | undefined> {
    const loaded = await loadBoard(db, boardId)
    if (!loaded) {
      return undefined
    }
    const doc = new Y.Doc()
    if (loaded.snapshot) {
      Y.applyUpdate(doc, loaded.snapshot)
    }
    for (const row of loaded.updates) {
      Y.applyUpdate(doc, row.update)
    }
    let lastSeq = loaded.updates.at(-1)?.seq ?? loaded.snapshotSeq
    let residual = loaded.updates.length
    // Gates the threshold-triggered retry in `applied` below: a failed
    // compaction sets this to residual + compactAfterUpdates, so the
    // next attempt waits for another full window of updates instead of
    // retrying on every message that arrives while the database is
    // still unhappy.
    let retryAfter = 0

    const compact = async () => {
      if (residual === 0) {
        return
      }
      const upToSeq = lastSeq
      await compactBoard(db, boardId, Y.encodeStateAsUpdate(doc), upToSeq)
      residual = 0
      retryAfter = 0
      log({ event: 'compacted', boardId, upToSeq })
    }

    const room = createRoom(doc, {
      maxMessageBytes: config.maxMessageBytes,
      maxDocBytes: config.maxDocBytes,
      maxAwarenessBytes: config.maxAwarenessBytes,
      persist: (update) => appendUpdate(db, boardId, update),
      // `lastSeq` means "the last sequence number the document
      // contains", so it is assigned here rather than in `persist`: a
      // compaction triggered from `persist` would snapshot a document
      // that does not yet hold the very update its `snapshot_seq`
      // covers, and then delete that update's row.
      applied: async (seq) => {
        lastSeq = seq
        residual += 1
        if (residual >= config.compactAfterUpdates && residual >= retryAfter) {
          try {
            await compact()
          } catch (error) {
            // The update is durable and applied; a failed compaction
            // only leaves more residual rows behind, and eviction
            // retries. It is not the sender's problem. Retrying on
            // every later message would pay for a failed encode and a
            // failed transaction on the hot message path for no
            // reason: wait for another full window before trying again.
            retryAfter = residual + config.compactAfterUpdates
            log({ event: 'compaction failed', boardId, error: String(error) })
          }
        }
      },
    })
    log({ event: 'room loaded', boardId, residual })
    return { room, compact, idleTimer: null }
  }

  async function evict(boardId: string, entry: Entry): Promise<void> {
    // Removed first so a connection arriving now loads a fresh room
    // instead of waiting on this eviction. That fresh load's two SELECTs
    // run inside loadBoard's own transaction, so it cannot observe this
    // compaction's write half-committed.
    entries.delete(boardId)
    // A message accepted just before the room went idle may still be
    // between its INSERT and its apply: compacting now would snapshot a
    // document without it, and destroying the room would apply it to a
    // destroyed document.
    await entry.room.drain()
    try {
      await entry.compact()
    } catch (error) {
      log({ event: 'compaction failed', boardId, error: String(error) })
    }
    entry.room.destroy()
    entry.room.doc.destroy()
    log({ event: 'room evicted', boardId })
  }

  return {
    async acquire(boardId) {
      // An upgrade already past the handshake when close() starts
      // draining can still reach here after shutdown finished: refusing
      // it here means nothing is ever created for shutdown to miss.
      if (stopped) {
        return undefined
      }
      let pending = entries.get(boardId)
      if (!pending) {
        pending = load(boardId)
        entries.set(boardId, pending)
      }
      // A rejected or empty load must not poison the cache: evict it so
      // the next acquire gets a fresh attempt instead of the same error
      // (or the same missing board) forever. Guarded by identity so this
      // never deletes an entry a later, unrelated acquire already put in
      // this slot.
      const evictIfCurrent = () => {
        if (entries.get(boardId) === pending) {
          entries.delete(boardId)
        }
      }
      let entry: Entry | undefined
      try {
        entry = await pending
      } catch (error) {
        evictIfCurrent()
        throw error
      }
      if (!entry) {
        evictIfCurrent()
        return undefined
      }
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer)
        entry.idleTimer = null
      }
      return entry.room
    },
    release(boardId) {
      entries.get(boardId)?.then(
        (entry) => {
          if (
            stopped ||
            !entry ||
            entry.room.connectionCount() > 0 ||
            entry.idleTimer
          ) {
            return
          }
          entry.idleTimer = setTimeout(() => {
            entry.idleTimer = null
            if (!stopped && entry.room.connectionCount() === 0) {
              void evict(boardId, entry)
            }
          }, config.roomIdleMs)
        },
        (error) => {
          log({ event: 'release failed', boardId, error: String(error) })
        },
      )
    },
    async shutdown() {
      stopped = true
      const pending = [...entries.entries()]
      entries.clear()
      for (const [boardId, promise] of pending) {
        let entry: Entry | undefined
        try {
          entry = await promise
        } catch (error) {
          log({ event: 'room load failed', boardId, error: String(error) })
          continue
        }
        if (!entry) {
          continue
        }
        if (entry.idleTimer) {
          clearTimeout(entry.idleTimer)
        }
        entry.room.closeAll(CLOSE.shuttingDown, 'server shutting down')
        // `closeAll` empties the connection set synchronously, so the
        // room can look idle while a message is still mid-flight:
        // draining makes "every accepted update is persisted and
        // applied before we snapshot" an ordering invariant instead of
        // a timing accident.
        await entry.room.drain()
        try {
          await entry.compact()
        } catch (error) {
          log({ event: 'compaction failed', boardId, error: String(error) })
        }
        entry.room.destroy()
        entry.room.doc.destroy()
      }
    },
  }
}
