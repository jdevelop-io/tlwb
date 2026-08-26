import { createElement } from '@tlwb/engine'
import * as encoding from 'lib0/encoding'
import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  awarenessClientIds,
  CLOSE,
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
} from '../src/protocol'
import { createRoom, type RoomConnection } from '../src/room'

interface FakeConnection extends RoomConnection {
  received: Uint8Array[]
  closed: { code: number; reason: string } | null
}

function connection(role: 'edit' | 'view'): FakeConnection {
  const fake: FakeConnection = {
    role,
    received: [],
    closed: null,
    send: (data) => fake.received.push(data),
    close: (code, reason) => {
      fake.closed = { code, reason }
    },
  }
  return fake
}

/** What a throwaway client document sends after `mutate`. */
function clientUpdate(mutate: (elements: Y.Map<unknown>) => void): Uint8Array {
  const doc = new Y.Doc()
  const before = Y.encodeStateVector(doc)
  doc.transact(() => mutate(doc.getMap('elements')))
  const update = Y.encodeStateAsUpdate(doc, before)
  doc.destroy()
  return update
}

/** A fresh empty document, destroyed right away: only its bytes matter. */
function emptyDoc(): Y.Doc {
  const doc = new Y.Doc()
  doc.destroy()
  return doc
}

function elementMap(overrides: Record<string, unknown> = {}): Y.Map<unknown> {
  const element = createElement('rectangle', { index: 'a0', id: 'r1' })
  return new Y.Map(Object.entries({ ...element, ...overrides }))
}

/**
 * A well-formed awareness message whose state is not valid JSON: passes
 * `awarenessClientIds` (it never parses the state) but makes
 * `applyAwarenessUpdate` throw.
 */
function malformedAwarenessMessage(): Uint8Array {
  const inner = encoding.createEncoder()
  encoding.writeVarUint(inner, 1)
  encoding.writeVarUint(inner, 12345)
  encoding.writeVarUint(inner, 1)
  encoding.writeVarString(inner, 'not json')
  const outer = encoding.createEncoder()
  encoding.writeVarUint(outer, 1) // MESSAGE_AWARENESS
  encoding.writeVarUint8Array(outer, encoding.toUint8Array(inner))
  return encoding.toUint8Array(outer)
}

/** A single awareness message announcing `count` distinct client ids. */
function manyAwarenessIds(count: number): Uint8Array {
  const inner = encoding.createEncoder()
  encoding.writeVarUint(inner, count)
  for (let i = 0; i < count; i += 1) {
    encoding.writeVarUint(inner, 90_000 + i) // clientID
    encoding.writeVarUint(inner, 1) // clock
    encoding.writeVarString(inner, JSON.stringify({ name: `peer-${i}` }))
  }
  const outer = encoding.createEncoder()
  encoding.writeVarUint(outer, 1) // MESSAGE_AWARENESS
  encoding.writeVarUint8Array(outer, encoding.toUint8Array(inner))
  return encoding.toUint8Array(outer)
}

function setup(overrides: Partial<Parameters<typeof createRoom>[1]> = {}) {
  const persisted: Uint8Array[] = []
  const applied: number[] = []
  const doc = new Y.Doc()
  const room = createRoom(doc, {
    maxMessageBytes: 1_000_000,
    maxDocBytes: 1_000_000,
    maxAwarenessBytes: 16_384,
    persist: async (update) => {
      persisted.push(update)
      return persisted.length
    },
    applied: async (seq) => {
      applied.push(seq)
    },
    ...overrides,
  })
  return { doc, room, persisted, applied }
}

