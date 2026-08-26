# tlwb Yjs store: design

Date: 2026-08-26
Status: approved
Parent specification: `2026-08-08-tlwb-canvas-engine-realtime-design.md`
(section 5, "Document model and synchronization")

## 1. Scope and goal

This specification covers `packages/store-yjs` in full: the Yjs
implementation of the engine's `BoardStore` interface with undo scoped to
the local collaborator, local-first persistence through y-indexeddb, the
WebSocket synchronization client, the awareness adapter that turns remote
collaborators into the engine's `Peer` type, and the local blob store for
image assets.

After this work, `apps/client` can open a board by identifier, keep it in
IndexedDB, connect it to the collaboration server when the board is
shared, and hand the engine a store and a peer list without touching Yjs.
The collaboration server itself is the next specification; this package
fixes the wire protocol it must speak.

Implementation is planned in two slices: the store with its undo and
merge tests first, then persistence, assets, presence, and the
synchronization client.

## 2. Decisions and rationale

- Text content is a plain string property, last writer wins. The parent
  specification planned a `Y.Text` per text element for fine-grained
  merging. The engine's store contract only ever replaces the whole
  `text` string, so feeding a `Y.Text` would require diffing strings into
  insert and delete operations on every keystroke. Two people typing in
  the same text at the same time is rare on a whiteboard, and the losing
  author keeps their version in their local undo. Amendment to the parent
  specification; revisit if concurrent text editing turns out to matter.
- Stroke points are a plain JSON array, replaced as a whole. A stroke is
  drawn by one hand; a `Y.Array` would only add merge machinery nobody
  needs.
- `y-websocket` is the synchronization client. It ships the y-sync and
  awareness protocols, reconnection with backoff, and a server-side
  helper the collaboration server can reuse or reimplement. Its
  authentication is a query-string parameter, which is exactly what
  link-based access needs. A hand-written client on `y-protocols` or
  Hocuspocus would buy control the project does not need yet.
- Image blobs live in this package, as a small `AssetStore` over
  IndexedDB. They are local-first persistence with the same lifetime as
  the y-indexeddb document, and keeping them here means the client never
  opens IndexedDB itself. HTTP upload for hosted boards comes with the
  server specification.
- The public surface is composable primitives, not a facade. Each
  primitive (`createYjsBoardStore`, `persistBoard`, `connectBoard`,
  `createPresence`, `createAssetStore`) is testable alone; the client
  assembles them. A facade is added only when a second caller appears.
- The store validates nothing. The contract says so, and the parent
  specification places validation at the trust boundaries: the
  collaboration server and the MCP server. A malformed element arriving
  from the network reaches the engine as is; this is a known risk until
  the server specification lands.
- The JSON projection is not reimplemented. The engine's
  `exportSnapshot` and `importSnapshot` work on the `BoardStore`
  interface and therefore on the Yjs store as they are.

## 3. Package and architecture

`packages/store-yjs` (`@tlwb/store-yjs`), same tooling as the engine:
strict TypeScript, Vitest, Biome. Dependencies: `@tlwb/engine` (types
and the shared contract suite), `yjs`, `y-indexeddb`, `y-websocket`,
`y-protocols` (awareness), `idb`. Development dependencies add
`fake-indexeddb`. This is the only package in the monorepo that imports
Yjs.

```
packages/store-yjs/
  src/
    index.ts        public exports
    document.ts     Y.Doc layout: `elements` and `meta` maps, origins, readers
    store.ts        createYjsBoardStore(doc): BoardStore
    undo.ts         Y.UndoManager restricted to the local origin
    persistence.ts  persistBoard(doc, boardId)
    sync.ts         connectBoard(doc, options)
    presence.ts     createPresence(awareness, local)
    assets.ts       createAssetStore(boardId): AssetStore
  test/
    store.test.ts        runs describeBoardStoreContract('yjs', ...)
    merge.test.ts        two-Y.Doc scenarios
    snapshot.test.ts     export and import round-trip through the engine
    persistence.test.ts  fake-indexeddb round-trip
    presence.test.ts     two linked Awareness instances
    assets.test.ts       put and get, content hashing
    sync.test.ts         status derivation over a fake provider
```

