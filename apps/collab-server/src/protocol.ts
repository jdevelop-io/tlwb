import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { type Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import type * as Y from 'yjs'

// Outer message types of the y-websocket wire format.
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3

/** WebSocket close codes the server uses; 4xxx are application codes. */
export const CLOSE = {
  shuttingDown: 1001,
  storage: 1011,
  unauthorized: 4401,
  readOnly: 4403,
  unknownBoard: 4404,
  tooLarge: 4409,
  invalid: 4422,
  rateLimited: 4429,
} as const

export type DecodedMessage =
  | { kind: 'sync-step1'; stateVector: Uint8Array }
  | { kind: 'sync-update'; update: Uint8Array }
  | { kind: 'awareness'; update: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'unknown' }

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

export function encodeSyncStep2(
  doc: Y.Doc,
  stateVector?: Uint8Array,
): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep2(encoder, doc, stateVector)
  return encoding.toUint8Array(encoder)
}

export function encodeUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

export function encodeAwareness(
  awareness: Awareness,
  clients: number[],
): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(
    encoder,
    encodeAwarenessUpdate(awareness, clients),
  )
  return encoding.toUint8Array(encoder)
}

/** Never throws: anything unreadable is `unknown` and gets ignored. */
export function decodeMessage(data: Uint8Array): DecodedMessage {
  try {
    const decoder = decoding.createDecoder(data)
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        const type = decoding.readVarUint(decoder)
        const payload = decoding.readVarUint8Array(decoder)
        if (type === syncProtocol.messageYjsSyncStep1) {
          return { kind: 'sync-step1', stateVector: payload }
        }
        if (
          type === syncProtocol.messageYjsSyncStep2 ||
          type === syncProtocol.messageYjsUpdate
        ) {
          return { kind: 'sync-update', update: payload }
        }
        return { kind: 'unknown' }
      }
      case MESSAGE_AWARENESS:
        return {
          kind: 'awareness',
          update: decoding.readVarUint8Array(decoder),
        }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' }
      default:
        return { kind: 'unknown' }
    }
  } catch {
    return { kind: 'unknown' }
  }
}

/** The client ids an awareness update carries, to clean up on close. */
export function awarenessClientIds(update: Uint8Array): number[] {
  const decoder = decoding.createDecoder(update)
  const count = decoding.readVarUint(decoder)
  const ids: number[] = []
  for (let i = 0; i < count; i += 1) {
    ids.push(decoding.readVarUint(decoder))
    decoding.readVarUint(decoder) // clock
    decoding.readVarString(decoder) // state
  }
  return ids
}
