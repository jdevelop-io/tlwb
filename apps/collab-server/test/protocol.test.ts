import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  awarenessClientIds,
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
} from '../src/protocol'

describe('protocol', () => {
  it('round-trips a sync step 1 and answers it with a step 2', () => {
    const server = new Y.Doc()
    server.getMap('elements').set('a', 1)
    const client = new Y.Doc()

    const step1 = decodeMessage(encodeSyncStep1(client))
    expect(step1.kind).toBe('sync-step1')
    if (step1.kind !== 'sync-step1') {
      throw new Error('unreachable')
    }
    const step2 = decodeMessage(encodeSyncStep2(server, step1.stateVector))
    expect(step2.kind).toBe('sync-update')
    if (step2.kind !== 'sync-update') {
      throw new Error('unreachable')
    }
    Y.applyUpdate(client, step2.update)
    expect(client.getMap('elements').get('a')).toBe(1)
    server.destroy()
    client.destroy()
  })

  it('round-trips an update message', () => {
    const doc = new Y.Doc()
    doc.getMap('elements').set('a', 1)
    const message = decodeMessage(encodeUpdate(Y.encodeStateAsUpdate(doc)))
    expect(message.kind).toBe('sync-update')
    doc.destroy()
  })

  it('round-trips awareness and lists its client ids', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    awareness.setLocalState({ name: 'Ada' })
    const message = decodeMessage(encodeAwareness(awareness, [doc.clientID]))
    expect(message.kind).toBe('awareness')
    if (message.kind !== 'awareness') {
      throw new Error('unreachable')
    }
    expect(awarenessClientIds(message.update)).toEqual([doc.clientID])
    awareness.destroy()
    doc.destroy()
  })

  it('reports garbage and unknown types as unknown', () => {
    expect(decodeMessage(new Uint8Array([9, 9, 9])).kind).toBe('unknown')
    expect(decodeMessage(new Uint8Array([])).kind).toBe('unknown')
    expect(decodeMessage(new Uint8Array([3])).kind).toBe('query-awareness')
  })
})