describe('createRoom', () => {
  it('answers a sync step 1 with the room state and relays a valid update', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    const bob = connection('edit')
    room.join(alice)
    room.join(bob)
    // Joining sends a step 1 so the client answers with its state.
    expect(decodeMessage(alice.received[0] as Uint8Array).kind).toBe(
      'sync-step1',
    )

    await room.handleMessage(
      alice,
      encodeUpdate(
        clientUpdate((elements) => elements.set('r1', elementMap())),
      ),
    )
    expect(persisted).toHaveLength(1)
    expect(doc.getMap('elements').has('r1')).toBe(true)
    const relayed = bob.received.filter(
      (data) => decodeMessage(data).kind === 'sync-update',
    )
    expect(relayed).toHaveLength(1)
    expect(
      alice.received.filter(
        (data) => decodeMessage(data).kind === 'sync-update',
      ),
    ).toHaveLength(0)

    const late = connection('view')
    room.join(late)
    await room.handleMessage(late, encodeSyncStep1(emptyDoc()))
    const step2 = late.received
      .map(decodeMessage)
      .find((m) => m.kind === 'sync-update')
    expect(step2).toBeDefined()
    room.destroy()
    doc.destroy()
  })

  it('rejects a malformed element without relaying or persisting, then accepts the next valid one', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    const bob = connection('edit')
    const carol = connection('edit')
    room.join(alice)
    room.join(bob)
    room.join(carol)

    await room.handleMessage(
      alice,
      encodeUpdate(
        clientUpdate((elements) =>
          elements.set('r1', elementMap({ x: 'oops' })),
        ),
      ),
    )
    expect(alice.closed).toEqual({ code: CLOSE.invalid, reason: 'element r1' })
    expect(persisted).toHaveLength(0)
    expect(doc.getMap('elements').has('r1')).toBe(false)
    expect(
      bob.received.filter((d) => decodeMessage(d).kind === 'sync-update'),
    ).toHaveLength(0)
    room.leave(alice)

    await room.handleMessage(
      carol,
      encodeUpdate(
        clientUpdate((elements) =>
          elements.set('r2', elementMap({ id: 'r2' })),
        ),
      ),
    )
    expect(persisted).toHaveLength(1)
    expect(doc.getMap('elements').has('r2')).toBe(true)
    expect(
      bob.received.filter((d) => decodeMessage(d).kind === 'sync-update'),
    ).toHaveLength(1)
    room.destroy()
    doc.destroy()
  })

  it('rejects a value that is not an element map, a bad meta, and an unparsable update', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    room.join(alice)
    await room.handleMessage(
      alice,
      encodeUpdate(
        clientUpdate((elements) => elements.set('junk', 'not a map')),
      ),
    )
    expect(alice.closed?.code).toBe(CLOSE.invalid)

    const bob = connection('edit')
    room.join(bob)
    const badMeta = new Y.Doc()
    badMeta.getMap('meta').set('name', 42)
    await room.handleMessage(bob, encodeUpdate(Y.encodeStateAsUpdate(badMeta)))
    badMeta.destroy()
    expect(bob.closed).toEqual({ code: CLOSE.invalid, reason: 'meta.name' })

    const carol = connection('edit')
    room.join(carol)
    await room.handleMessage(carol, encodeUpdate(new Uint8Array([1, 0, 200])))
    expect(carol.closed?.code).toBe(CLOSE.invalid)
    expect(persisted).toHaveLength(0)
    room.destroy()
    doc.destroy()
  })

  it('closes a read-only connection that sends a change, and accepts its empty step 2', async () => {
    const { room, persisted, doc } = setup()
    const viewer = connection('view')
    room.join(viewer)
    // An empty client answering the server's step 1 sends a step 2 with
    // nothing in it: not a write.
    await room.handleMessage(
      viewer,
      encodeUpdate(Y.encodeStateAsUpdate(emptyDoc())),
    )
    expect(viewer.closed).toBeNull()

    await room.handleMessage(
      viewer,
      encodeUpdate(
        clientUpdate((elements) => elements.set('r1', elementMap())),
      ),
    )
    expect(viewer.closed).toEqual({
      code: CLOSE.readOnly,
      reason: 'read-only link',
    })
    expect(persisted).toHaveLength(0)
    room.destroy()
    doc.destroy()
  })

  it('enforces the message and document size limits', async () => {
    const { room, doc } = setup({ maxMessageBytes: 16, maxDocBytes: 200 })
    const alice = connection('edit')
    room.join(alice)
    await room.handleMessage(alice, new Uint8Array(17))
    expect(alice.closed).toEqual({
      code: CLOSE.tooLarge,
      reason: 'message too large',
    })

    const { room: small, doc: smallDoc } = setup({ maxDocBytes: 200 })
    const bob = connection('edit')
    small.join(bob)
    await small.handleMessage(
      bob,
      encodeUpdate(
        clientUpdate((elements) => {
          for (let i = 0; i < 20; i += 1) {
            elements.set(`r${i}`, elementMap({ id: `r${i}` }))
          }
        }),
      ),
    )
    expect(bob.closed).toEqual({
      code: CLOSE.tooLarge,
      reason: 'document too large',
    })
    room.destroy()
    doc.destroy()
    small.destroy()
    smallDoc.destroy()
  })

  it('closes with a storage code when persistence fails and keeps the document clean', async () => {
    const { room, doc } = setup({
      persist: async () => {
        throw new Error('down')
      },
    })
    const alice = connection('edit')
    room.join(alice)
    await room.handleMessage(
      alice,
      encodeUpdate(
        clientUpdate((elements) => elements.set('r1', elementMap())),
      ),
    )
    expect(alice.closed).toEqual({
      code: CLOSE.storage,
      reason: 'storage failure',
    })
    expect(doc.getMap('elements').has('r1')).toBe(false)
    room.destroy()
    doc.destroy()
  })

  it('relays awareness to everyone and removes a peer on leave', async () => {
    const { room, doc } = setup()
    const alice = connection('edit')
    const bob = connection('view')
    room.join(alice)
    room.join(bob)
    const client = new Y.Doc()
    const awareness = new Awareness(client)
    awareness.setLocalState({ name: 'Ada' })
    await room.handleMessage(
      alice,
      encodeAwareness(awareness, [client.clientID]),
    )
    expect(
      bob.received.filter((d) => decodeMessage(d).kind === 'awareness'),
    ).toHaveLength(1)

    const before = bob.received.length
    room.leave(alice)
    expect(bob.received.length).toBe(before + 1)
    expect(decodeMessage(bob.received[before] as Uint8Array).kind).toBe(
      'awareness',
    )
    expect(room.connectionCount()).toBe(1)
    awareness.destroy()
    client.destroy()
    room.destroy()
    doc.destroy()
  })

  it('rejects an out-of-order update instead of integrating a pending struct into a later message', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    room.join(alice)

    // A single client's history split into two wire messages: A creates
    // r1 with a malformed x, B later fixes x on that same r1. B depends
    // on the struct A creates.
    const client = new Y.Doc()
    const beforeA = Y.encodeStateVector(client)
    client.getMap('elements').set('r1', elementMap({ x: 'oops' }))
    const messageA = Y.encodeStateAsUpdate(client, beforeA)
    const beforeB = Y.encodeStateVector(client)
    ;(client.getMap('elements').get('r1') as Y.Map<unknown>).set('x', 0)
    const messageB = Y.encodeStateAsUpdate(client, beforeB)
    client.destroy()

    // Send B first: it depends on a struct staging has never seen.
    await room.handleMessage(alice, encodeUpdate(messageB))
    expect(alice.closed).toEqual({
      code: CLOSE.invalid,
      reason: 'out-of-order update',
    })
    expect(persisted).toHaveLength(0)
    expect(doc.getMap('elements').has('r1')).toBe(false)

    // A alone is still evaluated on its own merits: the pending B must
    // not have been smuggled in to make it look valid.
    await room.handleMessage(alice, encodeUpdate(messageA))
    expect(persisted).toHaveLength(0)
    expect(doc.getMap('elements').has('r1')).toBe(false)

    room.destroy()
    doc.destroy()
  })

  it('keeps processing later messages after one throws while decoding a poisoned state vector', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    room.join(alice)

    // Decodes as a sync-step1 whose state vector is truncated garbage:
    // encodeSyncStep2 throws decoding it.
    await room.handleMessage(alice, new Uint8Array([0, 0, 3, 255, 255, 255]))
    expect(alice.closed?.code).toBe(CLOSE.invalid)

    const bob = connection('edit')
    room.join(bob)
    await room.handleMessage(
      bob,
      encodeUpdate(
        clientUpdate((elements) => elements.set('r1', elementMap())),
      ),
    )
    expect(persisted).toHaveLength(1)
    expect(doc.getMap('elements').has('r1')).toBe(true)

    room.destroy()
    doc.destroy()
  })

  it('rejects a nested mutation that leaves an existing element malformed', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    const bob = connection('edit')
    room.join(alice)
    room.join(bob)

    await room.handleMessage(
      alice,
      encodeUpdate(
        clientUpdate((elements) => elements.set('r1', elementMap())),
      ),
    )
    expect(persisted).toHaveLength(1)

    // A client in sync with the room mutates a property nested inside
    // the existing r1 map, not a whole-element set on `elements` itself.
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(doc))
    const before = Y.encodeStateVector(client)
    ;(client.getMap('elements').get('r1') as Y.Map<unknown>).set('x', 'oops')
    const mutation = Y.encodeStateAsUpdate(client, before)
    client.destroy()

    await room.handleMessage(alice, encodeUpdate(mutation))
    expect(alice.closed).toEqual({ code: CLOSE.invalid, reason: 'element r1' })
    expect(persisted).toHaveLength(1)
    expect(
      (doc.getMap('elements').get('r1') as Y.Map<unknown>).get('x'),
    ).not.toBe('oops')
    expect(
      bob.received.filter((d) => decodeMessage(d).kind === 'sync-update'),
    ).toHaveLength(1)

    room.destroy()
    doc.destroy()
  })

  it('does not let a connection remove awareness state announced first by someone else', async () => {
    const { room, doc } = setup()
    const alice = connection('edit')
    const bob = connection('edit')
    const carol = connection('view')
    room.join(alice)
    room.join(bob)
    room.join(carol)

    const client = new Y.Doc()
    const awareness = new Awareness(client)
    awareness.setLocalState({ name: 'Ada' })
    const update = encodeAwareness(awareness, [client.clientID])

    await room.handleMessage(bob, update)
    // alice falsely claims the clientID bob already registered.
    await room.handleMessage(alice, update)

    const before = carol.received.length
    room.leave(alice)
    expect(carol.received.length).toBe(before)

    room.leave(bob)
    expect(carol.received.length).toBe(before + 1)
    expect(decodeMessage(carol.received[before] as Uint8Array).kind).toBe(
      'awareness',
    )

    awareness.destroy()
    client.destroy()
    room.destroy()
    doc.destroy()
  })

  it('ignores a malformed awareness payload instead of breaking the room', async () => {
    const { room, doc } = setup()
    const alice = connection('edit')
    room.join(alice)

    await room.handleMessage(alice, malformedAwarenessMessage())
    expect(alice.closed).toBeNull()

    await room.handleMessage(
      alice,
      encodeUpdate(
        clientUpdate((elements) => elements.set('r1', elementMap())),
      ),
    )
    expect(doc.getMap('elements').has('r1')).toBe(true)

    room.destroy()
    doc.destroy()
  })

  it('closes a connection that sends an oversized awareness message', async () => {
    const { room, doc } = setup({ maxAwarenessBytes: 8 })
    const alice = connection('edit')
    room.join(alice)
    const client = new Y.Doc()
    const awareness = new Awareness(client)
    awareness.setLocalState({
      name: 'a name long enough to push this payload past eight bytes',
    })

    await room.handleMessage(
      alice,
      encodeAwareness(awareness, [client.clientID]),
    )
    expect(alice.closed).toEqual({
      code: CLOSE.tooLarge,
      reason: 'awareness too large',
    })

    awareness.destroy()
    client.destroy()
    room.destroy()
    doc.destroy()
  })

  it('caps the awareness ids one connection may claim, observable through its leave relay', async () => {
    const { room, doc } = setup()
    const alice = connection('edit')
    const bob = connection('view')
    room.join(alice)
    room.join(bob)

    // Alice announces more identifiers than MAX_AWARENESS_IDS (32) in a
    // single message; only the first 32 are hers to remove on leave.
    await room.handleMessage(alice, manyAwarenessIds(40))

    const before = bob.received.length
    room.leave(alice)
    const removals = bob.received
      .slice(before)
      .map(decodeMessage)
      .filter((m) => m.kind === 'awareness')
    expect(removals).toHaveLength(1)
    const removal = removals[0] as { kind: 'awareness'; update: Uint8Array }
    expect(awarenessClientIds(removal.update)).toHaveLength(32)

    room.destroy()
    doc.destroy()
  })

  it('rejects a parked delete set instead of laundering it into a later accepted update', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    const bob = connection('edit')
    room.join(alice)
    room.join(bob)

    // A delete-only update naming a clientID and clock range the room
    // has never seen: created and deleted in a throwaway doc, then
    // sliced down to just the delete. Yjs defers this into
    // `store.pendingDs`, not `store.pendingStructs`.
    const ghost = new Y.Doc()
    ghost.clientID = 0x9999
    ghost.getMap('elements').set('ghost', 'x')
    const beforeDelete = Y.encodeStateVector(ghost)
    ghost.getMap('elements').delete('ghost')
    const deleteOnly = Y.encodeStateAsUpdate(ghost, beforeDelete)
    ghost.destroy()

    await room.handleMessage(alice, encodeUpdate(deleteOnly))
    expect(alice.closed).toEqual({
      code: CLOSE.invalid,
      reason: 'out-of-order update',
    })
    expect(persisted).toHaveLength(0)

    // The laundering this proves is gone: a later accepted update from
    // a different connection must not carry the parked delete set into
    // the room document, and the element it created must survive.
    await room.handleMessage(
      bob,
      encodeUpdate(
        clientUpdate((elements) => elements.set('r1', elementMap())),
      ),
    )
    expect(persisted).toHaveLength(1)
    expect(doc.getMap('elements').has('r1')).toBe(true)
    expect(doc.store.pendingDs).toBeNull()

    room.destroy()
    doc.destroy()
  })

  it('persists only the bytes an accepted update actually produced, not the whole accumulated delete set', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    const bob = connection('edit')
    room.join(alice)
    room.join(bob)

    // Seed many elements, then delete every other one: the document now
    // carries a large, fragmented delete set.
    const seedCount = 200
    const seed = new Y.Doc()
    Y.applyUpdate(seed, Y.encodeStateAsUpdate(doc))
    const beforeSeed = Y.encodeStateVector(seed)
    for (let i = 0; i < seedCount; i += 1) {
      seed.getMap('elements').set(`r${i}`, elementMap({ id: `r${i}` }))
    }
    await room.handleMessage(
      alice,
      encodeUpdate(Y.encodeStateAsUpdate(seed, beforeSeed)),
    )
    expect(persisted).toHaveLength(1)

    const beforeDeletes = Y.encodeStateVector(seed)
    for (let i = 0; i < seedCount; i += 2) {
      seed.getMap('elements').delete(`r${i}`)
    }
    await room.handleMessage(
      alice,
      encodeUpdate(Y.encodeStateAsUpdate(seed, beforeDeletes)),
    )
    expect(persisted).toHaveLength(2)
    seed.destroy()

    persisted.length = 0
    bob.received.length = 0

    // A single-property edit on a still-surviving element (an odd
    // index, never deleted above), sent as its own small update from a
    // freshly re-synced client.
    const editor = new Y.Doc()
    Y.applyUpdate(editor, Y.encodeStateAsUpdate(doc))
    const beforeEdit = Y.encodeStateVector(editor)
    ;(editor.getMap('elements').get('r1') as Y.Map<unknown>).set('x', 5)
    const editUpdate = Y.encodeStateAsUpdate(editor, beforeEdit)
    editor.destroy()

    await room.handleMessage(alice, encodeUpdate(editUpdate))
    expect(persisted).toHaveLength(1)

    // What a peer actually receives for this same edit: already
    // minimal, since relay is a side effect of the room document's own
    // `update` event, never touched by this fix. The persisted payload
    // must be the same order of magnitude, not the whole document's
    // accumulated delete set glued on.
    const relayed = bob.received
      .map(decodeMessage)
      .find((message) => message.kind === 'sync-update')
    expect(relayed).toBeDefined()
    if (relayed?.kind !== 'sync-update') {
      throw new Error('unreachable')
    }
    const lastPersisted = persisted[0] as Uint8Array
    expect(lastPersisted.byteLength).toBeLessThan(relayed.update.byteLength * 3)

    room.destroy()
    doc.destroy()
  })

  it("calls applied with persist's own seq, only once the room document holds the update", async () => {
    const calls: { seq: number; hadElement: boolean }[] = []
    const { room, doc } = setup({
      // A sentinel unrelated to any counter: proves `applied` is handed
      // exactly what `persist` resolved with, not merely a call count
      // that happens to line up.
      persist: async () => 777,
      applied: async (seq) => {
        calls.push({ seq, hadElement: doc.getMap('elements').has('r1') })
      },
    })
    const alice = connection('edit')
    room.join(alice)

    await room.handleMessage(
      alice,
      encodeUpdate(
        clientUpdate((elements) => elements.set('r1', elementMap())),
      ),
    )
    expect(calls).toEqual([{ seq: 777, hadElement: true }])

    room.destroy()
    doc.destroy()
  })
})
