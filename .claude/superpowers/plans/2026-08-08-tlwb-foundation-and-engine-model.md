# tlwb Foundation and Engine Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the tlwb pnpm monorepo and build the engine's data
layer: the board element model, fractional z-ordering, the store
interface with an in-memory implementation locked by a contract test
suite, per-origin undo/redo, and the versioned JSON snapshot format.

**Architecture:** First plan of the canvas engine series defined by
`.claude/superpowers/specs/2026-08-08-tlwb-canvas-engine-realtime-design.md`.
Everything here lives in `packages/engine`: pure TypeScript, no
framework, no network, no rendering yet. The store interface plus its
contract suite is the boundary every later plan builds on (rendering and
tools consume the store; `store-yjs` must pass the same contract).

**Tech Stack:** pnpm workspaces, TypeScript (strict), Vitest,
`fractional-indexing` (MIT), `zod` (MIT).

## Global Constraints

- License: MIT, copyright JDevelop. The repository carries a LICENSE file.
- All file content, code, comments, and commit messages in English.
- Commits: gitmoji + Conventional Commits (`<emoji> <type>(<scope>): <summary>`).
- TDD is mandatory: every behavior lands red first, then green.
- Node.js >= 22, pnpm >= 10, `"type": "module"` (ESM only), TypeScript `strict` plus `noUncheckedIndexedAccess`.
- `packages/engine` runtime dependencies are limited to `fractional-indexing` and `zod`. No React, no Yjs, no network code in the engine.
- Default stroke color is the Foundations ink token `#1A1A1A`.
- Package name: `@tlwb/engine`. Import paths inside the package are relative with `.js` extension omitted (bundler resolution).

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `LICENSE`
- Create: `README.md`
- Modify: `.gitignore`
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/vitest.config.ts`
- Create: `packages/engine/src/index.ts`
- Test: `packages/engine/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a working workspace where `pnpm test` and `pnpm typecheck`
  run in every package. Later tasks add files under
  `packages/engine/src/` and export them from `packages/engine/src/index.ts`.

