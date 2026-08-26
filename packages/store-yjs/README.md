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

// Anonymous board: presence with zero peers.
let awareness = createLocalAwareness(doc)

// Shared board: the provider brings its own awareness.
if (shareToken) {
  const connection = connectBoard(doc, { url, boardId, token: shareToken })
  awareness = connection.awareness
}

const presence = createPresence(awareness, {
  name: 'Alice',
  color: '#FF6B4A',
  isAgent: false,
})
```

The client never imports `yjs` or `y-protocols`: the document and the
awareness are opaque handles it passes between these primitives and
the engine's `createEditor`.

The store never writes on construction. A client creating a new board
sets its meta itself: `store.setMeta({ name, createdAt: Date.now() })`.

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
hash. Upload to the server for hosted boards is not implemented yet.

## Testing

`pnpm --filter @tlwb/store-yjs test`. Tests run in Node with
`fake-indexeddb`; merge scenarios exchange updates between two `Y.Doc`
instances without a network.