Document layout: `doc.getMap('elements')` maps an element id to a
`Y.Map` of that element's properties, one key per property of the
engine's `BoardElement` (`text` as a string, `points` as a plain array,
bindings as plain objects). `doc.getMap('meta')` holds `name` and
`createdAt`; a document that has neither reads as `Untitled` created at
`0`, and the client writes both when it creates a board, because the
store never writes on construction (a load from IndexedDB or the network
may still be pending). Merge granularity is one element property: two
people moving two different shapes never conflict, and two people
editing the same property resolve as last writer wins.

## 4. The store and its undo

### Writing

`applyChanges(changes, origin = 'local')` wraps the batch in
`doc.transact(fn, origin)`. A `create` inserts a new `Y.Map` built from
the element; an `update` calls `set` for each property of the patch; a
`delete` removes the key. An `update` or a `delete` naming an absent id
is ignored without throwing and the rest of the batch still applies, as
the contract requires. `setMeta(patch)` transacts on `meta` with the
`'local'` origin.

### Reading and object identity

The contract requires that repeated reads of an unchanged element return
the very same object and that an update replaces the object rather than
mutating it. The store keeps a `Map<ElementId, BoardElement>` cache and
a lazily rebuilt sorted list. An `observeDeep` handler on `elements`
invalidates the cache: an added or changed `Y.Map` yields a fresh object
from `toJSON()`, a removed key drops its entry, and the sorted list is
rebuilt on the next `listElements()` by sorting on `index`.

ponytail: full O(n log n) sort on every invalidation; switch to an
insertion into the sorted list if boards well past a thousand elements
ever make it measurable.

### Events

The same `observeDeep` handler turns each transaction into exactly one
`'changes'` event: a `create` for every added key, an `update` carrying
only the properties the transaction changed, a `delete` for every removed
key. A transaction on `meta` emits one `'meta'` event. One transaction
means one observer call, which is what gives "one event per batch". A
batch that changes nothing (empty, or naming only absent elements) opens
an empty transaction and emits no event at all; no consumer in the
engine depends on an event for a no-op batch.

Origin mapping, read from the transaction's origin:

- `'local'` or `'remote'` when this store opened the transaction with
  that origin.
- `'undo'` when the transaction came from the store's `UndoManager`.
- `'remote'` for every other transaction: network synchronization, the
  y-indexeddb load, an agent, a foreign `Y.applyUpdate`.

### Undo

One `Y.UndoManager` over `elements` only, matching the in-memory store
where a `setMeta` is not undoable, with
`trackedOrigins: new Set(['local'])` and an infinite `captureTimeout` so
consecutive local batches coalesce until `stopCapturing` closes the
entry. `stopCapturing`, `undo`, `redo`, `canUndo`, `canRedo`, and
`clearHistory` delegate to it. A non-local transaction neither closes nor
joins the current capture, which is the contract's rule and the
`UndoManager`'s native behavior.

Because Yjs undoes at property level, undoing a local move after a
remote collaborator changed another property of the same element leaves
the remote change in place. That is stronger than the contract's
per-batch minimum, and the shared contract suite must keep accepting
both behaviors; if a contract test turns out to pin the weaker one, the
test is relaxed, not the store.

## 5. Persistence, synchronization, presence, assets

### Persistence

`persistBoard(doc, boardId)` mounts
`new IndexeddbPersistence(\`tlwb:board:${boardId}\`, doc)` and returns
`{ whenLoaded: Promise<void>, destroy(): void }`. The client waits for
`whenLoaded` before showing the board. The initial load arrives as a
non-local transaction, so it is reported as `'remote'` and never enters
the undo stack.

### Synchronization