- [ ] **Step 1: Create the workspace files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json` (repository root):

```json
{
  "name": "tlwb",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

`LICENSE`: the standard MIT license text with the line
`Copyright (c) 2026 JDevelop`.

`README.md`:

```markdown
# tlwb

The little whiteboard: instant, collaborative, agent-friendly.

Monorepo packages:

- `packages/engine`: framework-agnostic whiteboard engine (scene model,
  rendering, tools).

Requires Node.js >= 22 and pnpm >= 10. Run `pnpm install`, then
`pnpm test`.
```

Append to `.gitignore` (keep the existing `.superpowers/` line):

```
node_modules/
dist/
coverage/
```

- [ ] **Step 2: Create the engine package**

`packages/engine/package.json`:

```json
{
  "name": "@tlwb/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "vitest.config.ts"]
}
```

`packages/engine/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
```

`packages/engine/src/index.ts`:

```ts
export const ENGINE_NAME = '@tlwb/engine'
```

`packages/engine/test/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ENGINE_NAME } from '../src/index'

describe('engine package', () => {
  it('is wired into the workspace', () => {
    expect(ENGINE_NAME).toBe('@tlwb/engine')
  })
})
```

- [ ] **Step 3: Install and verify**

Run from the repository root:

```bash
pnpm install
pnpm add -D typescript vitest --filter @tlwb/engine
pnpm test
pnpm typecheck
```

Expected: install succeeds, the smoke test passes (1 passed), typecheck
reports no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "🎉 chore: scaffold pnpm workspace and engine package"
```

---

### Task 2: Board element model and factory

**Files:**
- Create: `packages/engine/src/model/element.ts`
- Create: `packages/engine/src/model/create.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/model/create.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `BoardElement` union and its variants, `ElementId`,
  `Point`, `ElementProps`, and
  `createElement(type: ElementType, options: { index: string } & ElementProps & { id?: ElementId }): BoardElement`.
  Every later task manipulates these exact types.

- [ ] **Step 1: Write the model types**

`packages/engine/src/model/element.ts`:

```ts
export type ElementId = string

export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'draw'
  | 'text'
  | 'image'

export type StrokeStyle = 'solid' | 'dashed'

export interface Point {
  x: number
  y: number
}

export interface ElementBase {
  id: ElementId
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  angle: number
  strokeColor: string
  fillColor: string | null
  strokeWidth: number
  strokeStyle: StrokeStyle
  sketchiness: number
  opacity: number
  seed: number
  index: string
  groupId: string | null
}

export interface RectangleElement extends ElementBase {
  type: 'rectangle'
}

export interface EllipseElement extends ElementBase {
  type: 'ellipse'
}

export interface DiamondElement extends ElementBase {
  type: 'diamond'
}

export interface LineElement extends ElementBase {
  type: 'line'
  points: Point[]
}

export interface ArrowBinding {
  elementId: ElementId
}

export interface ArrowElement extends ElementBase {
  type: 'arrow'
  points: Point[]
  startBinding: ArrowBinding | null
  endBinding: ArrowBinding | null
}

export interface DrawElement extends ElementBase {
  type: 'draw'
  points: Point[]
}

export type TextAlign = 'left' | 'center' | 'right'
export type FontFamily = 'hand' | 'ui'

export interface TextElement extends ElementBase {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: FontFamily
  textAlign: TextAlign
  containerId: ElementId | null
}

export interface ImageElement extends ElementBase {
  type: 'image'
  assetHash: string
}

export type BoardElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | LineElement
  | ArrowElement
  | DrawElement
  | TextElement
  | ImageElement

/**
 * Writable properties across all variants, used by update changes and
 * by the createElement factory overrides. `id` and `type` are never
 * updatable.
 */
export type ElementProps = Partial<Omit<ElementBase, 'id' | 'type'>> &
  Partial<Pick<LineElement, 'points'>> &
  Partial<Pick<ArrowElement, 'startBinding' | 'endBinding'>> &
  Partial<
    Pick<TextElement, 'text' | 'fontSize' | 'fontFamily' | 'textAlign' | 'containerId'>
  > &
  Partial<Pick<ImageElement, 'assetHash'>>
```

- [ ] **Step 2: Write the failing factory test**

`packages/engine/test/model/create.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'

describe('createElement', () => {
  it('creates a rectangle with base defaults', () => {
    const element = createElement('rectangle', { index: 'a0' })
    expect(element.type).toBe('rectangle')
    expect(element.x).toBe(0)
    expect(element.y).toBe(0)
    expect(element.strokeColor).toBe('#1A1A1A')
    expect(element.fillColor).toBeNull()
    expect(element.strokeWidth).toBe(2)
    expect(element.strokeStyle).toBe('solid')
    expect(element.sketchiness).toBe(1)
    expect(element.opacity).toBe(1)
    expect(element.angle).toBe(0)
    expect(element.groupId).toBeNull()
    expect(element.index).toBe('a0')
    expect(typeof element.seed).toBe('number')
    expect(element.id).not.toHaveLength(0)
  })

  it('applies overrides on top of defaults', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 10,
      y: 20,
      width: 120,
      height: 80,
    })
    expect(element.x).toBe(10)
    expect(element.width).toBe(120)
  })

  it('creates a text element with handwriting defaults', () => {
    const element = createElement('text', { index: 'a0', text: 'hello' })
    if (element.type !== 'text') throw new Error('expected a text element')
    expect(element.text).toBe('hello')
    expect(element.fontSize).toBe(20)
    expect(element.fontFamily).toBe('hand')
    expect(element.textAlign).toBe('left')
    expect(element.containerId).toBeNull()
  })

  it('creates an arrow with empty points and no bindings', () => {
    const element = createElement('arrow', { index: 'a0' })
    if (element.type !== 'arrow') throw new Error('expected an arrow element')
    expect(element.points).toEqual([])
    expect(element.startBinding).toBeNull()
    expect(element.endBinding).toBeNull()
  })

  it('gives each element a unique id', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    expect(a.id).not.toBe(b.id)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, `create.ts` does not exist.

- [ ] **Step 4: Implement the factory**

`packages/engine/src/model/create.ts`:

```ts
import type { BoardElement, ElementId, ElementProps, ElementType } from './element'

const variantDefaults: Record<ElementType, Record<string, unknown>> = {
  rectangle: {},
  ellipse: {},
  diamond: {},
  line: { points: [] },
  arrow: { points: [], startBinding: null, endBinding: null },
  draw: { points: [] },
  text: {
    text: '',
    fontSize: 20,
    fontFamily: 'hand',
    textAlign: 'left',
    containerId: null,
  },
  image: { assetHash: '' },
}

export function createElement(
  type: ElementType,
  options: { index: string; id?: ElementId } & ElementProps,
): BoardElement {
  const { id, index, ...overrides } = options
  return {
    id: id ?? crypto.randomUUID(),
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: '#1A1A1A',
    fillColor: null,
    strokeWidth: 2,
    strokeStyle: 'solid',
    sketchiness: 1,
    opacity: 1,
    seed: Math.floor(Math.random() * 2 ** 31),
    index,
    groupId: null,
    ...variantDefaults[type],
    ...overrides,
  } as BoardElement
}
```

- [ ] **Step 5: Export from the package index**

Replace `packages/engine/src/index.ts` with:

```ts
export * from './model/element'
export { createElement } from './model/create'
```

(The `ENGINE_NAME` export and the smoke test are superseded: delete
`packages/engine/test/smoke.test.ts`.)

- [ ] **Step 6: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @tlwb/engine test && pnpm --filter @tlwb/engine typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/engine
git commit -m "✨ feat(engine): add board element model and factory"
```

---

### Task 3: Fractional z-order utilities

**Files:**
- Create: `packages/engine/src/model/ordering.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/model/ordering.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `firstIndex(): string`,
  `indexAfter(index: string | null): string`,
  `indexBetween(a: string | null, b: string | null): string`,
  `sortByIndex<T extends { index: string }>(items: readonly T[]): T[]`.
  The store (Task 4) returns elements sorted with `sortByIndex`; tools in
  later plans create elements with `indexAfter(lastIndex)`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm add fractional-indexing --filter @tlwb/engine
```

- [ ] **Step 2: Write the failing test**

`packages/engine/test/model/ordering.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  firstIndex,
  indexAfter,
  indexBetween,
  sortByIndex,
} from '../../src/model/ordering'

describe('fractional ordering', () => {
  it('generates a first index', () => {
    expect(firstIndex().length).toBeGreaterThan(0)
  })

  it('generates increasing indexes with indexAfter', () => {
    const a = firstIndex()
    const b = indexAfter(a)
    const c = indexAfter(b)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  it('generates an index strictly between two indexes', () => {
    const a = firstIndex()
    const b = indexAfter(a)
    const mid = indexBetween(a, b)
    expect(a < mid).toBe(true)
    expect(mid < b).toBe(true)
  })

  it('keeps order stable across repeated midpoint insertions', () => {
    let low = firstIndex()
    const high = indexAfter(low)
    const generated = [low, high]
    for (let i = 0; i < 50; i++) {
      const mid = indexBetween(low, high)
      generated.push(mid)
      low = mid
    }
    const sorted = [...generated].sort()
    expect(sorted).toEqual([...generated].sort())
    expect(new Set(generated).size).toBe(generated.length)
  })

  it('sorts items by index without mutating the input', () => {
    const items = [{ index: 'a2' }, { index: 'a0' }, { index: 'a1' }]
    const sorted = sortByIndex(items)
    expect(sorted.map((item) => item.index)).toEqual(['a0', 'a1', 'a2'])
    expect(items[0]?.index).toBe('a2')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, `ordering.ts` does not exist.

- [ ] **Step 4: Implement the utilities**

`packages/engine/src/model/ordering.ts`:

```ts
import { generateKeyBetween } from 'fractional-indexing'

export function firstIndex(): string {
  return generateKeyBetween(null, null)
}

export function indexAfter(index: string | null): string {
  return generateKeyBetween(index, null)
}

export function indexBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b)
}

