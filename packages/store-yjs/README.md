# @tlwb/store-yjs

Yjs implementation of the engine's `BoardStore`, with local-first
persistence, real-time synchronization, presence, and image assets.
This is the only package in the monorepo that knows Yjs.

## Composing a board

```ts
import {
  connectBoard,
  createAssetStore,
  createBoardDoc,
  createLocalAwareness,
  createPresence,
  createYjsBoardStore,
  persistBoard,
} from '@tlwb/store-yjs'

const doc = createBoardDoc()
const store = createYjsBoardStore(doc)
const assets = createAssetStore(boardId)

// Local-first: the board lives in IndexedDB before anything else.
const persistence = persistBoard(doc, boardId)
await persistence.whenLoaded

// A shared board syncs and brings its own awareness; an anonymous one
// gets a local awareness and presence with zero peers. Exactly one
// awareness exists either way: a discarded one leaks its heartbeat.
const connection = shareToken
  ? connectBoard(doc, { url, boardId, token: shareToken })
  : null
const awareness = connection?.awareness ?? createLocalAwareness(doc)

const presence = createPresence(awareness, {
  name: 'Alice',
  color: '#FF6B4A',
  isAgent: false,
})
```

`subscribeClose` reports every socket closure with its code (`null` for
a local close). The provider stops reconnecting on `4401`, `4403`, and
`4404`, the codes that mean the link itself is wrong; `reconnect()`
resumes once the caller has fixed the cause. Every other code
reconnects with backoff.

The client never imports `yjs` or `y-protocols`: the document and the
awareness are opaque handles it passes between these primitives and
the engine's `createEditor`.

The store never writes on construction. A client creating a new board
sets its meta itself: `store.setMeta({ name, createdAt: Date.now() })`.

## Tearing a board down

Closing a board releases the awareness heartbeat, the socket, and both
databases.

```ts
presence.destroy()
connection?.destroy()
// The provider unhooks the awareness it created but never destroys it,
// so clearing the heartbeat is the caller's job either way.
awareness.destroy()
await persistence.destroy()
await assets.destroy()
```

To forget a board rather than close it, `persistence.clear()` and
`assets.delete()` remove both databases.

## Document layout

One `Y.Doc` per board: a `Y.Map` named `elements` (element id to a
`Y.Map` with one key per element property) and a `Y.Map` named `meta`
(`name`, `createdAt`). Merge granularity is one property: two people
moving two shapes never conflict; two people editing the same property
resolve as last writer wins, text included.

## Undo

A `Y.UndoManager` tracks only the `'local'` origin, so undo reverts this
client's batches and never another collaborator's, property by
property. Batches from the network, from the IndexedDB load, and from
`importSnapshot` are reported as `'remote'` and stay out of the stack.

## Assets

Image blobs never enter the document. `createAssetStore(boardId)` keys
them by SHA-256 content hash in IndexedDB; an image element carries the
hash. `put` accepts an optional known hash to store under it directly,
skipping recomputation, for content already addressed by that hash (for
example a remote fetch by hash). Upload to the server for hosted boards
is not implemented yet.

## Testing

`pnpm --filter @tlwb/store-yjs test`. Tests run in Node with
`fake-indexeddb`; merge scenarios exchange updates between two `Y.Doc`
instances without a network.
