# tlwb Yjs Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/store-yjs`: the Yjs implementation of the
engine's `BoardStore` with undo scoped to the local collaborator,
y-indexeddb persistence, the y-websocket synchronization client, the
awareness adapter that yields the engine's `Peer[]`, and a local
IndexedDB blob store for image assets.

**Architecture:** One `Y.Doc` per board with a `Y.Map` named `elements`
(element id to a `Y.Map` of properties) and a `Y.Map` named `meta`. The
store writes inside `doc.transact(fn, origin)` and derives every store
event from a single `observeDeep` handler, so local writes, network
updates, the IndexedDB load, and undo all flow through the same path. A
`Y.UndoManager` restricted to the `'local'` origin gives per-collaborator
undo. Persistence, synchronization, presence, and assets are separate
primitives the client composes; there is no facade.

**Tech Stack:** TypeScript (strict), Vitest, `yjs`, `y-indexeddb`,
`y-websocket`, `y-protocols`, `idb`; `fake-indexeddb` in tests.

**Spec:** `.claude/superpowers/specs/2026-08-26-tlwb-store-yjs-design.md`

## Global Constraints

- License: MIT, copyright JDevelop.
- All file content, code, comments, and commit messages in English.
- Commits: gitmoji + Conventional Commits (`<emoji> <type>(<scope>): <summary>`), scope `store-yjs`.
- TDD is mandatory: every behavior lands red first, then green.
- Node.js >= 22, pnpm 11, `"type": "module"` (ESM only), TypeScript `strict` plus `noUncheckedIndexedAccess` (inherited from `tsconfig.base.json`).
- `packages/store-yjs` runtime dependencies are exactly `@tlwb/engine` (workspace), `yjs`, `y-indexeddb`, `y-websocket`, `y-protocols`, `idb`. Dev dependencies are exactly `fake-indexeddb`, `typescript`, `vitest`. Nothing else, no React, no jsdom.
- `packages/engine` is not modified by this plan; the repository root `README.md` gains one list entry.
- This is the only package that imports Yjs. Nothing under `packages/engine` or a future `apps/client` may import `yjs`, `y-*`, or `idb`; the package exports `createBoardDoc()` and `createLocalAwareness(doc)` so the client never needs to.
- The store validates nothing (contract). Elements arriving from the network reach the engine as they are.
- Tests run in Node: `fake-indexeddb/auto` is loaded from `test/setup.ts`; no browser globals other than `indexedDB`, `Blob`, `crypto.subtle` (all present in Node 22).
- Every `Awareness`, `IndexeddbPersistence`, and `WebsocketProvider` created in a test is destroyed at the end of that test (they hold timers).
- Style: Biome (`pnpm check` must pass), single quotes, no semicolons, two-space indent, 80 columns.
- All commands run from the repository root.

---

## File Structure

Created:

- `packages/store-yjs/package.json`: manifest, scripts `test` and `typecheck`.
- `packages/store-yjs/tsconfig.json`: extends the base, includes `src`, `test`, `vitest.config.ts`.
- `packages/store-yjs/vitest.config.ts`: `test/**/*.test.ts`, setup file.
- `packages/store-yjs/test/setup.ts`: loads `fake-indexeddb/auto`.
- `packages/store-yjs/src/document.ts`: `Y.Doc` layout, origins, element to `Y.Map` and back, `deepFreeze`.
- `packages/store-yjs/src/store.ts`: `createYjsBoardStore(doc): BoardStore`.
- `packages/store-yjs/src/undo.ts`: `createUndoManager(elements)` wrapper over `Y.UndoManager`.
- `packages/store-yjs/src/persistence.ts`: `persistBoard(doc, boardId)`.
- `packages/store-yjs/src/assets.ts`: `createAssetStore(boardId)`.
- `packages/store-yjs/src/presence.ts`: `createPresence(awareness, local)`.
- `packages/store-yjs/src/sync.ts`: `connectBoard(doc, options)`.
- `packages/store-yjs/src/index.ts`: public exports.
- `packages/store-yjs/README.md`: how the client composes the primitives.
- `packages/store-yjs/test/store.test.ts`, `merge.test.ts`, `snapshot.test.ts`, `persistence.test.ts`, `assets.test.ts`, `presence.test.ts`, `sync.test.ts`.

Modified:

- `README.md` (repository root): add the package to the list.

Slice 1 is Tasks 1 to 3 (store, undo, merge scenarios). Slice 2 is Tasks
4 to 8 (persistence, assets, presence, synchronization, verification).

---

### Task 1: Package scaffold and the store without undo

**Files:**
- Create: `packages/store-yjs/package.json`
- Create: `packages/store-yjs/tsconfig.json`
- Create: `packages/store-yjs/vitest.config.ts`
- Create: `packages/store-yjs/test/setup.ts`
- Create: `packages/store-yjs/src/document.ts`
- Create: `packages/store-yjs/src/store.ts`
- Create: `packages/store-yjs/src/index.ts`
- Test: `packages/store-yjs/test/store.test.ts`

**Interfaces:**
- Consumes from `@tlwb/engine`: `BoardStore`, `BoardChange`, `BoardMeta`, `BoardStoreEvent`, `ChangeOrigin`, `BoardElement`, `ElementId`, `ElementProps`, `createElement`, `sortByIndex`.
- Produces: `createYjsBoardStore(doc: Y.Doc): BoardStore` (undo methods are inert until Task 2); `document.ts` exports `createBoardDoc(): Y.Doc`, `LOCAL_ORIGIN`, `REMOTE_ORIGIN`, `getElementsMap(doc)`, `getMetaMap(doc)`, `elementToMap(element)`, `readElement(map)`, `deepFreeze(value)`, and the types `ElementMap = Y.Map<unknown>`, `ElementsMap = Y.Map<ElementMap>`.

- [ ] **Step 1: Create the package files**

`packages/store-yjs/package.json`:

```json
{
  "name": "@tlwb/store-yjs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tlwb/engine": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

`packages/store-yjs/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "vitest.config.ts"]
}
```

`packages/store-yjs/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
})
```

`packages/store-yjs/test/setup.ts`:

```ts
// Persistence and assets run against IndexedDB; Node has none, so the
// in-memory implementation registers the globals for every test file.
import 'fake-indexeddb/auto'
```

`packages/store-yjs/src/index.ts`:

```ts
export { createBoardDoc } from './document'
export { createYjsBoardStore } from './store'
```

Then install the runtime and development dependencies (pnpm resolves
the current versions; do not hand-write version numbers):

Run: `pnpm --filter @tlwb/store-yjs add yjs y-indexeddb y-websocket y-protocols idb && pnpm --filter @tlwb/store-yjs add -D fake-indexeddb`

Expected: `packages/store-yjs/package.json` lists the six runtime and
three development dependencies from the Global Constraints, and
`pnpm-lock.yaml` is updated.

- [ ] **Step 2: Write the failing tests**

`packages/store-yjs/test/store.test.ts`:

```ts
import type { BoardStoreEvent, LineElement } from '@tlwb/engine'
import { createElement } from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createYjsBoardStore } from '../src/store'

type ChangesEvent = Extract<BoardStoreEvent, { kind: 'changes' }>

function expectChangesEvent(event: BoardStoreEvent | undefined): ChangesEvent {
  if (event?.kind !== 'changes') {
    throw new Error(`expected a 'changes' event, got ${event?.kind ?? 'none'}`)
  }
  return event
}