`connectBoard(doc, { url, boardId, token, connect? })` mounts
`new WebsocketProvider(url, boardId, doc, { params: { token }, connect })`
and returns
`{ provider, awareness, getStatus(), subscribeStatus(listener), destroy() }`
with `status: 'connecting' | 'connected' | 'disconnected'` derived from
the provider's `status` events. Reconnection, backoff, and
resynchronization are the provider's. Read-only access is enforced by
the server; on the client, the engine's read-only mode covers the UI.

### Presence

`createPresence(awareness, local: { name, color, isAgent })` publishes
the local state and reads the remote ones:

- `setCursor(point: Point | null)` and `setSelection(ids: ElementId[])`
  update the local awareness state.
- `getPeers(): Peer[]` maps every remote awareness state through the
  engine's `sanitizePeers`, which drops malformed entries. A peer's `id`
  is its awareness `clientID` as a string.
- `subscribe(listener)` fires on any awareness change and returns an
  unsubscribe function.
- `destroy()` clears the local state.

An anonymous board has no provider; the client creates a bare
`new Awareness(doc)` and presence runs with zero peers.

### Assets

`createAssetStore(boardId)` opens an `idb` database
`tlwb:assets:${boardId}` with one object store `blobs` keyed by content
hash.

- `put(blob: Blob): Promise<string>` hashes the content with SHA-256
  through `crypto.subtle`, stores the bytes and the MIME type (an
  `ArrayBuffer` clones identically in every IndexedDB implementation, a
  `Blob` does not), returns the hex hash. The same content always yields
  the same hash and one stored record.
- `get(hash: string): Promise<Blob | undefined>` rebuilds the `Blob`
  from the stored bytes and type.
- `destroy()` closes the database.

The client builds the engine's `ImageResolver` on top of it. There is no
garbage collection of orphaned blobs; post-v1.

## 6. JSON projection

The engine's `exportSnapshot(store)` and `importSnapshot(store, snapshot)`
run unchanged against the Yjs store. `importSnapshot` deletes every
element, creates the snapshot's elements in one `'remote'` batch, sets
the meta, and clears the history, all through the store interface. A
round-trip test pins it.

## 7. Error handling

- Malformed element from the network: not validated here (section 2).
  The engine receives it as is.
- IndexedDB unavailable (private browsing, quota): `whenLoaded` rejects
  and `put` rejects. The client decides what to show; the in-memory
  document keeps working.
- Network loss: `status` becomes `'disconnected'`, the provider retries
  with backoff, local editing continues, and y-indexeddb guarantees the
  edits survive a reload.

## 8. Testing

Vitest in a Node environment; `fake-indexeddb` for persistence and
assets. Classical TDD.

- Shared contract: `describeBoardStoreContract('yjs', () =>
  createYjsBoardStore(new Y.Doc()))`.
- Two-`Y.Doc` merges without networking, exchanged through
  `Y.encodeStateAsUpdate` and `Y.applyUpdate`: two clients move two
  different shapes and both survive; two clients set the same property
  and the last writer wins; A applies five changes offline while B
  applies three, then both converge to the same element list; A undoes
  after B wrote and only A's change is reverted.
- Events: a remote transaction emits `'remote'` with only the changed
  properties; the identity of an untouched element survives a remote
  update of another element.
- Persistence: write, destroy, reopen the same `boardId`, `whenLoaded`,
  identical content.
- Presence: two `Awareness` instances linked by hand; a cursor set on one
  side appears on the other; a malformed remote state is dropped.
- Assets: `put` then `get` returns the blob; the same blob twice yields
  the same hash.
- Synchronization: one test deriving `status` from a fake provider. Real
  connections are integration-tested with the server in its own
  specification.

## 9. Success criteria

- The Yjs store passes the shared contract suite unmodified.
- The merge scenarios converge and undo never reverts another
  collaborator's change.
- A board written through `persistBoard` reloads identically in a fresh
  document.
- `apps/client` can be wired from the exported primitives without
  importing Yjs.

## 10. Out of scope

The collaboration server and its read-only enforcement, HTTP upload of
assets for hosted boards, blob garbage collection, `Y.Text` for
concurrent text editing, validation of incoming elements, and any
facade over the primitives.