export function sortByIndex<T extends { index: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) =>
    a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
  )
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { firstIndex, indexAfter, indexBetween, sortByIndex } from './model/ordering'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "✨ feat(engine): add fractional z-order utilities"
```

---

### Task 4: Store interface, contract suite, and in-memory store

**Files:**
- Create: `packages/engine/src/store/types.ts`
- Create: `packages/engine/src/store/contract.ts`
- Create: `packages/engine/src/store/memory.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/store/memory.test.ts`

**Interfaces:**
- Consumes: `BoardElement`, `ElementId`, `ElementProps` (Task 2),
  `sortByIndex` (Task 3).
- Produces: the `BoardStore` interface, `BoardChange`, `ChangeOrigin`,
  `BoardStoreEvent`, `BoardMeta`, the `InMemoryBoardStore` class, and
  `describeBoardStoreContract(name: string, createStore: () => BoardStore): void`.
  The rendering and tools plans consume `BoardStore`; the `store-yjs`
  plan runs `describeBoardStoreContract` against its own implementation.

- [ ] **Step 1: Write the store types**

`packages/engine/src/store/types.ts`:

```ts
import type { BoardElement, ElementId, ElementProps } from '../model/element'

export interface BoardMeta {
  name: string
  createdAt: number
}

export type BoardChange =
  | { kind: 'create'; element: BoardElement }
  | { kind: 'update'; id: ElementId; props: ElementProps }
  | { kind: 'delete'; id: ElementId }