describe('createYjsBoardStore', () => {
  it('writes a created element into the elements map', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const element = createElement('rectangle', { index: 'a0', x: 5 })
    store.applyChanges([{ kind: 'create', element }])
    const map = doc.getMap<Y.Map<unknown>>('elements').get(element.id)
    expect(map?.get('x')).toBe(5)
    expect(map?.get('type')).toBe('rectangle')
  })

  it('reads an element written directly into the document', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const element = createElement('ellipse', { index: 'a0', y: 7 })
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>('elements')
        .set(element.id, new Y.Map(Object.entries(element)))
    })
    expect(store.getElement(element.id)).toEqual(element)
    expect(store.listElements()).toEqual([element])
  })

  it('reports a foreign transaction as a remote batch with only the changed props', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const element = createElement('rectangle', { index: 'a0', x: 5 })
    store.applyChanges([{ kind: 'create', element }])
    const events: BoardStoreEvent[] = []
    store.subscribe((event) => events.push(event))
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>('elements').get(element.id)?.set('x', 42)
    })
    expect(events).toHaveLength(1)
    const event = expectChangesEvent(events[0])
    expect(event.origin).toBe('remote')
    expect(event.changes).toEqual([
      { kind: 'update', id: element.id, props: { x: 42 } },
    ])
    expect(store.getElement(element.id)?.x).toBe(42)
  })

  it('keeps the identity of an element another one\'s remote update did not touch', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    store.applyChanges([
      { kind: 'create', element: a },
      { kind: 'create', element: b },
    ])
    const aBefore = store.getElement(a.id)
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>('elements').get(b.id)?.set('x', 1)
    })
    expect(store.getElement(a.id)).toBe(aBefore)
    expect(store.getElement(b.id)?.x).toBe(1)
  })

  it('freezes elements read back from the document', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const element = createElement('line', {
      index: 'a0',
      points: [{ x: 0, y: 0 }],
    })
    doc.transact(() => {
      doc
        .getMap<Y.Map<unknown>>('elements')
        .set(element.id, new Y.Map(Object.entries(element)))
    })
    const read = store.getElement(element.id) as LineElement
    expect(Object.isFrozen(read)).toBe(true)
    expect(Object.isFrozen(read.points[0])).toBe(true)
  })

  it('emits no event for a batch that changes nothing', () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const events: BoardStoreEvent[] = []
    store.subscribe((event) => events.push(event))
    store.applyChanges([])
    store.applyChanges([{ kind: 'update', id: 'missing', props: { x: 1 } }])
    expect(events).toHaveLength(0)
  })

  it('reads default meta from an empty document', () => {
    const store = createYjsBoardStore(new Y.Doc())
    expect(store.getMeta()).toEqual({ name: 'Untitled', createdAt: 0 })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/store-yjs test`

Expected: FAIL, `Cannot find module '../src/store'`.

- [ ] **Step 4: Implement the document layout and the store**

`packages/store-yjs/src/document.ts`:

```ts
import type { BoardElement } from '@tlwb/engine'
import * as Y from 'yjs'

/** Transaction origin of a batch this client authored and can undo. */
export const LOCAL_ORIGIN = 'local'
/** Transaction origin of a batch applied on behalf of someone else. */
export const REMOTE_ORIGIN = 'remote'

/** One element: a Y.Map with one key per BoardElement property. */
export type ElementMap = Y.Map<unknown>
/** The board: element id to its ElementMap. */
export type ElementsMap = Y.Map<ElementMap>

/** A fresh, empty board document. Exported so callers never import yjs. */
export function createBoardDoc(): Y.Doc {
  return new Y.Doc()
}

export function getElementsMap(doc: Y.Doc): ElementsMap {
  return doc.getMap<ElementMap>('elements')
}

export function getMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>('meta')
}

export function elementToMap(element: BoardElement): ElementMap {
  return new Y.Map(Object.entries(element))
}

/**
 * Rebuilds a frozen BoardElement from its map. Nothing is validated:
 * the store contract leaves that to the trust boundaries (server, MCP).
 */
export function readElement(map: ElementMap): BoardElement {
  return deepFreeze(map.toJSON() as BoardElement)
}

/**
 * Same contract as the engine's in-memory store: freezes a value and
 * everything reachable from it so callers cannot mutate stored state.
 * Duplicated rather than exported from the engine, which withholds its
 * own helpers from the public API.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const nested of Object.values(value)) {
    deepFreeze(nested)
  }
  return value
}
```

`packages/store-yjs/src/store.ts`:

```ts
import type {
  BoardChange,
  BoardElement,
  BoardMeta,
  BoardStore,
  BoardStoreEvent,
  ChangeOrigin,
  ElementId,
  ElementProps,
} from '@tlwb/engine'
import { sortByIndex } from '@tlwb/engine'
import type * as Y from 'yjs'
import {
  type ElementMap,
  deepFreeze,
  elementToMap,
  getElementsMap,
  getMetaMap,
  LOCAL_ORIGIN,
  readElement,
  REMOTE_ORIGIN,
} from './document'

const DEFAULT_META: BoardMeta = { name: 'Untitled', createdAt: 0 }

/**
 * BoardStore over a Y.Doc. Every event, whatever wrote the document
 * (this store, the network, IndexedDB, undo), is derived from the
 * document's own observers, so a batch that changes nothing emits
 * nothing.
 */
export function createYjsBoardStore(doc: Y.Doc): BoardStore {
  const elements = getElementsMap(doc)
  const meta = getMetaMap(doc)
  const cache = new Map<ElementId, BoardElement>()
  let sorted: BoardElement[] | null = null
  const listeners = new Set<(event: BoardStoreEvent) => void>()

  for (const [id, map] of elements) {
    cache.set(id, readElement(map))
  }

  function emit(event: BoardStoreEvent): void {
    for (const listener of listeners) {
      listener(event)
    }
  }

  function originOf(transaction: Y.Transaction): ChangeOrigin {
    const origin: unknown = transaction.origin
    if (origin === LOCAL_ORIGIN || origin === REMOTE_ORIGIN) {
      return origin
    }
    return REMOTE_ORIGIN
  }

  elements.observeDeep((events, transaction) => {
    const changes: BoardChange[] = []
    for (const event of events) {
      if (event.target === elements) {
        for (const [id, change] of event.changes.keys) {
          if (change.action === 'delete') {
            cache.delete(id)
            changes.push({ kind: 'delete', id })
          } else {
            const map = elements.get(id)
            if (map) {
              const element = readElement(map)
              cache.set(id, element)
              changes.push({ kind: 'create', element })
            }
          }
        }
      } else {
        const id = String(event.path[0])
        const map = event.target as ElementMap
        const props: Record<string, unknown> = {}
        for (const key of event.keysChanged) {
          props[key] = map.get(key)
        }
        cache.set(id, readElement(map))
        changes.push({ kind: 'update', id, props: props as ElementProps })
      }
    }
    sorted = null
    emit({ kind: 'changes', changes, origin: originOf(transaction) })
  })

  function getMeta(): BoardMeta {
    return {
      name: (meta.get('name') as string | undefined) ?? DEFAULT_META.name,
      createdAt:
        (meta.get('createdAt') as number | undefined) ?? DEFAULT_META.createdAt,
    }
  }

  meta.observe(() => {
    emit({ kind: 'meta', meta: getMeta() })
  })

  function applyOne(change: BoardChange): void {
    switch (change.kind) {
      case 'create':
        elements.set(change.element.id, elementToMap(deepFreeze(change.element)))
        break
      case 'update': {
        const map = elements.get(change.id)
        if (map) {
          for (const [key, value] of Object.entries(change.props)) {
            map.set(key, value)
          }
        }
        break
      }
      case 'delete':
        elements.delete(change.id)
        break
    }
  }

  return {
    getElement: (id) => cache.get(id),
    listElements() {
      if (!sorted) {
        sorted = sortByIndex([...cache.values()])
      }
      return sorted
    },
    getMeta,
    setMeta(patch) {
      doc.transact(() => {
        for (const [key, value] of Object.entries(patch)) {
          meta.set(key, value)
        }
      }, LOCAL_ORIGIN)
    },
    applyChanges(changes, origin = LOCAL_ORIGIN) {
      doc.transact(() => {
        for (const change of changes) {
          applyOne(change)
        }
      }, origin)
    },
    stopCapturing() {},
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    undo() {},
    redo() {},
    canUndo: () => false,
    canRedo: () => false,
    clearHistory() {},
  }
}
```

Note for the implementer: `listElements()` returns the cached sorted
array itself, not a copy. The contract test "does not expose its
internal element state" checks that elements are frozen, not that the
array is; the engine never mutates the returned array. If the contract
suite in Task 2 fails on this point, return `[...sorted]` instead.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/store-yjs test && pnpm --filter @tlwb/store-yjs typecheck && pnpm check`

Expected: 7 tests PASS, typecheck clean, Biome clean. If Biome
reorganizes imports, run `pnpm check:write` and keep the result.

- [ ] **Step 6: Commit**

```bash
git add packages/store-yjs pnpm-lock.yaml
git commit -m "✨ feat(store-yjs): add the Yjs board store over the engine contract"
```

---

### Task 2: Undo by origin and the shared contract suite

**Files:**
- Create: `packages/store-yjs/src/undo.ts`
- Modify: `packages/store-yjs/src/store.ts`
- Test: `packages/store-yjs/test/store.test.ts`

**Interfaces:**
- Consumes: `createYjsBoardStore` from Task 1, `describeBoardStoreContract(name, createStore)` from `@tlwb/engine/testing`.
- Produces: `createUndoManager(elements: ElementsMap): Y.UndoManager` in `undo.ts`; the store's `stopCapturing`, `undo`, `redo`, `canUndo`, `canRedo`, `clearHistory` become real and `originOf` reports `'undo'` for the manager's transactions.

- [ ] **Step 1: Add the contract suite to the test file**

Append to `packages/store-yjs/test/store.test.ts` (imports at the top,
the call at the bottom):

```ts
import { describeBoardStoreContract } from '@tlwb/engine/testing'

describeBoardStoreContract('yjs', () => createYjsBoardStore(new Y.Doc()))
```

- [ ] **Step 2: Run the tests to verify the undo tests fail**

Run: `pnpm --filter @tlwb/store-yjs test`

Expected: the contract tests about undo, redo, coalescing,
`stopCapturing`, and `clearHistory` FAIL (`canUndo` returns `false`);
the read, write, event, and identity contract tests PASS.

- [ ] **Step 3: Implement the undo manager and wire it**

`packages/store-yjs/src/undo.ts`:

```ts
import * as Y from 'yjs'
import { type ElementsMap, LOCAL_ORIGIN } from './document'

/**
 * Undo restricted to what this client wrote. Only the elements map is
 * in scope: like the in-memory store, a meta change is not undoable.
 * The infinite capture timeout makes consecutive local batches coalesce
 * into one entry until stopCapturing closes it, which is the store
 * contract's rule for gestures.
 */
export function createUndoManager(elements: ElementsMap): Y.UndoManager {
  return new Y.UndoManager(elements, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: Number.POSITIVE_INFINITY,
  })
}
```

In `packages/store-yjs/src/store.ts`:

1. Add `import { createUndoManager } from './undo'`.
2. After `const meta = getMetaMap(doc)`, add
   `const undoManager = createUndoManager(elements)`.
3. In `originOf`, before the final `return REMOTE_ORIGIN`, add:

```ts
    if (origin === undoManager) {
      return 'undo'
    }
```

4. Replace the six inert methods in the returned object with:

```ts
    stopCapturing() {
      undoManager.stopCapturing()
    },
    undo() {
      undoManager.stopCapturing()
      undoManager.undo()
    },
    redo() {
      undoManager.stopCapturing()
      undoManager.redo()
    },
    canUndo: () => undoManager.canUndo(),
    canRedo: () => undoManager.canRedo(),
    clearHistory() {
      undoManager.stopCapturing()
      undoManager.clear()
    },
```

Why `stopCapturing()` before `undo()` and `redo()`: the contract says
undo, redo, and clearHistory close the capture; `Y.UndoManager` closes
it on undo but not on redo, so the wrapper does it uniformly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/store-yjs test && pnpm --filter @tlwb/store-yjs typecheck && pnpm check`

Expected: all contract tests and the 7 store tests PASS.

If "does not create an undo entry for a batch that inverts to nothing"
fails because `Y.UndoManager` pushed an entry for an empty transaction,
the cause is an `update` on a missing id still opening a transaction
with changed types; check that `applyOne` skips the `map.set` loop when
`elements.get(id)` is undefined. If "undoes an update by restoring the
prior property values" fails, check that `captureTimeout` is
`Number.POSITIVE_INFINITY` and not `0` (with `0` nothing ever
coalesces and the two transactions become two entries, which still
passes this test but breaks "coalesces consecutive local batches").

- [ ] **Step 5: Commit**

```bash
git add packages/store-yjs
git commit -m "✨ feat(store-yjs): undo only the local collaborator's batches"
```

---

### Task 3: Two-document merge scenarios and snapshot round-trip

**Files:**
- Test: `packages/store-yjs/test/merge.test.ts`
- Test: `packages/store-yjs/test/snapshot.test.ts`

**Interfaces:**
- Consumes: `createYjsBoardStore` (Tasks 1 and 2); `exportSnapshot`, `importSnapshot`, `parseSnapshot` from `@tlwb/engine`.
- Produces: nothing new; this task pins the convergence and undo-by-origin guarantees the client and the server specification rely on.

- [ ] **Step 1: Write the merge tests**

`packages/store-yjs/test/merge.test.ts`:

```ts
import type { BoardStore } from '@tlwb/engine'
import { createElement } from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createYjsBoardStore } from '../src/store'

