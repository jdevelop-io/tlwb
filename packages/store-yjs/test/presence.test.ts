import { describe, expect, it } from 'vitest'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createPresence } from '../src/presence'

/** Pushes every awareness state of `from` into `to`, as the provider does. */
function relay(from: Awareness, to: Awareness): void {
  const update = encodeAwarenessUpdate(from, [...from.getStates().keys()])
  applyAwarenessUpdate(to, update, 'test')
}

describe('createPresence', () => {
  it("shows the other side's cursor and selection as a peer", () => {
    const a = new Awareness(new Y.Doc())
    const b = new Awareness(new Y.Doc())
    const alice = createPresence(a, {
      name: 'Alice',
      color: '#FF6B4A',
      isAgent: false,
    })
    const bob = createPresence(b, {
      name: 'Bob',
      color: '#8B7CF6',
      isAgent: true,
    })

    bob.setCursor({ x: 10, y: 20 })
    bob.setSelection(['shape-1'])
    relay(b, a)

    expect(alice.getPeers()).toEqual([
      {
        id: String(b.clientID),
        name: 'Bob',
        color: '#8B7CF6',
        cursor: { x: 10, y: 20 },
        selectedIds: ['shape-1'],
        isAgent: true,
      },
    ])
    expect(bob.getPeers()).toEqual([])

    alice.destroy()
    bob.destroy()
    a.destroy()
    b.destroy()
  })

  it('notifies subscribers when a remote state changes', () => {
    const a = new Awareness(new Y.Doc())
    const b = new Awareness(new Y.Doc())
    const alice = createPresence(a, {
      name: 'Alice',
      color: '#FF6B4A',
      isAgent: false,
    })
    const bob = createPresence(b, {
      name: 'Bob',
      color: '#8B7CF6',
      isAgent: false,
    })
    let calls = 0
    const unsubscribe = alice.subscribe(() => {
      calls += 1
    })

    bob.setCursor({ x: 1, y: 1 })
    relay(b, a)
    expect(calls).toBe(1)

    unsubscribe()
    bob.setCursor({ x: 2, y: 2 })
    relay(b, a)
    expect(calls).toBe(1)

    alice.destroy()
    bob.destroy()
    a.destroy()
    b.destroy()
  })

  it('drops a remote state whose cursor is not a real point', () => {
    const a = new Awareness(new Y.Doc())
    const b = new Awareness(new Y.Doc())
    const alice = createPresence(a, {
      name: 'Alice',
      color: '#FF6B4A',
      isAgent: false,
    })
    // Valid in every other respect: the NaN coordinate alone must be
    // enough for the peer to be dropped.
    b.setLocalState({
      name: 'Bob',
      color: '#8B7CF6',
      selectedIds: [],
      isAgent: false,
      cursor: { x: Number.NaN, y: 0 },
    })
    relay(b, a)

    expect(alice.getPeers()).toEqual([])

    alice.destroy()
    a.destroy()
    b.destroy()
  })

  it('starts with no cursor and an empty selection', () => {
    const a = new Awareness(new Y.Doc())
    const b = new Awareness(new Y.Doc())
    const alice = createPresence(a, {
      name: 'Alice',
      color: '#FF6B4A',
      isAgent: false,
    })
    createPresence(b, { name: 'Bob', color: '#8B7CF6', isAgent: false })
    relay(b, a)

    expect(alice.getPeers()[0]?.cursor).toBeNull()
    expect(alice.getPeers()[0]?.selectedIds).toEqual([])

    alice.destroy()
    a.destroy()
    b.destroy()
  })
})