/**
 * Where a batch of changes came from. 'local' batches are undoable by
 * this client; 'remote' batches (other collaborators, agents, imports)
 * are not; 'undo' marks batches emitted by undo/redo themselves.
 */
export type ChangeOrigin = 'local' | 'remote' | 'undo'

export interface BoardStoreEvent {
  changes: BoardChange[]
  origin: ChangeOrigin
}

export interface BoardStore {
  getElement(id: ElementId): BoardElement | undefined
  /** All elements, sorted by fractional index (back to front). */
  listElements(): BoardElement[]
  getMeta(): BoardMeta
  setMeta(patch: Partial<BoardMeta>): void
  /** Applies the batch atomically and emits exactly one event. */
  applyChanges(changes: BoardChange[], origin?: ChangeOrigin): void
  subscribe(listener: (event: BoardStoreEvent) => void): () => void
}
```

- [ ] **Step 2: Write the failing contract suite**

`packages/engine/src/store/contract.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../model/create'
import type { BoardStore, BoardStoreEvent } from './types'

/**
 * Behavioral contract every BoardStore implementation must satisfy.
 * Call it from a test file with a factory for the implementation.
 */
export function describeBoardStoreContract(
  name: string,
  createStore: () => BoardStore,
): void {
  describe(`BoardStore contract: ${name}`, () => {
    it('creates and reads an element', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])
      expect(store.getElement(element.id)).toEqual(element)
    })

    it('lists elements sorted by fractional index', () => {
      const store = createStore()
      const back = createElement('rectangle', { index: 'a0' })
      const front = createElement('rectangle', { index: 'a2' })
      const middle = createElement('rectangle', { index: 'a1' })
      store.applyChanges([
        { kind: 'create', element: front },
        { kind: 'create', element: back },
        { kind: 'create', element: middle },
      ])
      expect(store.listElements().map((el) => el.id)).toEqual([
        back.id,
        middle.id,
        front.id,
      ])
    })

    it('merges update props into an existing element', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])
      store.applyChanges([
        { kind: 'update', id: element.id, props: { x: 42, opacity: 0.5 } },
      ])
      const updated = store.getElement(element.id)
      expect(updated?.x).toBe(42)
      expect(updated?.opacity).toBe(0.5)
      expect(updated?.width).toBe(element.width)
    })

    it('deletes an element', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }])
      store.applyChanges([{ kind: 'delete', id: element.id }])
      expect(store.getElement(element.id)).toBeUndefined()
      expect(store.listElements()).toEqual([])
    })

    it('emits exactly one event per batch, with origin local by default', () => {
      const store = createStore()
      const events: BoardStoreEvent[] = []
      store.subscribe((event) => events.push(event))
      const a = createElement('rectangle', { index: 'a0' })
      const b = createElement('ellipse', { index: 'a1' })
      store.applyChanges([
        { kind: 'create', element: a },
        { kind: 'create', element: b },
      ])
      expect(events).toHaveLength(1)
      expect(events[0]?.origin).toBe('local')
      expect(events[0]?.changes).toHaveLength(2)
    })

    it('propagates the given origin to the event', () => {
      const store = createStore()
      const events: BoardStoreEvent[] = []
      store.subscribe((event) => events.push(event))
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }], 'remote')
      expect(events[0]?.origin).toBe('remote')
    })

    it('stops notifying after unsubscribe', () => {
      const store = createStore()
      const events: BoardStoreEvent[] = []
      const unsubscribe = store.subscribe((event) => events.push(event))
      unsubscribe()
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }])
      expect(events).toHaveLength(0)
    })

    it('updates board meta with a partial patch', () => {
      const store = createStore()
      store.setMeta({ name: 'payments architecture' })
      expect(store.getMeta().name).toBe('payments architecture')
      expect(typeof store.getMeta().createdAt).toBe('number')
    })
  })
}
```

`packages/engine/test/store/memory.test.ts`:

```ts
import { describeBoardStoreContract } from '../../src/store/contract'
import { InMemoryBoardStore } from '../../src/store/memory'