/** Two collaborators on the same board with no network in between. */
function pair(): { a: Peer; b: Peer } {
  const a = peer()
  const b = peer()
  sync(a, b)
  return { a, b }
}

interface Peer {
  doc: Y.Doc
  store: BoardStore
}

function peer(): Peer {
  const doc = new Y.Doc()
  return { doc, store: createYjsBoardStore(doc) }
}

/** Exchanges the full state both ways, as a reconnection would. */
function sync(a: Peer, b: Peer): void {
  const fromA = Y.encodeStateAsUpdate(a.doc)
  const fromB = Y.encodeStateAsUpdate(b.doc)
  Y.applyUpdate(b.doc, fromA)
  Y.applyUpdate(a.doc, fromB)
}

function ids(store: BoardStore): string[] {
  return store.listElements().map((element) => element.id)
}

describe('two collaborators', () => {
  it('keeps both moves when each moves a different shape', () => {
    const { a, b } = pair()
    const left = createElement('rectangle', { index: 'a0', x: 0 })
    const right = createElement('rectangle', { index: 'a1', x: 100 })
    a.store.applyChanges([
      { kind: 'create', element: left },
      { kind: 'create', element: right },
    ])
    sync(a, b)

    a.store.applyChanges([{ kind: 'update', id: left.id, props: { x: 10 } }])
    b.store.applyChanges([{ kind: 'update', id: right.id, props: { x: 110 } }])
    sync(a, b)

    for (const store of [a.store, b.store]) {
      expect(store.getElement(left.id)?.x).toBe(10)
      expect(store.getElement(right.id)?.x).toBe(110)
    }
  })

  it('converges on the same value when both set the same property', () => {
    const { a, b } = pair()
    const shape = createElement('rectangle', { index: 'a0', x: 0 })
    a.store.applyChanges([{ kind: 'create', element: shape }])
    sync(a, b)

    a.store.applyChanges([{ kind: 'update', id: shape.id, props: { x: 1 } }])
    b.store.applyChanges([{ kind: 'update', id: shape.id, props: { x: 2 } }])
    sync(a, b)

    const fromA = a.store.getElement(shape.id)?.x
    const fromB = b.store.getElement(shape.id)?.x
    expect(fromA).toBe(fromB)
    expect([1, 2]).toContain(fromA)
  })

  it('converges after both edited offline', () => {
    const { a, b } = pair()
    for (let i = 0; i < 5; i += 1) {
      a.store.applyChanges([
        { kind: 'create', element: createElement('rectangle', { index: `a${i}` }) },
      ])
    }
    for (let i = 0; i < 3; i += 1) {
      b.store.applyChanges([
        { kind: 'create', element: createElement('ellipse', { index: `b${i}` }) },
      ])
    }
    sync(a, b)

    expect(ids(a.store)).toHaveLength(8)
    expect(ids(a.store)).toEqual(ids(b.store))
    expect(a.store.listElements()).toEqual(b.store.listElements())
  })

  it('reports the other collaborator\'s edits as remote and never undoes them', () => {
    const { a, b } = pair()
    const mine = createElement('rectangle', { index: 'a0' })
    a.store.applyChanges([{ kind: 'create', element: mine }])
    sync(a, b)

    const origins: string[] = []
    a.store.subscribe((event) => {
      if (event.kind === 'changes') origins.push(event.origin)
    })
    const theirs = createElement('ellipse', { index: 'a1' })
    b.store.applyChanges([{ kind: 'create', element: theirs }])
    sync(a, b)
    expect(origins).toEqual(['remote'])

    a.store.undo()
    expect(a.store.getElement(mine.id)).toBeUndefined()
    expect(a.store.getElement(theirs.id)).toBeDefined()
    expect(a.store.canUndo()).toBe(false)
  })

  it('undoes only the local property when both touched the same element', () => {
    const { a, b } = pair()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      fillColor: null,
    })
    a.store.applyChanges([{ kind: 'create', element: shape }])
    a.store.stopCapturing()
    sync(a, b)

    a.store.applyChanges([{ kind: 'update', id: shape.id, props: { x: 50 } }])
    b.store.applyChanges([
      { kind: 'update', id: shape.id, props: { fillColor: '#FFD166' } },
    ])
    sync(a, b)

    a.store.undo()
    sync(a, b)

    for (const store of [a.store, b.store]) {
      expect(store.getElement(shape.id)?.x).toBe(0)
      expect(store.getElement(shape.id)?.fillColor).toBe('#FFD166')
    }
  })
})
```

- [ ] **Step 2: Write the snapshot round-trip test**

`packages/store-yjs/test/snapshot.test.ts`:

```ts
import {
  createElement,
  exportSnapshot,
  importSnapshot,
  parseSnapshot,
} from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createYjsBoardStore } from '../src/store'