describeBoardStoreContract('InMemoryBoardStore', () => new InMemoryBoardStore())
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, `memory.ts` does not exist.

- [ ] **Step 4: Implement the in-memory store**

`packages/engine/src/store/memory.ts`:

```ts
import type { BoardElement, ElementId } from '../model/element'
import { sortByIndex } from '../model/ordering'
import type {
  BoardChange,
  BoardMeta,
  BoardStore,
  BoardStoreEvent,
  ChangeOrigin,
} from './types'

export class InMemoryBoardStore implements BoardStore {
  private elements = new Map<ElementId, BoardElement>()
  private meta: BoardMeta = { name: 'Untitled', createdAt: Date.now() }
  private listeners = new Set<(event: BoardStoreEvent) => void>()

  getElement(id: ElementId): BoardElement | undefined {
    return this.elements.get(id)
  }

  listElements(): BoardElement[] {
    return sortByIndex([...this.elements.values()])
  }

  getMeta(): BoardMeta {
    return { ...this.meta }
  }

  setMeta(patch: Partial<BoardMeta>): void {
    this.meta = { ...this.meta, ...patch }
  }

  applyChanges(changes: BoardChange[], origin: ChangeOrigin = 'local'): void {
    for (const change of changes) {
      this.applyOne(change)
    }
    this.emit({ changes, origin })
  }

  subscribe(listener: (event: BoardStoreEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  protected applyOne(change: BoardChange): void {
    switch (change.kind) {
      case 'create':
        this.elements.set(change.element.id, change.element)
        break
      case 'update': {
        const element = this.elements.get(change.id)
        if (element) {
          this.elements.set(change.id, {
            ...element,
            ...change.props,
          } as BoardElement)
        }
        break
      }
      case 'delete':
        this.elements.delete(change.id)
        break
    }
  }

  protected emit(event: BoardStoreEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type {
  BoardChange,
  BoardMeta,
  BoardStore,
  BoardStoreEvent,
  ChangeOrigin,
} from './store/types'
export { InMemoryBoardStore } from './store/memory'
```

The contract suite imports vitest, so it must never be exported from the
package index (that would drag vitest into production consumers).
Instead, expose it as a dedicated subpath: in
`packages/engine/package.json`, replace the `exports` field with:

```json
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/store/contract.ts"
  }
```

Test files inside the engine import it relatively (as the test above
does); the future `store-yjs` package imports
`describeBoardStoreContract` from `@tlwb/engine/testing`.