describe('JSON projection through the Yjs store', () => {
  it('exports, parses, and re-imports the same board', () => {
    const source = createYjsBoardStore(new Y.Doc())
    source.setMeta({ name: 'payments', createdAt: 1_700_000_000_000 })
    source.applyChanges([
      { kind: 'create', element: createElement('rectangle', { index: 'a0' }) },
      {
        kind: 'create',
        element: createElement('text', { index: 'a1', text: 'hello' }),
      },
    ])

    const json = JSON.parse(JSON.stringify(exportSnapshot(source)))
    const snapshot = parseSnapshot(json)

    const target = createYjsBoardStore(new Y.Doc())
    target.applyChanges([
      { kind: 'create', element: createElement('ellipse', { index: 'a0' }) },
    ])
    importSnapshot(target, snapshot)

    expect(exportSnapshot(target)).toEqual(exportSnapshot(source))
    expect(target.canUndo()).toBe(false)
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @tlwb/store-yjs test`

Expected: all PASS. These tests pin behavior the store already has; a
failure here is a real defect in Task 1 or 2, not a missing feature.
The most likely failure is the fourth merge test reporting origins
`['remote', 'remote']`: `Y.applyUpdate` with nothing new still opens a
transaction, but Yjs does not call observers for a transaction that
changed nothing, so two events mean `sync` is applying a real change
twice; check that `pair()` synchronizes once before the subscription.

- [ ] **Step 4: Commit**

```bash
git add packages/store-yjs/test/merge.test.ts packages/store-yjs/test/snapshot.test.ts
git commit -m "✅ test(store-yjs): pin convergence, undo by origin, and the JSON round-trip"
```

---

### Task 4: Local-first persistence

**Files:**
- Create: `packages/store-yjs/src/persistence.ts`
- Modify: `packages/store-yjs/src/index.ts`
- Test: `packages/store-yjs/test/persistence.test.ts`

**Interfaces:**
- Consumes: `createYjsBoardStore` (Task 1), `IndexeddbPersistence` from `y-indexeddb`.
- Produces: `persistBoard(doc: Y.Doc, boardId: string): BoardPersistence` with `interface BoardPersistence { whenLoaded: Promise<void>; destroy(): Promise<void> }`.

- [ ] **Step 1: Write the failing tests**

`packages/store-yjs/test/persistence.test.ts`:

```ts
import type { BoardStoreEvent } from '@tlwb/engine'
import { createElement } from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { persistBoard } from '../src/persistence'
import { createYjsBoardStore } from '../src/store'

describe('persistBoard', () => {
  it('reloads a board written by a previous document', async () => {
    const boardId = 'persist-reload'
    const first = new Y.Doc()
    const firstStore = createYjsBoardStore(first)
    const persistence = persistBoard(first, boardId)
    await persistence.whenLoaded
    const element = createElement('rectangle', { index: 'a0', x: 5 })
    firstStore.applyChanges([{ kind: 'create', element }])
    firstStore.setMeta({ name: 'kept' })
    await persistence.destroy()

    const second = new Y.Doc()
    const secondStore = createYjsBoardStore(second)
    const events: BoardStoreEvent[] = []
    secondStore.subscribe((event) => events.push(event))
    const reopened = persistBoard(second, boardId)
    await reopened.whenLoaded

    expect(secondStore.getElement(element.id)).toEqual(element)
    expect(secondStore.getMeta().name).toBe('kept')
    expect(events.some((e) => e.kind === 'changes' && e.origin === 'remote')).toBe(true)
    expect(secondStore.canUndo()).toBe(false)
    await reopened.destroy()
  })

  it('keeps boards apart by identifier', async () => {
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const persistence = persistBoard(doc, 'persist-a')
    await persistence.whenLoaded
    store.applyChanges([
      { kind: 'create', element: createElement('rectangle', { index: 'a0' }) },
    ])
    await persistence.destroy()

    const other = new Y.Doc()
    const otherStore = createYjsBoardStore(other)
    const otherPersistence = persistBoard(other, 'persist-b')
    await otherPersistence.whenLoaded
    expect(otherStore.listElements()).toEqual([])
    await otherPersistence.destroy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/store-yjs test test/persistence.test.ts`

Expected: FAIL, `Cannot find module '../src/persistence'`.

- [ ] **Step 3: Implement persistence**

`packages/store-yjs/src/persistence.ts`:

```ts
import { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'

export interface BoardPersistence {
  /** Resolves once the stored updates have been applied to the doc. */
  whenLoaded: Promise<void>
  /** Stops mirroring the doc and closes the database. */
  destroy(): Promise<void>
}

/**
 * Mirrors the doc into IndexedDB under a per-board database. The load
 * applies stored updates as a foreign transaction, so the store reports
 * it as 'remote' and it never enters the undo stack.
 */
export function persistBoard(doc: Y.Doc, boardId: string): BoardPersistence {
  const persistence = new IndexeddbPersistence(`tlwb:board:${boardId}`, doc)
  return {
    whenLoaded: persistence.whenSynced.then(() => undefined),
    destroy: () => persistence.destroy(),
  }
}
```

Add to `packages/store-yjs/src/index.ts`:

```ts
export type { BoardPersistence } from './persistence'
export { persistBoard } from './persistence'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/store-yjs test && pnpm --filter @tlwb/store-yjs typecheck && pnpm check`

Expected: PASS. If the first test fails with an empty second store, the
write was still in flight when `destroy()` closed the database; in that
case await one macrotask before `destroy()` in the test
(`await new Promise((resolve) => setTimeout(resolve, 0))`) and record
that y-indexeddb does not flush on destroy in the README's persistence
section (Task 7).

- [ ] **Step 5: Commit**

```bash
git add packages/store-yjs
git commit -m "✨ feat(store-yjs): persist a board in IndexedDB through y-indexeddb"
```

---

### Task 5: Local asset store

**Files:**
- Create: `packages/store-yjs/src/assets.ts`
- Modify: `packages/store-yjs/src/index.ts`
- Test: `packages/store-yjs/test/assets.test.ts`

**Interfaces:**
- Consumes: `openDB` from `idb`; `crypto.subtle`, `Blob` (Node 22 globals).
- Produces: `createAssetStore(boardId: string): AssetStore` with `interface AssetStore { put(blob: Blob): Promise<string>; get(hash: string): Promise<Blob | undefined>; destroy(): Promise<void> }`.

- [ ] **Step 1: Write the failing tests**

`packages/store-yjs/test/assets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createAssetStore } from '../src/assets'

describe('createAssetStore', () => {
  it('stores a blob under its content hash and returns it', async () => {
    const assets = createAssetStore('assets-roundtrip')
    const blob = new Blob(['hello'], { type: 'text/plain' })
    const hash = await assets.put(blob)
    expect(hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
    const stored = await assets.get(hash)
    expect(stored?.type).toBe('text/plain')
    expect(await stored?.text()).toBe('hello')
    await assets.destroy()
  })

  it('returns undefined for an unknown hash', async () => {
    const assets = createAssetStore('assets-unknown')
    expect(await assets.get('missing')).toBeUndefined()
    await assets.destroy()
  })

  it('gives the same hash to the same content', async () => {
    const assets = createAssetStore('assets-dedupe')
    const first = await assets.put(new Blob(['same'], { type: 'image/png' }))
    const second = await assets.put(new Blob(['same'], { type: 'image/png' }))
    expect(second).toBe(first)
    await assets.destroy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/store-yjs test test/assets.test.ts`

Expected: FAIL, `Cannot find module '../src/assets'`.

- [ ] **Step 3: Implement the asset store**

`packages/store-yjs/src/assets.ts`:

```ts
import { type DBSchema, openDB } from 'idb'

export interface AssetStore {
  /** Stores the blob and returns its SHA-256 content hash (hex). */
  put(blob: Blob): Promise<string>
  get(hash: string): Promise<Blob | undefined>
  destroy(): Promise<void>
}

interface AssetSchema extends DBSchema {
  blobs: {
    key: string
    // Bytes and type rather than the Blob itself: an ArrayBuffer clones
    // identically in every IndexedDB implementation, a Blob does not.
    value: { type: string; bytes: ArrayBuffer }
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * Image blobs for one board, keyed by content hash, in IndexedDB. The
 * engine's image elements reference the hash; the client resolves it
 * through `get`. No garbage collection of orphaned blobs.
 */
export function createAssetStore(boardId: string): AssetStore {
  const db = openDB<AssetSchema>(`tlwb:assets:${boardId}`, 1, {
    upgrade(database) {
      database.createObjectStore('blobs')
    },
  })
  return {
    async put(blob) {
      const bytes = await blob.arrayBuffer()
      const hash = await sha256Hex(bytes)
      await (await db).put('blobs', { type: blob.type, bytes }, hash)
      return hash
    },
    async get(hash) {
      const record = await (await db).get('blobs', hash)
      return record ? new Blob([record.bytes], { type: record.type }) : undefined
    },
    async destroy() {
      ;(await db).close()
    },
  }
}
```

Add to `packages/store-yjs/src/index.ts`:

```ts
export type { AssetStore } from './assets'
export { createAssetStore } from './assets'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/store-yjs test && pnpm --filter @tlwb/store-yjs typecheck && pnpm check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/store-yjs
git commit -m "✨ feat(store-yjs): store image blobs by content hash in IndexedDB"
```

---

### Task 6: Presence over awareness

**Files:**
- Create: `packages/store-yjs/src/presence.ts`
- Modify: `packages/store-yjs/src/index.ts`
- Test: `packages/store-yjs/test/presence.test.ts`

**Interfaces:**
- Consumes: `Awareness`, `encodeAwarenessUpdate`, `applyAwarenessUpdate` from `y-protocols/awareness`; `Peer`, `sanitizePeers`, `Point`, `ElementId` from `@tlwb/engine`.
- Produces: `createLocalAwareness(doc: Y.Doc): Awareness` (a bare awareness for a board with no connection) and `createPresence(awareness: Awareness, local: LocalPresence): Presence` with `interface LocalPresence { name: string; color: string; isAgent: boolean }` and `interface Presence { setCursor(cursor: Point | null): void; setSelection(ids: ElementId[]): void; getPeers(): Peer[]; subscribe(listener: () => void): () => void; destroy(): void }`.

- [ ] **Step 1: Write the failing tests**

`packages/store-yjs/test/presence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  applyAwarenessUpdate,
  Awareness,
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
  it('shows the other side\'s cursor and selection as a peer', () => {
    const a = new Awareness(new Y.Doc())
    const b = new Awareness(new Y.Doc())
    const alice = createPresence(a, { name: 'Alice', color: '#FF6B4A', isAgent: false })
    const bob = createPresence(b, { name: 'Bob', color: '#8B7CF6', isAgent: true })

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
    const alice = createPresence(a, { name: 'Alice', color: '#FF6B4A', isAgent: false })
    const bob = createPresence(b, { name: 'Bob', color: '#8B7CF6', isAgent: false })
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

  it('drops a malformed remote state', () => {
    const a = new Awareness(new Y.Doc())
    const b = new Awareness(new Y.Doc())
    const alice = createPresence(a, { name: 'Alice', color: '#FF6B4A', isAgent: false })
    b.setLocalState({ name: 'Broken', cursor: { x: Number.NaN, y: 0 } })
    relay(b, a)

    expect(alice.getPeers()).toEqual([])

    alice.destroy()
    a.destroy()
    b.destroy()
  })

  it('starts with no cursor and an empty selection', () => {
    const a = new Awareness(new Y.Doc())
    const b = new Awareness(new Y.Doc())
    const alice = createPresence(a, { name: 'Alice', color: '#FF6B4A', isAgent: false })
    createPresence(b, { name: 'Bob', color: '#8B7CF6', isAgent: false })
    relay(b, a)

    expect(alice.getPeers()[0]?.cursor).toBeNull()
    expect(alice.getPeers()[0]?.selectedIds).toEqual([])

    alice.destroy()
    a.destroy()
    b.destroy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/store-yjs test test/presence.test.ts`

Expected: FAIL, `Cannot find module '../src/presence'`.

- [ ] **Step 3: Implement presence**

`packages/store-yjs/src/presence.ts`:

```ts
import type { ElementId, Peer, Point } from '@tlwb/engine'
import { sanitizePeers } from '@tlwb/engine'
import { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

export interface LocalPresence {
  name: string
  color: string
  isAgent: boolean
}

export interface Presence {
  setCursor(cursor: Point | null): void
  setSelection(ids: ElementId[]): void
  /** Every other well-formed collaborator; malformed states are dropped. */
  getPeers(): Peer[]
  /** Fires on any awareness change, local or remote. */
  subscribe(listener: () => void): () => void
  destroy(): void
}

/**
 * Awareness for a board with no connection: presence runs with zero
 * peers. A connected board uses its provider's awareness instead.
 */
export function createLocalAwareness(doc: Y.Doc): Awareness {
  return new Awareness(doc)
}

/**
 * Publishes this client on the awareness protocol and reads the others
 * back as the engine's Peer type. Ephemeral by construction: nothing
 * here touches the document.
 */
export function createPresence(
  awareness: Awareness,
  local: LocalPresence,
): Presence {
  awareness.setLocalState({ ...local, cursor: null, selectedIds: [] })

  return {
    setCursor(cursor) {
      awareness.setLocalStateField('cursor', cursor)
    },
    setSelection(ids) {
      awareness.setLocalStateField('selectedIds', ids)
    },
    getPeers() {
      const states: unknown[] = []
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId !== awareness.clientID && state) {
          states.push({ ...state, id: String(clientId) })
        }
      }
      return sanitizePeers(states)
    },
    subscribe(listener) {
      awareness.on('change', listener)
      return () => awareness.off('change', listener)
    },
    destroy() {
      awareness.setLocalState(null)
    },
  }
}
```

Add to `packages/store-yjs/src/index.ts`:

```ts
export type { LocalPresence, Presence } from './presence'
export { createLocalAwareness, createPresence } from './presence'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/store-yjs test && pnpm --filter @tlwb/store-yjs typecheck && pnpm check`

Expected: PASS. The subscription listens to `'change'`, which awareness
fires only when a state actually differs; `'update'` would also fire on
periodic renewals of an unchanged state, so keep `'change'`. If
"notifies subscribers" counts 2 calls, the listener was registered on
the awareness whose local state the test mutates: the test subscribes
on `alice` and mutates `bob`, so only the relay may fire.

- [ ] **Step 5: Commit**

```bash
git add packages/store-yjs
git commit -m "✨ feat(store-yjs): publish and read presence over awareness"
```

---

### Task 7: Synchronization client, public exports, and documentation

**Files:**
- Create: `packages/store-yjs/src/sync.ts`
- Modify: `packages/store-yjs/src/index.ts`
- Create: `packages/store-yjs/README.md`
- Modify: `README.md` (repository root, the package list near line 10)
- Test: `packages/store-yjs/test/sync.test.ts`

**Interfaces:**
- Consumes: `WebsocketProvider` from `y-websocket`.
- Produces: `connectBoard(doc: Y.Doc, options: ConnectOptions): BoardConnection` with `interface ConnectOptions { url: string; boardId: string; token: string; connect?: boolean }`, `type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'`, and `interface BoardConnection { provider: WebsocketProvider; awareness: Awareness; getStatus(): ConnectionStatus; subscribeStatus(listener: (status: ConnectionStatus) => void): () => void; destroy(): void }`.

- [ ] **Step 1: Write the failing test**

`packages/store-yjs/test/sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { connectBoard } from '../src/sync'

describe('connectBoard', () => {
  it('derives the status from the provider and passes the token', () => {
    const connection = connectBoard(new Y.Doc(), {
      url: 'ws://localhost:1',
      boardId: 'board-1',
      token: 'secret',
      connect: false,
    })
    const seen: string[] = []
    const unsubscribe = connection.subscribeStatus((status) => seen.push(status))

    expect(connection.getStatus()).toBe('disconnected')
    expect(connection.provider.url).toContain('token=secret')
    expect(connection.provider.roomname).toBe('board-1')

    connection.provider.emit('status', [{ status: 'connecting' }])
    connection.provider.emit('status', [{ status: 'connected' }])
    expect(connection.getStatus()).toBe('connected')
    expect(seen).toEqual(['connecting', 'connected'])

    unsubscribe()
    connection.provider.emit('status', [{ status: 'disconnected' }])
    expect(connection.getStatus()).toBe('disconnected')
    expect(seen).toEqual(['connecting', 'connected'])

    connection.destroy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/store-yjs test test/sync.test.ts`

Expected: FAIL, `Cannot find module '../src/sync'`.

- [ ] **Step 3: Implement the connection**

`packages/store-yjs/src/sync.ts`:

```ts
import type { Awareness } from 'y-protocols/awareness'
import { WebsocketProvider } from 'y-websocket'
import type * as Y from 'yjs'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface ConnectOptions {
  /** Collaboration server, for example `wss://collab.tlwb.app`. */
  url: string
  boardId: string
  /** Link token; the server enforces read-only or edit from it. */
  token: string
  /** Defaults to true. False mounts the provider without dialing. */
  connect?: boolean
}

export interface BoardConnection {
  provider: WebsocketProvider
  awareness: Awareness
  getStatus(): ConnectionStatus
  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void
  destroy(): void
}

/**
 * Thin wrapper over y-websocket: reconnection with backoff, the y-sync
 * and awareness protocols, and resynchronization after a gap are the
 * provider's. Local editing never waits on the connection.
 */
export function connectBoard(
  doc: Y.Doc,
  options: ConnectOptions,
): BoardConnection {
  const connect = options.connect ?? true
  const provider = new WebsocketProvider(options.url, options.boardId, doc, {
    params: { token: options.token },
    connect,
  })
  let status: ConnectionStatus = connect ? 'connecting' : 'disconnected'
  const listeners = new Set<(status: ConnectionStatus) => void>()

  provider.on('status', (event: { status: ConnectionStatus }) => {
    status = event.status
    for (const listener of listeners) {
      listener(status)
    }
  })

  return {
    provider,
    awareness: provider.awareness,
    getStatus: () => status,
    subscribeStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    destroy() {
      listeners.clear()
      provider.destroy()
    },
  }
}
```

Replace `packages/store-yjs/src/index.ts` with the full export list:

```ts
export type { AssetStore } from './assets'
export { createAssetStore } from './assets'
export type { BoardPersistence } from './persistence'
export { persistBoard } from './persistence'
export { createBoardDoc } from './document'
export type { LocalPresence, Presence } from './presence'
export { createLocalAwareness, createPresence } from './presence'
export { createYjsBoardStore } from './store'
export type {
  BoardConnection,
  ConnectionStatus,
  ConnectOptions,
} from './sync'
export { connectBoard } from './sync'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/store-yjs test && pnpm --filter @tlwb/store-yjs typecheck && pnpm check`

Expected: PASS. If the typecheck rejects `provider.on('status', ...)`
because the provider's event map types the handler argument
differently, match the provider's declared type instead of the inline
`{ status: ConnectionStatus }` and cast at the assignment to `status`.
If the test hangs after completion, `destroy()` did not clear the
provider's check interval: confirm `connection.destroy()` is reached
and that `provider.destroy()` is called, not only `disconnect()`.

- [ ] **Step 5: Write the package README and list the package at the root**

`packages/store-yjs/README.md`:

````markdown
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
````

In the repository root `README.md`, find the package list that starts
with `- \`packages/engine\`:` (around line 10) and add after that entry:

```markdown
- `packages/store-yjs`: Yjs implementation of the engine's store,
  local-first persistence, synchronization client, presence, and image
  assets. The only package that imports Yjs.
```

- [ ] **Step 6: Commit**

```bash
git add packages/store-yjs README.md
git commit -m "✨ feat(store-yjs): connect a board over y-websocket and publish the package API"
```

---

### Task 8: Verification

**Files:** none created; read-only checks plus any fix they call for.

- [ ] **Step 1: Run the full workspace verification**

Run: `pnpm install --frozen-lockfile && pnpm check && pnpm typecheck && pnpm test`

Expected: every command exits 0; the engine suite and the store-yjs
suite both pass; Biome reports no diagnostics.

- [ ] **Step 2: Check the Yjs boundary**

Run: `grep -rlE "from '(yjs|y-[a-z]+|y-protocols/[a-z]+|idb)'" packages/engine/src packages/engine/test || echo "engine is Yjs-free"`

Expected: `engine is Yjs-free`.

- [ ] **Step 3: Check the dependency lists against the Global Constraints**

Run: `node -e "const p=require('./packages/store-yjs/package.json');console.log(Object.keys(p.dependencies).sort().join(' '));console.log(Object.keys(p.devDependencies).sort().join(' '))"`

Expected:

```
@tlwb/engine idb y-indexeddb y-protocols y-websocket yjs
fake-indexeddb typescript vitest
```

- [ ] **Step 4: Fix and commit anything the checks surfaced**

If a step above failed, fix it in the file it names and rerun the
step. Commit with a message naming the fix, for example:

```bash
git commit -am "🐛 fix(store-yjs): <what was wrong>"
```

If nothing failed, there is nothing to commit; the plan is complete.