- [ ] **Step 5: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @tlwb/engine test && pnpm --filter @tlwb/engine typecheck`
Expected: all contract tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "✨ feat(engine): add board store interface, contract suite, and in-memory store"
```

---

### Task 5: Per-origin undo and redo

**Files:**
- Modify: `packages/engine/src/store/types.ts`
- Modify: `packages/engine/src/store/contract.ts`
- Modify: `packages/engine/src/store/memory.ts`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: four new `BoardStore` methods every implementation must
  provide: `undo(): void`, `redo(): void`, `canUndo(): boolean`,
  `canRedo(): boolean`. Only batches applied with origin `'local'` are
  undoable, which is how a collaborator (human or agent) only ever
  reverts their own actions.

- [ ] **Step 1: Extend the interface**

Add to the `BoardStore` interface in
`packages/engine/src/store/types.ts`:

```ts
  /** Reverts the newest local batch. No-op when nothing is undoable. */
  undo(): void
  /** Re-applies the newest undone batch. No-op when nothing is redoable. */
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
```

- [ ] **Step 2: Write the failing contract cases**

Append inside the `describe` block of `describeBoardStoreContract` in
`packages/engine/src/store/contract.ts`:

```ts
    it('undoes the newest local batch and emits an undo event', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])
      const events: BoardStoreEvent[] = []
      store.subscribe((event) => events.push(event))
      expect(store.canUndo()).toBe(true)
      store.undo()
      expect(store.getElement(element.id)).toBeUndefined()
      expect(events[0]?.origin).toBe('undo')
    })

    it('undoes an update by restoring the prior property values', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 5 })
      store.applyChanges([{ kind: 'create', element }])
      store.applyChanges([
        { kind: 'update', id: element.id, props: { x: 42 } },
      ])
      store.undo()
      expect(store.getElement(element.id)?.x).toBe(5)
    })

    it('redoes an undone batch', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element }])
      store.undo()
      expect(store.canRedo()).toBe(true)
      store.redo()
      expect(store.getElement(element.id)).toBeDefined()
      expect(store.canRedo()).toBe(false)
    })

    it('does not undo remote batches', () => {
      const store = createStore()
      const local = createElement('rectangle', { index: 'a0' })
      const remote = createElement('ellipse', { index: 'a1' })
      store.applyChanges([{ kind: 'create', element: local }])
      store.applyChanges([{ kind: 'create', element: remote }], 'remote')
      store.undo()
      expect(store.getElement(local.id)).toBeUndefined()
      expect(store.getElement(remote.id)).toBeDefined()
      expect(store.canUndo()).toBe(false)
    })

    it('clears the redo stack on a new local batch', () => {
      const store = createStore()
      const first = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element: first }])
      store.undo()
      const second = createElement('ellipse', { index: 'a1' })
      store.applyChanges([{ kind: 'create', element: second }])
      expect(store.canRedo()).toBe(false)
    })

    it('is a no-op to undo or redo with empty stacks', () => {
      const store = createStore()
      expect(store.canUndo()).toBe(false)
      expect(store.canRedo()).toBe(false)
      store.undo()
      store.redo()
      expect(store.listElements()).toEqual([])
    })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, the new methods do not exist on `InMemoryBoardStore`
(typecheck failure counts as red here).

- [ ] **Step 4: Implement undo/redo in the in-memory store**

In `packages/engine/src/store/memory.ts`, extend the model import to
`import type { BoardElement, ElementId, ElementProps } from '../model/element'`,
then add the two stacks as fields:

```ts
  private undoStack: BoardChange[][] = []
  private redoStack: BoardChange[][] = []
```

Replace `applyChanges` with:

```ts
  applyChanges(changes: BoardChange[], origin: ChangeOrigin = 'local'): void {
    const inverse = this.invertBatch(changes)
    for (const change of changes) {
      this.applyOne(change)
    }
    if (origin === 'local') {
      this.undoStack.push(inverse)
      this.redoStack = []
    }
    this.emit({ changes, origin })
  }
```

Add the new methods:

```ts
  undo(): void {
    const batch = this.undoStack.pop()
    if (!batch) return
    const redo = this.invertBatch(batch)
    for (const change of batch) {
      this.applyOne(change)
    }
    this.redoStack.push(redo)
    this.emit({ changes: batch, origin: 'undo' })
  }

  redo(): void {
    const batch = this.redoStack.pop()
    if (!batch) return
    const undo = this.invertBatch(batch)
    for (const change of batch) {
      this.applyOne(change)
    }
    this.undoStack.push(undo)
    this.emit({ changes: batch, origin: 'undo' })
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * Builds the inverse batch BEFORE the batch is applied, reading the
   * current state for prior values. Reversed so inverses replay in the
   * correct order.
   */
  private invertBatch(changes: BoardChange[]): BoardChange[] {
    const inverses: BoardChange[] = []
    for (const change of changes) {
      const inverse = this.invertOne(change)
      if (inverse) inverses.push(inverse)
    }
    return inverses.reverse()
  }

  private invertOne(change: BoardChange): BoardChange | null {
    switch (change.kind) {
      case 'create':
        return { kind: 'delete', id: change.element.id }
      case 'delete': {
        const element = this.elements.get(change.id)
        return element ? { kind: 'create', element } : null
      }
      case 'update': {
        const element = this.elements.get(change.id)
        if (!element) return null
        const prior: Record<string, unknown> = {}
        for (const key of Object.keys(change.props)) {
          prior[key] = (element as Record<string, unknown>)[key]
        }
        return { kind: 'update', id: change.id, props: prior as ElementProps }
      }
    }
  }
```

- [ ] **Step 5: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @tlwb/engine test && pnpm --filter @tlwb/engine typecheck`
Expected: all contract tests PASS (both the Task 4 and Task 5 cases), no
type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "✨ feat(engine): add per-origin undo and redo to the board store"
```

---

### Task 6: Versioned JSON board snapshot

**Files:**
- Create: `packages/engine/src/snapshot.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/snapshot.test.ts`

**Interfaces:**
- Consumes: `BoardElement` (Task 2), `BoardStore`, `BoardMeta` (Tasks
  4-5).
- Produces: the interchange format of the product specification (file
  export, MCP `read_board`, thumbnails):
  `interface BoardSnapshot { schema: 1; meta: BoardMeta; elements: BoardElement[] }`,
  `exportSnapshot(store: BoardStore): BoardSnapshot`,
  `importSnapshot(store: BoardStore, snapshot: BoardSnapshot): void`,
  `parseSnapshot(data: unknown): BoardSnapshot` (throws on invalid data).

- [ ] **Step 1: Add the dependency**

```bash
pnpm add zod --filter @tlwb/engine
```

- [ ] **Step 2: Write the failing test**

`packages/engine/test/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../src/model/create'
import {
  exportSnapshot,
  importSnapshot,
  parseSnapshot,
} from '../src/snapshot'
import { InMemoryBoardStore } from '../src/store/memory'

describe('board snapshot', () => {
  it('round-trips a board through export, JSON, parse, and import', () => {
    const source = new InMemoryBoardStore()
    source.setMeta({ name: 'payments architecture' })
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 10,
      width: 120,
      height: 80,
    })
    const label = createElement('text', {
      index: 'a1',
      text: 'API gateway',
      containerId: rectangle.id,
    })
    source.applyChanges([
      { kind: 'create', element: rectangle },
      { kind: 'create', element: label },
    ])

    const snapshot = parseSnapshot(
      JSON.parse(JSON.stringify(exportSnapshot(source))),
    )

    const target = new InMemoryBoardStore()
    importSnapshot(target, snapshot)
    expect(target.getMeta().name).toBe('payments architecture')
    expect(target.listElements()).toEqual(source.listElements())
  })

  it('replaces existing content on import', () => {
    const store = new InMemoryBoardStore()
    const old = createElement('ellipse', { index: 'a0' })
    store.applyChanges([{ kind: 'create', element: old }])
    importSnapshot(store, {
      schema: 1,
      meta: { name: 'fresh', createdAt: 1 },
      elements: [],
    })
    expect(store.listElements()).toEqual([])
    expect(store.getMeta().name).toBe('fresh')
  })

  it('import is not undoable', () => {
    const store = new InMemoryBoardStore()
    importSnapshot(store, {
      schema: 1,
      meta: { name: 'imported', createdAt: 1 },
      elements: [createElement('rectangle', { index: 'a0' })],
    })
    expect(store.canUndo()).toBe(false)
  })

  it('rejects data with an unknown schema version', () => {
    expect(() =>
      parseSnapshot({ schema: 2, meta: { name: 'x', createdAt: 1 }, elements: [] }),
    ).toThrow()
  })

  it('rejects an element with a missing required property', () => {
    expect(() =>
      parseSnapshot({
        schema: 1,
        meta: { name: 'x', createdAt: 1 },
        elements: [{ type: 'rectangle', id: 'e1' }],
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, `snapshot.ts` does not exist.

- [ ] **Step 4: Implement the snapshot module**

`packages/engine/src/snapshot.ts`:

```ts
import { z } from 'zod'
import type { BoardElement } from './model/element'
import type { BoardChange, BoardMeta, BoardStore } from './store/types'

const pointSchema = z.object({ x: z.number(), y: z.number() })

const baseShape = {
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  angle: z.number(),
  strokeColor: z.string(),
  fillColor: z.string().nullable(),
  strokeWidth: z.number(),
  strokeStyle: z.enum(['solid', 'dashed']),
  sketchiness: z.number(),
  opacity: z.number(),
  seed: z.number(),
  index: z.string(),
  groupId: z.string().nullable(),
}

const bindingSchema = z.object({ elementId: z.string() }).nullable()

const elementSchema = z.discriminatedUnion('type', [
  z.object({ ...baseShape, type: z.literal('rectangle') }),
  z.object({ ...baseShape, type: z.literal('ellipse') }),
  z.object({ ...baseShape, type: z.literal('diamond') }),
  z.object({ ...baseShape, type: z.literal('line'), points: z.array(pointSchema) }),
  z.object({
    ...baseShape,
    type: z.literal('arrow'),
    points: z.array(pointSchema),
    startBinding: bindingSchema,
    endBinding: bindingSchema,
  }),
  z.object({ ...baseShape, type: z.literal('draw'), points: z.array(pointSchema) }),
  z.object({
    ...baseShape,
    type: z.literal('text'),
    text: z.string(),
    fontSize: z.number(),
    fontFamily: z.enum(['hand', 'ui']),
    textAlign: z.enum(['left', 'center', 'right']),
    containerId: z.string().nullable(),
  }),
  z.object({ ...baseShape, type: z.literal('image'), assetHash: z.string() }),
])

const snapshotSchema = z.object({
  schema: z.literal(1),
  meta: z.object({ name: z.string(), createdAt: z.number() }),
  elements: z.array(elementSchema),
})

export interface BoardSnapshot {
  schema: 1
  meta: BoardMeta
  elements: BoardElement[]
}

export function exportSnapshot(store: BoardStore): BoardSnapshot {
  return {
    schema: 1,
    meta: store.getMeta(),
    elements: store.listElements(),
  }
}

export function importSnapshot(
  store: BoardStore,
  snapshot: BoardSnapshot,
): void {
  const deletions = store
    .listElements()
    .map((element): BoardChange => ({ kind: 'delete', id: element.id }))
  const creations = snapshot.elements.map(
    (element): BoardChange => ({ kind: 'create', element }),
  )
  store.applyChanges([...deletions, ...creations], 'remote')
  store.setMeta(snapshot.meta)
}

export function parseSnapshot(data: unknown): BoardSnapshot {
  return snapshotSchema.parse(data) as BoardSnapshot
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { exportSnapshot, importSnapshot, parseSnapshot } from './snapshot'
export type { BoardSnapshot } from './snapshot'
```

- [ ] **Step 5: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: every engine test PASSES, no type errors anywhere in the
workspace.

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "✨ feat(engine): add versioned JSON board snapshot format"
```
