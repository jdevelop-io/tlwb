# tlwb Engine Editor API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `packages/engine` with `createEditor`, the DOM-bound
public API: two stacked canvases (scene and overlay), pointer, wheel,
and keyboard binding onto the headless interaction controller, overlay
painting (selection, handles, lasso, snap guides, remote presence),
PNG and SVG export, read-only mode, programmatic actions for the client
chrome, double-click text editing with shape labels, and text
measurement.

**Architecture:** Fourth and last plan of the canvas engine series
defined by
`.claude/superpowers/specs/2026-08-08-tlwb-canvas-engine-realtime-design.md`.
Pure painters (`renderOverlay`, the SVG and PNG exporters) sit next to
`renderScene` and are tested pixel-for-pixel under `@napi-rs/canvas`.
The DOM binding is isolated behind an `EditorEnvironment` seam (canvas
creation, size and pixel ratio observation, keyboard target, frame
scheduling) so the editor is tested in Node with a small fake DOM and
no jsdom. Every element mutation still flows through the injected
`BoardStore`.

**Tech Stack:** TypeScript (strict), Vitest, `@napi-rs/canvas` and
`pixelmatch` for visual tests, rough.js and perfect-freehand for the
SVG export. No new dependencies.

**Spec:** `.claude/superpowers/specs/2026-08-25-tlwb-engine-editor-api-design.md`

## Global Constraints

- License: MIT, copyright JDevelop.
- All file content, code, comments, and commit messages in English.
- Commits: gitmoji + Conventional Commits (`<emoji> <type>(<scope>): <summary>`).
- TDD is mandatory: every behavior lands red first, then green.
- Node.js >= 22, pnpm 11, `"type": "module"` (ESM only), TypeScript `strict` plus `noUncheckedIndexedAccess`.
- `packages/engine` runtime dependencies stay exactly `fractional-indexing`, `zod`, `roughjs`, `perfect-freehand`. Dev dependencies stay exactly `@napi-rs/canvas`, `@types/node`, `pixelmatch`, `typescript`, `vitest`. No jsdom, no React, no Yjs, no network code.
- Tests run in Node: nothing under `src/` may touch `document` or `window` at module load time, only inside functions the editor calls at runtime, and every such call goes through `EditorEnvironment`.
- Screen-space constants (handle size, hit tolerance, snap threshold, export margin in world units excepted) are CSS pixels and divided by `camera.zoom` at the call site.
- Angles are radians; rotation pivots on the element center.
- Overlay colors: selection accent `#FF6B4A` (brand coral), agent badge `#8B7CF6` (soft violet), guides `#FF6B4A`, lasso fill `rgba(255, 107, 74, 0.08)`, labels 12 px `system-ui, sans-serif`.
- Visual baselines are generated with `pnpm --filter @tlwb/engine test:visual:update`, reviewed by eye (open the PNG), then committed. A task that adds a baseline says so in its commit step.
- All commands run from the repository root.

## File Structure

- `src/model/bindings.ts` (modified): `labelFrame`, `boundLabelUpdates`, and `applyWithBindings` (renamed from `applyWithArrows`), so labels follow their container the way bound arrows do.
- `src/render/text.ts` (modified): `TextSpec`, `TextSize`, `measureText`.
- `src/render/schedule.ts`: `createFrameScheduler`, the one-pending-frame invalidation loop shared by the scene renderer and the overlay.
- `src/render/renderer.ts` (modified): uses the scheduler; `resize` accepts a pixel ratio.
- `src/render/overlay.ts`: `OverlayTheme`, `DEFAULT_OVERLAY_THEME`, `renderOverlay`, the pure overlay painter.
- `src/presence.ts`: `Peer` and `sanitizePeers`.
- `src/render/shapes.ts` (modified): `getShapeSvgPaths`, rough.js path info for a sketchy element.
- `src/export/bounds.ts`: `selectExportElements`, `exportBounds`.
- `src/export/svg.ts`: `exportSceneSvg`.
- `src/export/png.ts`: `exportScenePng`.
- `src/editor/environment.ts`: `EditorEnvironment`, `resolveEnvironment` (browser defaults: `document.createElement`, `ResizeObserver`, `matchMedia`, `window`, `requestAnimationFrame`).
- `src/editor/cursor.ts`: `cursorFor`, the pure CSS cursor choice.
- `src/editor/input.ts`: `bindInput`, pointer, wheel, double-click, and keyboard listeners over an `InputHost`.
- `src/editor/textEditing.ts`: `resolveDoubleClick`, `commitTextChanges`, pure helpers for double-click dispatch and text commit.
- `src/editor/types.ts`: `EditorOptions`, `EditorState`, `Editor`, `EditorAction`, `ExportOptions`.
- `src/editor/editor.ts`: `createEditor`.
- `src/interaction/controller.ts` (modified): `execute(action)` on the public controller.
- `src/index.ts` (modified): exports.
- `test/editor/fakeDom.ts`: `FakeNode`, `FakeCanvas`, `FakeContainer`, `fakeEnvironment`.
- `test/editor/harness.ts`: `mountEditor`.
- `test/visual/scenes.ts` and `test/visual/visual.test.ts` (modified): overlay and export scenes.

---

### Task 1: Labels follow their container

**Files:**

- Modify: `packages/engine/src/model/bindings.ts`
- Modify: `packages/engine/src/tools/select.ts` (rename call sites)
- Modify: `packages/engine/src/interaction/controller.ts` (rename call sites)
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/model/bindings.test.ts`

**Interfaces:**

- Consumes: `BoardElement`, `ElementId`, `ElementProps`, `TextElement` from `src/model/element.ts`; `BoardChange`, `BoardStore` from `src/store/types.ts`; existing `boundArrowUpdates`.
- Produces:
  - `labelFrame(container: BoardElement, size: { width: number; height: number }): { x: number; y: number; angle: number }` (position centering `size` in the container, angle copied from it)
  - `boundLabelUpdates(elements: readonly BoardElement[], movedIds: ReadonlySet<ElementId>): BoardChange[]` (recenters every label whose container is in `movedIds` and that did not move itself)
  - `applyWithBindings(store: BoardStore, changes: BoardChange[], touchedIds: ReadonlySet<ElementId>): void` (replaces `applyWithArrows`; applies the batch, then arrow and label updates in one second batch)

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/test/model/bindings.test.ts`:

```ts
import {
  applyWithBindings,
  boundLabelUpdates,
  labelFrame,
} from '../../src/model/bindings'
import { InMemoryBoardStore } from '../../src/store/memory'

describe('labelFrame', () => {
  it('centers the label in the container and copies its angle', () => {
    const container = createElement('rectangle', {
      index: 'a0',
      x: 100,
      y: 50,
      width: 200,
      height: 100,
      angle: Math.PI / 4,
    })
    expect(labelFrame(container, { width: 40, height: 20 })).toEqual({
      x: 180,
      y: 90,
      angle: Math.PI / 4,
    })
  })
})

describe('boundLabelUpdates', () => {
  const scene = () => {
    const container = createElement('ellipse', {
      id: 'shape',
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    })
    const label = createElement('text', {
      id: 'label',
      index: 'a1',
      x: 30,
      y: 20,
      width: 40,
      height: 20,
      text: 'hi',
      containerId: 'shape',
    })
    const loose = createElement('text', {
      id: 'loose',
      index: 'a2',
      x: 500,
      y: 500,
      width: 40,
      height: 20,
      text: 'free',
    })
    return [container, label, loose]
  }

  it('recenters the label when its container moved', () => {
    const [container, label, loose] = scene()
    const moved = { ...container, x: 200, y: 100, angle: 0.5 } as typeof container
    const updates = boundLabelUpdates([moved, label, loose], new Set(['shape']))
    expect(updates).toEqual([
      { kind: 'update', id: 'label', props: { x: 230, y: 120, angle: 0.5 } },
    ])
  })

  it('leaves a label alone when it moved with its container', () => {
    const elements = scene()
    expect(
      boundLabelUpdates(elements, new Set(['shape', 'label'])),
    ).toEqual([])
  })

  it('ignores text without a container and containers that did not move', () => {
    const elements = scene()
    expect(boundLabelUpdates(elements, new Set(['loose']))).toEqual([])
    expect(boundLabelUpdates(elements, new Set(['label']))).toEqual([])
  })
})

describe('applyWithBindings', () => {
  it('moves the label and re-anchors the arrow in the same second batch', () => {
    const store = new InMemoryBoardStore()
    const shape = createElement('rectangle', {
      id: 'shape',
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    const label = createElement('text', {
      id: 'label',
      index: 'a1',
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      text: 'a',
      containerId: 'shape',
    })
    const arrow = createElement('arrow', {
      id: 'arrow',
      index: 'a2',
      x: 100,
      y: 50,
      width: 100,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      startBinding: { elementId: 'shape' },
      endBinding: null,
    })
    store.applyChanges([
      { kind: 'create', element: shape },
      { kind: 'create', element: label },
      { kind: 'create', element: arrow },
    ])
    const batches: number[] = []
    store.subscribe((event) => {
      if (event.kind === 'changes') {
        batches.push(event.changes.length)
      }
    })
    applyWithBindings(
      store,
      [{ kind: 'update', id: 'shape', props: { x: 300 } }],
      new Set(['shape']),
    )
    expect(batches).toEqual([1, 2])
    expect(store.getElement('label')).toMatchObject({ x: 340, y: 40 })
    // The tail re-anchors on the moved shape's left edge (x = 300); the
    // arrow frame is normalized around its points.
    const moved = store.getElement('arrow') as ArrowElement
    expect(moved.x + (moved.points[0] as Point).x).toBe(300)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/model/bindings.test.ts`
Expected: FAIL, `labelFrame`, `boundLabelUpdates`, and `applyWithBindings` are not exported.

- [ ] **Step 3: Implement the label bindings**

In `packages/engine/src/model/bindings.ts`, add after `boundArrowUpdates`:

```ts
/**
 * Frame of a label centered in its container: the label's own center
 * sits on the container's center and it turns with the container, so
 * rotating either one keeps them concentric.
 */
export function labelFrame(
  container: BoardElement,
  size: { width: number; height: number },
): { x: number; y: number; angle: number } {
  return {
    x: container.x + (container.width - size.width) / 2,
    y: container.y + (container.height - size.height) / 2,
    angle: container.angle,
  }
}

/**
 * Update batch recentering every label whose container is in
 * `movedIds`, from the current element positions (call it after the
 * move batch has been applied). A label that moved itself is skipped,
 * exactly like an arrow that moved itself in `boundArrowUpdates`.
 */
export function boundLabelUpdates(
  elements: readonly BoardElement[],
  movedIds: ReadonlySet<ElementId>,
): BoardChange[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const changes: BoardChange[] = []
  for (const element of elements) {
    if (
      element.type !== 'text' ||
      element.containerId === null ||
      movedIds.has(element.id)
    ) {
      continue
    }
    const container = byId.get(element.containerId)
    if (!container || !movedIds.has(container.id)) {
      continue
    }
    changes.push({
      kind: 'update',
      id: element.id,
      props: labelFrame(container, element),
    })
  }
  return changes
}
```

Replace the `applyWithArrows` function (keep its comment, adjusted) with:

```ts
/**
 * Applies a batch, then re-anchors the arrows and recenters the labels
 * bound to the touched ids. This is the whole follow policy in one
 * place: any change to an element's frame must update what is bound to
 * it, so every caller that moves, resizes, or rotates elements goes
 * through here rather than pairing `applyChanges` with the update
 * builders on its own.
 */
export function applyWithBindings(
  store: BoardStore,
  changes: BoardChange[],
  touchedIds: ReadonlySet<ElementId>,
): void {
  store.applyChanges(changes)
  const elements = store.listElements()
  const bound = [
    ...boundArrowUpdates(elements, touchedIds),
    ...boundLabelUpdates(elements, touchedIds),
  ]
  if (bound.length > 0) {
    store.applyChanges(bound)
  }
}
```

Rename every call site:

```bash
sed -i '' 's/applyWithArrows/applyWithBindings/g' packages/engine/src/tools/select.ts packages/engine/src/interaction/controller.ts
```

In `packages/engine/src/index.ts`, extend the bindings export block:

```ts
export {
  applyWithBindings,
  attachmentPoint,
  boundArrowUpdates,
  boundLabelUpdates,
  findBindTarget,
  isBindable,
  labelFrame,
} from './model/bindings'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS, including the select tool and controller suites, which now route through `applyWithBindings`.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src packages/engine/test/model/bindings.test.ts
git commit -m "✨ feat(bindings): move labels with their container"
```

---

### Task 2: Text measurement

**Files:**

- Modify: `packages/engine/src/render/text.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/render/text.test.ts`

**Interfaces:**

- Consumes: `FontFamily` from `src/model/element.ts`; a `CanvasRenderingContext2D` (any 2D context; tests use `@napi-rs/canvas`).
- Produces:
  - `interface TextSpec { text: string; fontSize: number; fontFamily: FontFamily }` (a `TextElement` satisfies it)
  - `interface TextSize { width: number; height: number }`
  - `measureText(spec: TextSpec, fonts: FontConfig, ctx: CanvasRenderingContext2D): TextSize` (widest line by `ctx.measureText`, height `lines * fontSize * LINE_HEIGHT`)
  - `fontString(spec: TextSpec, fonts: FontConfig): string` and `textLines(spec: { text: string }): string[]` now accept the spec shape (existing callers pass elements, unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/test/render/text.test.ts`:

```ts
import { createCanvas } from '@napi-rs/canvas'
import { LINE_HEIGHT, measureText } from '../../src/render/text'

const FONTS = { hand: 'Caveat', ui: 'Caveat' }
const ctx = createCanvas(1, 1).getContext(
  '2d',
) as unknown as CanvasRenderingContext2D

describe('measureText', () => {
  it('measures the widest line and counts lines into the height', () => {
    const one = measureText(
      { text: 'hi', fontSize: 20, fontFamily: 'hand' },
      FONTS,
      ctx,
    )
    const two = measureText(
      { text: 'hi\nhello there', fontSize: 20, fontFamily: 'hand' },
      FONTS,
      ctx,
    )
    expect(one.width).toBeGreaterThan(0)
    expect(one.height).toBe(20 * LINE_HEIGHT)
    expect(two.width).toBeGreaterThan(one.width)
    expect(two.height).toBe(2 * 20 * LINE_HEIGHT)
  })

  it('gives an empty text a zero width and one line of height', () => {
    expect(
      measureText({ text: '', fontSize: 16, fontFamily: 'ui' }, FONTS, ctx),
    ).toEqual({ width: 0, height: 16 * LINE_HEIGHT })
  })

  it('scales with the font size', () => {
    const small = measureText(
      { text: 'scale', fontSize: 10, fontFamily: 'hand' },
      FONTS,
      ctx,
    )
    const large = measureText(
      { text: 'scale', fontSize: 40, fontFamily: 'hand' },
      FONTS,
      ctx,
    )
    expect(large.width).toBeCloseTo(small.width * 4, 0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/render/text.test.ts`
Expected: FAIL, `measureText` is not exported.

- [ ] **Step 3: Implement measurement**

Replace the content of `packages/engine/src/render/text.ts` with:

```ts
import type { FontFamily, TextAlign } from '../model/element'

export interface FontConfig {
  hand: string
  ui: string
}

/** What sizing a text needs; a `TextElement` satisfies it. */
export interface TextSpec {
  text: string
  fontSize: number
  fontFamily: FontFamily
}

export interface TextSize {
  width: number
  height: number
}

/**
 * Fallback stacks only: the client passes the exact families once the
 * Foundations fonts are loaded. The engine never loads fonts itself.
 */
export const DEFAULT_FONTS: FontConfig = {
  hand: 'Caveat, cursive',
  ui: 'system-ui, sans-serif',
}

/** Line height as a multiplier on the element font size. */
export const LINE_HEIGHT = 1.25

export function fontString(spec: TextSpec, fonts: FontConfig): string {
  return `${spec.fontSize}px ${fonts[spec.fontFamily]}`
}

/** v1 text has no wrapping: lines are exactly the typed newlines. */
export function textLines(spec: { text: string }): string[] {
  return spec.text.split('\n')
}

/** X of the alignment anchor inside the element frame. */
export function textAnchorX(element: {
  width: number
  textAlign: TextAlign
}): number {
  switch (element.textAlign) {
    case 'left':
      return 0
    case 'center':
      return element.width / 2
    case 'right':
      return element.width
  }
}

/**
 * Size of a text as the scene paints it: the widest line measured by
 * the context, the height from the line count. Any 2D context works;
 * the editor keeps one offscreen for this, and the host uses it to
 * size its DOM editor so editing and rendering agree.
 */
export function measureText(
  spec: TextSpec,
  fonts: FontConfig,
  ctx: CanvasRenderingContext2D,
): TextSize {
  ctx.font = fontString(spec, fonts)
  let width = 0
  const lines = textLines(spec)
  for (const line of lines) {
    width = Math.max(width, ctx.measureText(line).width)
  }
  return { width, height: lines.length * spec.fontSize * LINE_HEIGHT }
}
```

In `packages/engine/src/index.ts`, update the text export block:

```ts
export type { FontConfig, TextSize, TextSpec } from './render/text'
export {
  DEFAULT_FONTS,
  fontString,
  LINE_HEIGHT,
  measureText,
  textAnchorX,
  textLines,
} from './render/text'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS (the scene renderer keeps passing elements to `fontString`, `textLines`, and `textAnchorX`).

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/render/text.ts packages/engine/src/index.ts packages/engine/test/render/text.test.ts
git commit -m "✨ feat(render): measure text as the scene paints it"
```

---

### Task 3: Shared frame scheduler and pixel ratio changes

**Files:**

- Create: `packages/engine/src/render/schedule.ts`
- Modify: `packages/engine/src/render/renderer.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/render/schedule.test.ts`
- Test: `packages/engine/test/render/renderer.test.ts`

**Interfaces:**

- Produces:
  - `type FrameRequester = (callback: () => void) => void`
  - `defaultRequestFrame: FrameRequester` (`requestAnimationFrame` when present, else `setTimeout(16)`)
  - `interface FrameScheduler { markDirty(): void; destroy(): void }`
  - `createFrameScheduler(paint: () => void, requestFrame?: FrameRequester): FrameScheduler` (at most one pending frame; `destroy` drops pending and future frames)
  - `Renderer.resize(width: number, height: number, devicePixelRatio?: number): void` (ratio defaults to the current one)

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/render/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createFrameScheduler } from '../../src/render/schedule'

function harness() {
  const frames: (() => void)[] = []
  let paints = 0
  const scheduler = createFrameScheduler(
    () => {
      paints += 1
    },
    (callback) => {
      frames.push(callback)
    },
  )
  const flush = () => {
    for (const frame of frames.splice(0)) {
      frame()
    }
  }
  return { frames, flush, scheduler, paints: () => paints }
}

describe('createFrameScheduler', () => {
  it('schedules nothing until marked dirty', () => {
    const { frames } = harness()
    expect(frames).toHaveLength(0)
  })

  it('coalesces marks into one pending frame and paints once', () => {
    const { frames, flush, scheduler, paints } = harness()
    scheduler.markDirty()
    scheduler.markDirty()
    scheduler.markDirty()
    expect(frames).toHaveLength(1)
    flush()
    expect(paints()).toBe(1)
    scheduler.markDirty()
    expect(frames).toHaveLength(1)
  })

  it('never paints after destroy, even for a frame already pending', () => {
    const { flush, scheduler, paints, frames } = harness()
    scheduler.markDirty()
    scheduler.destroy()
    flush()
    scheduler.markDirty()
    expect(paints()).toBe(0)
    expect(frames).toHaveLength(0)
  })
})
```

Append to `packages/engine/test/render/renderer.test.ts` inside the `describe('createRenderer')` block:

```ts
  it('rescales the backing store when the pixel ratio changes', () => {
    const { canvas, flush, renderer } = harness()
    flush()
    renderer.resize(100, 100, 2)
    flush()
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(200)
    renderer.resize(50, 50)
    flush()
    expect(canvas.width).toBe(100)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/render`
Expected: FAIL, `schedule.ts` does not exist and `resize` ignores its third argument.

- [ ] **Step 3: Implement the scheduler and refactor the renderer**

Create `packages/engine/src/render/schedule.ts`:

```ts
export type FrameRequester = (callback: () => void) => void

export const defaultRequestFrame: FrameRequester = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback())
  } else {
    setTimeout(callback, 16)
  }
}

export interface FrameScheduler {
  markDirty(): void
  destroy(): void
}

/**
 * Invalidation loop: `markDirty` requests at most one frame, and the
 * frame paints once however many marks preceded it. There is no
 * continuous loop; an idle layer costs nothing. The scene renderer and
 * the overlay each own one, so they invalidate independently.
 */
export function createFrameScheduler(
  paint: () => void,
  requestFrame: FrameRequester = defaultRequestFrame,
): FrameScheduler {
  let dirty = false
  let destroyed = false
  return {
    markDirty: () => {
      if (dirty || destroyed) {
        return
      }
      dirty = true
      requestFrame(() => {
        dirty = false
        if (destroyed) {
          return
        }
        paint()
      })
    },
    destroy: () => {
      destroyed = true
    },
  }
}
```

Replace the content of `packages/engine/src/render/renderer.ts` with:

```ts
import { type Camera, clampZoom, createCamera } from '../camera'
import type { BoardStore } from '../store/types'
import { type ImageResolver, renderScene } from './scene'
import { createFrameScheduler, type FrameRequester } from './schedule'
import type { FontConfig } from './text'

export interface RendererOptions {
  canvas: HTMLCanvasElement
  store: BoardStore
  /** Initial viewport size in CSS pixels. */
  width: number
  height: number
  devicePixelRatio?: number
  fonts?: FontConfig
  resolveImage?: ImageResolver
  background?: string
  /** Frame scheduler, injectable for tests. */
  requestFrame?: FrameRequester
}

export interface Renderer {
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** The pixel ratio defaults to the current one. */
  resize(width: number, height: number, devicePixelRatio?: number): void
  markDirty(): void
  destroy(): void
}

/**
 * Binds a canvas to a board store: every store event invalidates the
 * scene, and at most one frame is pending at any time. There is no
 * continuous loop; a clean board costs nothing.
 */
export function createRenderer(options: RendererOptions): Renderer {
  const { canvas, store } = options
  let camera = createCamera()
  let viewport = { width: options.width, height: options.height }
  let devicePixelRatio = options.devicePixelRatio ?? 1

  const scheduler = createFrameScheduler(() => {
    renderScene(canvas, {
      elements: store.listElements(),
      camera,
      viewport,
      devicePixelRatio,
      fonts: options.fonts,
      resolveImage: options.resolveImage,
      background: options.background,
    })
  }, options.requestFrame)

  const unsubscribe = store.subscribe(() => scheduler.markDirty())
  scheduler.markDirty()

  return {
    getCamera: () => camera,
    setCamera: (next) => {
      camera = { ...next, zoom: clampZoom(next.zoom) }
      scheduler.markDirty()
    },
    resize: (width, height, ratio = devicePixelRatio) => {
      viewport = { width, height }
      devicePixelRatio = ratio
      scheduler.markDirty()
    },
    markDirty: scheduler.markDirty,
    destroy: () => {
      scheduler.destroy()
      unsubscribe()
    },
  }
}
```

In `packages/engine/src/index.ts`, add next to the renderer exports:

```ts
export type { FrameRequester, FrameScheduler } from './render/schedule'
export { createFrameScheduler, defaultRequestFrame } from './render/schedule'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test -- test/render`
Expected: PASS, including the existing renderer tests (`stops scheduling after destroy` still holds because the scheduler drops the pending frame).

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/render packages/engine/src/index.ts packages/engine/test/render
git commit -m "♻️ refactor(render): share the frame scheduler and accept pixel ratio changes"
```

---
### Task 4: The overlay painter

**Files:**

- Create: `packages/engine/src/render/overlay.ts`
- Create: `packages/engine/src/presence.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/render/overlay.test.ts`

**Interfaces:**

- Consumes: `InteractionSnapshot` from `src/interaction/controller.ts`; `worldToScreen` from `src/camera.ts`; `toWorldPoint` from `src/geometry/hit.ts`; `HANDLE_SIZE` from `src/geometry/transform.ts`.
- Produces:
  - `interface Peer { id: string; name: string; color: string; cursor: Point | null; selectedIds: ElementId[]; isAgent: boolean }` (`src/presence.ts`)
  - `interface OverlayTheme { selection: string; guide: string; lassoFill: string; agent: string; labelFont: string }`
  - `DEFAULT_OVERLAY_THEME: OverlayTheme`
  - `interface RenderOverlayOptions { elements: readonly BoardElement[]; snapshot: InteractionSnapshot; camera: Camera; viewport: Viewport; devicePixelRatio?: number; peers?: readonly Peer[]; theme?: OverlayTheme }`
  - `renderOverlay(canvas: HTMLCanvasElement, options: RenderOverlayOptions): void` (clears to transparent, paints in screen pixels)

This task paints the local state (selection, handles, lasso, guides).
Peers are accepted in the options but painted in Task 5.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/render/overlay.test.ts`:

```ts
import { type Canvas, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { createCamera } from '../../src/camera'
import { getHandles } from '../../src/geometry/transform'
import type { InteractionSnapshot } from '../../src/interaction/controller'
import { createElement } from '../../src/model/create'
import type { BoardElement } from '../../src/model/element'
import { renderOverlay } from '../../src/render/overlay'
import { selectionBounds } from '../../src/selection'

const SIZE = 200

function square(): BoardElement {
  return createElement('rectangle', {
    id: 'sq',
    index: 'a0',
    seed: 1,
    x: 50,
    y: 50,
    width: 100,
    height: 100,
  })
}

function snapshotFor(
  elements: BoardElement[],
  selectedIds: string[],
  partial: Partial<InteractionSnapshot> = {},
): InteractionSnapshot {
  const bounds = selectionBounds(elements, selectedIds)
  return {
    activeTool: 'select',
    selectedIds,
    selectionBounds: bounds,
    handles: bounds ? getHandles(bounds, 1) : [],
    gesture: 'idle',
    lasso: null,
    guides: [],
    ...partial,
  }
}

function paint(
  elements: BoardElement[],
  snapshot: InteractionSnapshot,
): Canvas {
  const canvas = createCanvas(SIZE, SIZE)
  renderOverlay(canvas as unknown as HTMLCanvasElement, {
    elements,
    snapshot,
    camera: createCamera(),
    viewport: { width: SIZE, height: SIZE },
  })
  return canvas
}

function rgbaAt(canvas: Canvas, x: number, y: number): number[] {
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)
}

describe('renderOverlay', () => {
  it('paints nothing for an empty selection', () => {
    const canvas = paint([square()], snapshotFor([square()], []))
    expect(rgbaAt(canvas, 50, 100)[3]).toBe(0)
    expect(rgbaAt(canvas, 100, 100)[3]).toBe(0)
  })

  it('outlines the selected element and fills its handles white', () => {
    const elements = [square()]
    const canvas = paint(elements, snapshotFor(elements, ['sq']))
    expect(rgbaAt(canvas, 50, 100)[3]).toBeGreaterThan(0)
    expect(rgbaAt(canvas, 100, 100)[3]).toBe(0)
    expect(rgbaAt(canvas, 50, 50)).toEqual([255, 255, 255, 255])
    expect(rgbaAt(canvas, 100, 150)).toEqual([255, 255, 255, 255])
  })

  it('hides the handles while the selection moves', () => {
    const elements = [square()]
    const canvas = paint(
      elements,
      snapshotFor(elements, ['sq'], { gesture: 'moving' }),
    )
    expect(rgbaAt(canvas, 50, 50)).not.toEqual([255, 255, 255, 255])
    expect(rgbaAt(canvas, 50, 100)[3]).toBeGreaterThan(0)
  })

  it('fills the lasso rectangle translucently', () => {
    const canvas = paint(
      [],
      snapshotFor([], [], {
        gesture: 'lasso',
        lasso: { x: 20, y: 20, width: 60, height: 60 },
      }),
    )
    const inside = rgbaAt(canvas, 50, 50)
    expect(inside[3]).toBeGreaterThan(0)
    expect(inside[3]).toBeLessThan(255)
    expect(rgbaAt(canvas, 150, 150)[3]).toBe(0)
  })

  it('draws snap guides across the whole viewport', () => {
    const canvas = paint(
      [],
      snapshotFor([], [], {
        guides: [
          { orientation: 'vertical', position: 120 },
          { orientation: 'horizontal', position: 30 },
        ],
      }),
    )
    expect(rgbaAt(canvas, 120, 5)[3]).toBeGreaterThan(0)
    expect(rgbaAt(canvas, 120, 195)[3]).toBeGreaterThan(0)
    expect(rgbaAt(canvas, 5, 30)[3]).toBeGreaterThan(0)
    expect(rgbaAt(canvas, 60, 100)[3]).toBe(0)
  })

  it('projects through the camera', () => {
    const elements = [square()]
    const canvas = createCanvas(SIZE, SIZE)
    renderOverlay(canvas as unknown as HTMLCanvasElement, {
      elements,
      snapshot: snapshotFor(elements, ['sq']),
      camera: { x: 50, y: 50, zoom: 1 },
      viewport: { width: SIZE, height: SIZE },
    })
    expect(rgbaAt(canvas, 0, 0)).toEqual([255, 255, 255, 255])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/render/overlay.test.ts`
Expected: FAIL, `overlay.ts` does not exist.

- [ ] **Step 3: Implement the presence type and the painter**

Create `packages/engine/src/presence.ts`:

```ts
import { z } from 'zod'
import type { ElementId, Point } from './model/element'

/**
 * One remote collaborator as the overlay paints it. The host derives it
 * from its presence transport (Yjs awareness in the client); the engine
 * never learns where it came from.
 */
export interface Peer {
  id: string
  name: string
  color: string
  /** World coordinates; null when the peer has no cursor to show. */
  cursor: Point | null
  selectedIds: ElementId[]
  isAgent: boolean
}

// zod 4 numbers reject NaN and infinities by default, which is the
// guard the overlay needs against a malformed remote cursor.
const peerSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  cursor: z.object({ x: z.number(), y: z.number() }).nullable(),
  selectedIds: z.array(z.string()),
  isAgent: z.boolean(),
})

/** Keeps the well-formed peers and drops the rest without throwing. */
export function sanitizePeers(peers: readonly unknown[]): Peer[] {
  const kept: Peer[] = []
  for (const peer of peers) {
    const parsed = peerSchema.safeParse(peer)
    if (parsed.success) {
      kept.push(parsed.data)
    }
  }
  return kept
}
```

Create `packages/engine/src/render/overlay.ts`:

```ts
import { type Camera, type Viewport, worldToScreen } from '../camera'
import type { Rect } from '../geometry/bounds'
import { toWorldPoint } from '../geometry/hit'
import { HANDLE_SIZE } from '../geometry/transform'
import type { InteractionSnapshot } from '../interaction/controller'
import type { BoardElement, ElementId, Point } from '../model/element'
import type { Peer } from '../presence'

export interface OverlayTheme {
  /** Selection outlines, handles, and the lasso stroke. */
  selection: string
  guide: string
  lassoFill: string
  /** Agent badge on remote cursors. */
  agent: string
  /** CSS font shorthand for cursor name labels. */
  labelFont: string
}

/** Foundations tokens: brand coral for selection, soft violet for agents. */
export const DEFAULT_OVERLAY_THEME: OverlayTheme = {
  selection: '#FF6B4A',
  guide: '#FF6B4A',
  lassoFill: 'rgba(255, 107, 74, 0.08)',
  agent: '#8B7CF6',
  labelFont: '12px system-ui, sans-serif',
}

export interface RenderOverlayOptions {
  elements: readonly BoardElement[]
  snapshot: InteractionSnapshot
  camera: Camera
  /** CSS pixels; the backing store scales by `devicePixelRatio`. */
  viewport: Viewport
  devicePixelRatio?: number
  peers?: readonly Peer[]
  theme?: OverlayTheme
}

/** Gestures during which the handles would only get in the way. */
const HANDLES_HIDDEN = new Set(['moving', 'resizing', 'rotating', 'creating'])

type Project = (point: Point) => Point

/**
 * Paints the interaction state over the scene, in screen pixels so
 * strokes and handles keep their size at every zoom. Transparent where
 * there is nothing to show: the scene canvas underneath stays visible.
 */
export function renderOverlay(
  canvas: HTMLCanvasElement,
  options: RenderOverlayOptions,
): void {
  const {
    elements,
    snapshot,
    camera,
    viewport,
    devicePixelRatio = 1,
    peers = [],
    theme = DEFAULT_OVERLAY_THEME,
  } = options
  const width = Math.round(viewport.width * devicePixelRatio)
  const height = Math.round(viewport.height * devicePixelRatio)
  if (canvas.width !== width) {
    canvas.width = width
  }
  if (canvas.height !== height) {
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  ctx.clearRect(0, 0, viewport.width, viewport.height)
  const byId = new Map(elements.map((element) => [element.id, element]))
  const project: Project = (point) => worldToScreen(camera, point)

  paintSelection(ctx, byId, snapshot, project, theme)
  if (snapshot.lasso) {
    paintLasso(ctx, snapshot.lasso, project, theme)
  }
  paintGuides(ctx, snapshot, project, viewport, theme)
  paintPeers(ctx, byId, peers, project, theme)
}

/** Screen corners of the element's rotated frame. */
function elementCorners(element: BoardElement, project: Project): Point[] {
  const { width, height } = element
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((local) => project(toWorldPoint(element, local)))
}

function strokePolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  lineWidth: number,
): void {
  const [first, ...rest] = points
  if (!first) {
    return
  }
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (const point of rest) {
    ctx.lineTo(point.x, point.y)
  }
  ctx.closePath()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.stroke()
}

function projectRect(rect: Rect, project: Project, zoom: number): Rect {
  const origin = project(rect)
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * zoom,
    height: rect.height * zoom,
  }
}

function paintSelection(
  ctx: CanvasRenderingContext2D,
  byId: ReadonlyMap<ElementId, BoardElement>,
  snapshot: InteractionSnapshot,
  project: Project,
  theme: OverlayTheme,
): void {
  const selected = snapshot.selectedIds
    .map((id) => byId.get(id))
    .filter((element): element is BoardElement => element !== undefined)
  if (selected.length === 0) {
    return
  }
  ctx.save()
  for (const element of selected) {
    strokePolygon(ctx, elementCorners(element, project), theme.selection, 1)
  }
  if (selected.length > 1 && snapshot.selectionBounds) {
    const zoom = project({ x: 1, y: 0 }).x - project({ x: 0, y: 0 }).x
    const box = projectRect(snapshot.selectionBounds, project, zoom)
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = theme.selection
    ctx.lineWidth = 1
    ctx.strokeRect(box.x, box.y, box.width, box.height)
    ctx.setLineDash([])
  }
  if (!HANDLES_HIDDEN.has(snapshot.gesture)) {
    for (const handle of snapshot.handles) {
      const at = project(handle)
      ctx.beginPath()
      if (handle.kind === 'rotate') {
        ctx.arc(at.x, at.y, HANDLE_SIZE / 2, 0, Math.PI * 2)
      } else {
        ctx.rect(
          at.x - HANDLE_SIZE / 2,
          at.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE,
        )
      }
      ctx.fillStyle = '#FFFFFF'
      ctx.fill()
      ctx.strokeStyle = theme.selection
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
  ctx.restore()
}

function paintLasso(
  ctx: CanvasRenderingContext2D,
  lasso: Rect,
  project: Project,
  theme: OverlayTheme,
): void {
  const zoom = project({ x: 1, y: 0 }).x - project({ x: 0, y: 0 }).x
  const box = projectRect(lasso, project, zoom)
  ctx.save()
  ctx.fillStyle = theme.lassoFill
  ctx.fillRect(box.x, box.y, box.width, box.height)
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = theme.selection
  ctx.lineWidth = 1
  ctx.strokeRect(box.x, box.y, box.width, box.height)
  ctx.restore()
}

function paintGuides(
  ctx: CanvasRenderingContext2D,
  snapshot: InteractionSnapshot,
  project: Project,
  viewport: Viewport,
  theme: OverlayTheme,
): void {
  if (snapshot.guides.length === 0) {
    return
  }
  ctx.save()
  ctx.strokeStyle = theme.guide
  ctx.lineWidth = 1
  for (const guide of snapshot.guides) {
    ctx.beginPath()
    if (guide.orientation === 'vertical') {
      const x = project({ x: guide.position, y: 0 }).x
      ctx.moveTo(x, 0)
      ctx.lineTo(x, viewport.height)
    } else {
      const y = project({ x: 0, y: guide.position }).y
      ctx.moveTo(0, y)
      ctx.lineTo(viewport.width, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function paintPeers(
  _ctx: CanvasRenderingContext2D,
  _byId: ReadonlyMap<ElementId, BoardElement>,
  _peers: readonly Peer[],
  _project: Project,
  _theme: OverlayTheme,
): void {
  // Painted in the next task.
}
```

In `packages/engine/src/index.ts`, add:

```ts
export type { Peer } from './presence'
export { sanitizePeers } from './presence'
export type { OverlayTheme, RenderOverlayOptions } from './render/overlay'
export { DEFAULT_OVERLAY_THEME, renderOverlay } from './render/overlay'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test -- test/render/overlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/presence.ts packages/engine/src/render/overlay.ts packages/engine/src/index.ts packages/engine/test/render/overlay.test.ts
git commit -m "✨ feat(render): paint the interaction overlay"
```

---

### Task 5: Remote presence on the overlay

**Files:**

- Modify: `packages/engine/src/render/overlay.ts`
- Modify: `packages/engine/test/visual/scenes.ts`
- Modify: `packages/engine/test/visual/visual.test.ts`
- Test: `packages/engine/test/render/overlay.test.ts`
- Test: `packages/engine/test/presence.test.ts`

**Interfaces:**

- Consumes: `Peer`, `sanitizePeers` from Task 4; `OverlayTheme.agent` and `labelFont`.
- Produces: `paintPeers` implemented (cursor arrow, name pill, agent badge, per-peer selection outlines); visual scenes `overlaySelectionScene()` and `overlayPresenceScene()` returning `{ elements, snapshot, peers }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/presence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sanitizePeers } from '../src/presence'

const good = {
  id: 'p1',
  name: 'Ada',
  color: '#00AA00',
  cursor: { x: 10, y: 20 },
  selectedIds: ['a'],
  isAgent: false,
}

describe('sanitizePeers', () => {
  it('keeps well-formed peers as they are', () => {
    expect(sanitizePeers([good])).toEqual([good])
  })

  it('drops peers with missing fields or a non-finite cursor', () => {
    expect(
      sanitizePeers([
        { ...good, cursor: { x: Number.NaN, y: 0 } },
        { ...good, name: undefined },
        null,
        'nope',
        { ...good, id: 'ok', cursor: null },
      ]),
    ).toEqual([{ ...good, id: 'ok', cursor: null }])
  })
})
```

Append to `packages/engine/test/render/overlay.test.ts`:

```ts
import type { Peer } from '../../src/presence'

function peer(partial: Partial<Peer> = {}): Peer {
  return {
    id: 'p1',
    name: 'Ada',
    color: '#00AA00',
    cursor: { x: 100, y: 100 },
    selectedIds: [],
    isAgent: false,
    ...partial,
  }
}

function paintPeers(elements: BoardElement[], peers: Peer[]): Canvas {
  const canvas = createCanvas(SIZE, SIZE)
  renderOverlay(canvas as unknown as HTMLCanvasElement, {
    elements,
    snapshot: snapshotFor(elements, []),
    camera: createCamera(),
    viewport: { width: SIZE, height: SIZE },
    peers,
  })
  return canvas
}

describe('renderOverlay presence', () => {
  it('paints a cursor in the peer color at the projected position', () => {
    const canvas = paintPeers([], [peer()])
    expect(rgbaAt(canvas, 102, 108)).toEqual([0, 170, 0, 255])
    expect(rgbaAt(canvas, 60, 60)[3]).toBe(0)
  })

  it('paints nothing for a peer without a cursor', () => {
    const canvas = paintPeers([], [peer({ cursor: null })])
    expect(rgbaAt(canvas, 102, 108)[3]).toBe(0)
  })

  it('outlines the elements a peer selected in the peer color', () => {
    const canvas = paintPeers([square()], [peer({ selectedIds: ['sq'] })])
    const edge = rgbaAt(canvas, 50, 100)
    expect(edge[3]).toBeGreaterThan(0)
    expect(edge[1]).toBeGreaterThan(edge[0])
  })

  it('paints a label wider for an agent, which carries the badge', () => {
    const human = paintPeers([], [peer()])
    const agent = paintPeers([], [peer({ isAgent: true })])
    const painted = (canvas: Canvas): number => {
      const data = canvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data
      let count = 0
      for (let i = 3; i < data.length; i += 4) {
        if ((data[i] as number) > 0) {
          count += 1
        }
      }
      return count
    }
    expect(painted(agent)).toBeGreaterThan(painted(human))
  })
})
```

Modify `packages/engine/test/visual/scenes.ts`: add the imports and two scenes.

```ts
import { getHandles } from '../../src/geometry/transform'
import type { InteractionSnapshot } from '../../src/interaction/controller'
import type { Peer } from '../../src/presence'
import { selectionBounds } from '../../src/selection'

export interface OverlayScene {
  elements: BoardElement[]
  snapshot: InteractionSnapshot
  peers: Peer[]
}

/** A rotated rectangle selected, with its handles and two snap guides. */
export function overlaySelectionScene(): OverlayScene {
  const elements = shapesScene()
  const selectedIds = ['rect-3']
  const bounds = selectionBounds(elements, selectedIds)
  return {
    elements,
    snapshot: {
      activeTool: 'select',
      selectedIds,
      selectionBounds: bounds,
      handles: bounds ? getHandles(bounds, 1) : [],
      gesture: 'idle',
      lasso: null,
      guides: [
        { orientation: 'vertical', position: 280 },
        { orientation: 'horizontal', position: 400 },
      ],
    },
    peers: [],
  }
}

/** A lasso in progress over a multiple selection, watched by two peers. */
export function overlayPresenceScene(): OverlayScene {
  const elements = shapesScene()
  const selectedIds = ['rect-1', 'rect-2']
  const bounds = selectionBounds(elements, selectedIds)
  return {
    elements,
    snapshot: {
      activeTool: 'select',
      selectedIds,
      selectionBounds: bounds,
      handles: bounds ? getHandles(bounds, 1) : [],
      gesture: 'lasso',
      lasso: { x: 20, y: 20, width: 440, height: 160 },
      guides: [],
    },
    peers: [
      {
        id: 'ada',
        name: 'Ada',
        color: '#2E86DE',
        cursor: { x: 540, y: 120 },
        selectedIds: ['ellipse-1'],
        isAgent: false,
      },
      {
        id: 'bot',
        name: 'Claude',
        color: '#8B7CF6',
        cursor: { x: 120, y: 300 },
        selectedIds: ['diamond-1'],
        isAgent: true,
      },
    ],
  }
}
```

Modify `packages/engine/test/visual/visual.test.ts`: import `renderOverlay`, the two scenes, and add a helper plus two cases.

```ts
import { renderOverlay } from '../../src/render/overlay'
import {
  freehandScene,
  type OverlayScene,
  overlayPresenceScene,
  overlaySelectionScene,
  shapesScene,
  textScene,
} from './scenes'

/** Scene underneath, overlay on top, flattened onto one canvas. */
function renderOverlayToCanvas(scene: OverlayScene): Canvas {
  const canvas = renderToCanvas(scene.elements)
  const overlay = createCanvas(WIDTH, HEIGHT)
  renderOverlay(overlay as unknown as HTMLCanvasElement, {
    elements: scene.elements,
    snapshot: scene.snapshot,
    camera: createCamera(),
    viewport: { width: WIDTH, height: HEIGHT },
    peers: scene.peers,
    theme: {
      selection: '#FF6B4A',
      guide: '#FF6B4A',
      lassoFill: 'rgba(255, 107, 74, 0.08)',
      agent: '#8B7CF6',
      labelFont: '12px Caveat',
    },
  })
  canvas.getContext('2d').drawImage(overlay, 0, 0)
  return canvas
}
```

Inside `describe('visual regression')`:

```ts
  it('matches the overlay selection baseline', async () => {
    await expectMatchesBaseline(
      'overlay-selection',
      renderOverlayToCanvas(overlaySelectionScene()),
    )
  })

  it('matches the overlay presence baseline', async () => {
    await expectMatchesBaseline(
      'overlay-presence',
      renderOverlayToCanvas(overlayPresenceScene()),
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/presence.test.ts test/render/overlay.test.ts test/visual`
Expected: FAIL, the presence cursor pixel is transparent and the baselines are missing.

- [ ] **Step 3: Implement presence painting**

In `packages/engine/src/render/overlay.ts`, replace the `paintPeers` stub with:

```ts
/** Cursor arrow outline, in CSS pixels from the hot spot. */
const CURSOR_ARROW: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 0, y: 16 },
  { x: 4, y: 12 },
  { x: 7, y: 19 },
  { x: 9, y: 18 },
  { x: 6, y: 11 },
  { x: 11, y: 11 },
]
const LABEL_OFFSET = { x: 12, y: 16 }
const LABEL_HEIGHT = 18
const LABEL_PADDING = 6

function paintPeers(
  ctx: CanvasRenderingContext2D,
  byId: ReadonlyMap<ElementId, BoardElement>,
  peers: readonly Peer[],
  project: Project,
  theme: OverlayTheme,
): void {
  for (const peer of peers) {
    for (const id of peer.selectedIds) {
      const element = byId.get(id)
      if (element) {
        strokePolygon(ctx, elementCorners(element, project), peer.color, 1.5)
      }
    }
    if (!peer.cursor) {
      continue
    }
    const at = project(peer.cursor)
    ctx.save()
    ctx.translate(at.x, at.y)
    ctx.beginPath()
    for (const [i, point] of CURSOR_ARROW.entries()) {
      if (i === 0) {
        ctx.moveTo(point.x, point.y)
      } else {
        ctx.lineTo(point.x, point.y)
      }
    }
    ctx.closePath()
    ctx.fillStyle = peer.color
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1
    ctx.stroke()
    paintPill(ctx, LABEL_OFFSET.x, LABEL_OFFSET.y, peer.name, peer.color, theme)
    if (peer.isAgent) {
      const nameWidth = pillWidth(ctx, peer.name, theme)
      paintPill(
        ctx,
        LABEL_OFFSET.x + nameWidth + 4,
        LABEL_OFFSET.y,
        'AI',
        theme.agent,
        theme,
      )
    }
    ctx.restore()
  }
}

function pillWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  theme: OverlayTheme,
): number {
  ctx.font = theme.labelFont
  return ctx.measureText(text).width + LABEL_PADDING * 2
}

function paintPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  theme: OverlayTheme,
): void {
  const width = pillWidth(ctx, text, theme)
  ctx.fillStyle = color
  ctx.fillRect(x, y, width, LABEL_HEIGHT)
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, x + LABEL_PADDING, y + LABEL_HEIGHT / 2)
}
```

- [ ] **Step 4: Generate and review the baselines, then run the tests**

Run: `pnpm --filter @tlwb/engine test:visual:update`
Open `packages/engine/test/visual/__baselines__/overlay-selection.png` and `overlay-presence.png` and check: coral outline and nine white handles around the rotated rectangle with two coral guide lines; a dashed lasso with a faint fill over two outlined rectangles, a blue cursor labelled "Ada" with the ellipse outlined in blue, a violet cursor labelled "Claude" followed by an "AI" pill with the diamond outlined in violet.

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/render/overlay.ts packages/engine/test/presence.test.ts packages/engine/test/render/overlay.test.ts packages/engine/test/visual
git commit -m "✨ feat(render): paint remote presence on the overlay"
```

---

### Task 6: SVG export

**Files:**

- Create: `packages/engine/src/export/bounds.ts`
- Create: `packages/engine/src/export/svg.ts`
- Modify: `packages/engine/src/render/shapes.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/export/bounds.test.ts`
- Test: `packages/engine/test/export/svg.test.ts`

**Interfaces:**

- Consumes: `getShapeDrawables` and the module-private rough `generator` in `src/render/shapes.ts`; `getFreehandPath`; `fontString`, `LINE_HEIGHT`, `textAnchorX`, `textLines`, `DEFAULT_FONTS`; `selectionBounds`, `expandRect`; the visual `shapesScene`, `freehandScene`, `textScene`.
- Produces:
  - `EXPORT_MARGIN = 16` (world units)
  - `selectExportElements(elements: readonly BoardElement[], ids?: readonly ElementId[]): BoardElement[]` (all when `ids` is absent or empty, else the listed ones in scene order)
  - `exportBounds(elements: readonly BoardElement[]): Rect` (union bounds plus margin; `{ x: 0, y: 0, width: 1, height: 1 }` when empty)
  - `getShapeSvgPaths(element: SketchyElement): PathInfo[]` (rough.js `PathInfo`: `d`, `stroke`, `strokeWidth`, `fill?`)
  - `interface SvgExportOptions { ids?: readonly ElementId[]; background?: string; fonts?: FontConfig; resolveImageUrl?: (assetHash: string) => string | null }`
  - `exportSceneSvg(elements: readonly BoardElement[], options?: SvgExportOptions): string`

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/export/bounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { exportBounds, selectExportElements } from '../../src/export/bounds'
import { createElement } from '../../src/model/create'

const a = createElement('rectangle', {
  id: 'a',
  index: 'a0',
  x: 10,
  y: 20,
  width: 100,
  height: 50,
})
const b = createElement('ellipse', {
  id: 'b',
  index: 'a1',
  x: 200,
  y: 0,
  width: 40,
  height: 40,
})

describe('selectExportElements', () => {
  it('returns everything for an absent or empty id list', () => {
    expect(selectExportElements([a, b])).toEqual([a, b])
    expect(selectExportElements([a, b], [])).toEqual([a, b])
  })

  it('keeps only the listed ids, in scene order', () => {
    expect(selectExportElements([a, b], ['b', 'a', 'zzz'])).toEqual([a, b])
    expect(selectExportElements([a, b], ['b'])).toEqual([b])
  })
})

describe('exportBounds', () => {
  it('wraps the union of the elements with the margin', () => {
    expect(exportBounds([a, b])).toEqual({
      x: -6,
      y: -16,
      width: 262,
      height: 82,
    })
  })

  it('falls back to a one by one rect for an empty scene', () => {
    expect(exportBounds([])).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})
```

Create `packages/engine/test/export/svg.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { exportSceneSvg } from '../../src/export/svg'
import { createElement } from '../../src/model/create'
import { freehandScene, shapesScene, textScene } from '../visual/scenes'

const FONTS = { hand: 'Caveat', ui: 'Inter' }

describe('exportSceneSvg', () => {
  it('matches the shapes snapshot', async () => {
    await expect(
      exportSceneSvg(shapesScene(), { fonts: FONTS }),
    ).toMatchFileSnapshot('./__snapshots__/shapes.svg')
  })

  it('matches the freehand snapshot', async () => {
    await expect(
      exportSceneSvg(freehandScene(), { fonts: FONTS }),
    ).toMatchFileSnapshot('./__snapshots__/freehand.svg')
  })

  it('matches the text snapshot', async () => {
    await expect(
      exportSceneSvg(textScene(), { fonts: FONTS }),
    ).toMatchFileSnapshot('./__snapshots__/text.svg')
  })

  it('frames the export on the element bounds plus the margin', () => {
    const svg = exportSceneSvg([
      createElement('rectangle', {
        id: 'r',
        index: 'a0',
        seed: 1,
        x: 100,
        y: 50,
        width: 200,
        height: 100,
      }),
    ])
    expect(svg).toContain('viewBox="84 34 232 132"')
    expect(svg).toContain('width="232" height="132"')
    expect(svg).toContain('<rect x="84" y="34" width="232" height="132" fill="#FFFFFF"/>')
  })

  it('exports an empty board as a one by one background', () => {
    expect(exportSceneSvg([], { background: '#ABCDEF' })).toContain(
      '<rect x="0" y="0" width="1" height="1" fill="#ABCDEF"/>',
    )
  })

  it('exports only the requested ids', () => {
    const svg = exportSceneSvg(shapesScene().slice(0, 2), {
      ids: ['rect-2'],
    })
    expect(svg).toContain('#C0392B')
    expect((svg.match(/<g /g) ?? []).length).toBe(1)
  })

  it('escapes text content and dashes dashed strokes', () => {
    const svg = exportSceneSvg(
      [
        createElement('text', {
          id: 't',
          index: 'a0',
          width: 100,
          height: 25,
          text: 'a < b & "c"',
          fontSize: 20,
        }),
        createElement('line', {
          id: 'l',
          index: 'a1',
          seed: 3,
          width: 100,
          height: 0,
          strokeStyle: 'dashed',
          strokeWidth: 2,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        }),
      ],
      { fonts: FONTS },
    )
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;')
    expect(svg).toContain('font-family="Caveat"')
    expect(svg).toContain('stroke-dasharray="8 8"')
  })

  it('rotates around the element center and carries the opacity', () => {
    const svg = exportSceneSvg([
      createElement('rectangle', {
        id: 'r',
        index: 'a0',
        seed: 1,
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        angle: Math.PI / 2,
        opacity: 0.5,
      }),
    ])
    expect(svg).toContain(
      '<g transform="translate(50 25) rotate(90) translate(-50 -25)" opacity="0.5">',
    )
  })

  it('embeds images through the url resolver and omits unresolved ones', () => {
    const image = createElement('image', {
      id: 'i',
      index: 'a0',
      width: 40,
      height: 30,
      assetHash: 'abc',
    })
    expect(exportSceneSvg([image])).not.toContain('<image')
    expect(
      exportSceneSvg([image], {
        resolveImageUrl: (hash) => `data:image/png;base64,${hash}`,
      }),
    ).toContain(
      '<image href="data:image/png;base64,abc" width="40" height="30" preserveAspectRatio="none"/>',
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/export`
Expected: FAIL, the export modules do not exist.

- [ ] **Step 3: Implement the export bounds, the rough paths, and the SVG builder**

Create `packages/engine/src/export/bounds.ts`:

```ts
import { expandRect, type Rect } from '../geometry/bounds'
import type { BoardElement, ElementId } from '../model/element'
import { selectionBounds } from '../selection'

/** World units of white space around an exported scene. */
export const EXPORT_MARGIN = 16

/** All elements when `ids` is absent or empty, else the listed ones in scene order. */
export function selectExportElements(
  elements: readonly BoardElement[],
  ids?: readonly ElementId[],
): BoardElement[] {
  if (!ids || ids.length === 0) {
    return [...elements]
  }
  const wanted = new Set(ids)
  return elements.filter((element) => wanted.has(element.id))
}

/** Union of the element bounds plus the margin; one pixel when empty. */
export function exportBounds(elements: readonly BoardElement[]): Rect {
  const bounds = selectionBounds(
    elements,
    elements.map((element) => element.id),
  )
  if (!bounds) {
    return { x: 0, y: 0, width: 1, height: 1 }
  }
  return expandRect(bounds, EXPORT_MARGIN)
}
```

In `packages/engine/src/render/shapes.ts`, change the first import to `import type { Drawable, Options, PathInfo } from 'roughjs/bin/core'` and add after `getShapeDrawables`:

```ts
/**
 * The same drawables as SVG path data, for export. rough.js emits one
 * path per operation set: a fill path (stroke 'none') and a stroke path
 * (fill 'none'), so a consumer can address them separately.
 */
export function getShapeSvgPaths(element: SketchyElement): PathInfo[] {
  return getShapeDrawables(element).flatMap((drawable) =>
    generator.toPaths(drawable),
  )
}
```

Create `packages/engine/src/export/svg.ts`:

```ts
import type {
  BoardElement,
  ElementId,
  ImageElement,
  TextElement,
} from '../model/element'
import { getFreehandPath } from '../render/freehand'
import { getShapeSvgPaths } from '../render/shapes'
import {
  DEFAULT_FONTS,
  type FontConfig,
  LINE_HEIGHT,
  textAnchorX,
  textLines,
} from '../render/text'
import { exportBounds, selectExportElements } from './bounds'

export interface SvgExportOptions {
  /** Empty or absent exports the whole board. */
  ids?: readonly ElementId[]
  background?: string
  fonts?: FontConfig
  /** An href for the image (data or content URL); null omits it. */
  resolveImageUrl?: (assetHash: string) => string | null
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const noUrl = (): null => null

/**
 * Builds an SVG document from a scene without touching the DOM. Shapes
 * reuse the scene's rough.js drawables and seeds, so the file is the
 * board as drawn. Fonts are named, not embedded.
 */
export function exportSceneSvg(
  elements: readonly BoardElement[],
  options: SvgExportOptions = {},
): string {
  const {
    background = '#FFFFFF',
    fonts = DEFAULT_FONTS,
    resolveImageUrl = noUrl,
  } = options
  const chosen = selectExportElements(elements, options.ids)
  const bounds = exportBounds(chosen)
  const width = fmt(bounds.width)
  const height = fmt(bounds.height)
  const parts = [
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="${fmt(bounds.x)} ${fmt(bounds.y)} ${width} ${height}">`,
    `<rect x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${width}" height="${height}" fill="${escapeXml(background)}"/>`,
  ]
  for (const element of chosen) {
    if (element.opacity === 0) {
      continue
    }
    const inner = elementSvg(element, fonts, resolveImageUrl)
    if (inner === '') {
      continue
    }
    const opacity =
      element.opacity === 1 ? '' : ` opacity="${fmt(element.opacity)}"`
    parts.push(
      `<g transform="${transformOf(element)}"${opacity}>${inner}</g>`,
    )
  }
  parts.push('</svg>')
  return parts.join('\n')
}

/** Two decimals, no trailing zeros: stable snapshots, small files. */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Same pivot as the canvas renderer: rotate around the frame center. */
function transformOf(element: BoardElement): string {
  if (element.angle === 0) {
    return `translate(${fmt(element.x)} ${fmt(element.y)})`
  }
  const cx = element.x + element.width / 2
  const cy = element.y + element.height / 2
  const degrees = (element.angle * 180) / Math.PI
  return `translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(degrees)}) translate(${fmt(-element.width / 2)} ${fmt(-element.height / 2)})`
}

function elementSvg(
  element: BoardElement,
  fonts: FontConfig,
  resolveImageUrl: (assetHash: string) => string | null,
): string {
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'line':
    case 'arrow': {
      const dash =
        element.strokeStyle === 'dashed'
          ? ` stroke-dasharray="${fmt(element.strokeWidth * 4)} ${fmt(element.strokeWidth * 4)}"`
          : ''
      return getShapeSvgPaths(element)
        .map((path) => {
          const stroked = path.stroke !== 'none'
          return `<path d="${path.d}" fill="${escapeXml(path.fill ?? 'none')}" stroke="${escapeXml(path.stroke)}" stroke-width="${fmt(path.strokeWidth)}"${stroked ? dash : ''}/>`
        })
        .join('')
    }
    case 'draw': {
      const d = getFreehandPath(element)
      return d === ''
        ? ''
        : `<path d="${d}" fill="${escapeXml(element.strokeColor)}"/>`
    }
    case 'text':
      return textSvg(element, fonts)
    case 'image':
      return imageSvg(element, resolveImageUrl)
  }
}

const TEXT_ANCHORS = { left: 'start', center: 'middle', right: 'end' } as const

function textSvg(element: TextElement, fonts: FontConfig): string {
  const anchorX = fmt(textAnchorX(element))
  const family = escapeXml(fonts[element.fontFamily])
  const fill = escapeXml(element.strokeColor)
  return textLines(element)
    .map(
      (line, row) =>
        `<text x="${anchorX}" y="${fmt(row * element.fontSize * LINE_HEIGHT)}" font-family="${family}" font-size="${fmt(element.fontSize)}" fill="${fill}" text-anchor="${TEXT_ANCHORS[element.textAlign]}" dominant-baseline="text-before-edge">${escapeXml(line)}</text>`,
    )
    .join('')
}

function imageSvg(
  element: ImageElement,
  resolveImageUrl: (assetHash: string) => string | null,
): string {
  const url = resolveImageUrl(element.assetHash)
  if (url === null) {
    return ''
  }
  return `<image href="${escapeXml(url)}" width="${fmt(element.width)}" height="${fmt(element.height)}" preserveAspectRatio="none"/>`
}
```

In `packages/engine/src/index.ts`, add:

```ts
export { EXPORT_MARGIN, exportBounds, selectExportElements } from './export/bounds'
export type { SvgExportOptions } from './export/svg'
export { exportSceneSvg } from './export/svg'
export { getShapeDrawables, getShapeSvgPaths } from './render/shapes'
```

(replace the existing `getShapeDrawables` export line with the combined one).

- [ ] **Step 4: Run the tests, review the snapshots, run again**

Run: `pnpm --filter @tlwb/engine test -- test/export`
Expected: PASS; the first run writes `test/export/__snapshots__/shapes.svg`, `freehand.svg`, `text.svg`. Open each in a browser and check it looks like the matching PNG baseline in `test/visual/__baselines__` (sketchy outlines, dashed red rectangle, rotated translucent rectangle; the freehand stroke; two text blocks, the second centered).

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/export packages/engine/src/render/shapes.ts packages/engine/src/index.ts packages/engine/test/export
git commit -m "✨ feat(export): build an SVG document from a scene"
```

---

### Task 7: PNG export

**Files:**

- Create: `packages/engine/src/export/png.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/export/png.test.ts`

**Interfaces:**

- Consumes: `renderScene`, `ImageResolver`; `exportBounds`, `selectExportElements`.
- Produces:
  - `interface PngExportOptions { ids?: readonly ElementId[]; background?: string; fonts?: FontConfig; resolveImage?: ImageResolver; scale?: number }`
  - `exportScenePng(elements: readonly BoardElement[], options: PngExportOptions, createCanvas: () => HTMLCanvasElement): Promise<Blob>` (offscreen canvas painted by `renderScene` with a camera framing `exportBounds`, `devicePixelRatio = scale`, encoded by `canvas.toBlob`)

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/export/png.test.ts`:

```ts
import { type Canvas, createCanvas, loadImage } from '@napi-rs/canvas'
import pixelmatch from 'pixelmatch'
import { describe, expect, it } from 'vitest'
import { exportBounds } from '../../src/export/bounds'
import { exportScenePng } from '../../src/export/png'
import { createElement } from '../../src/model/create'
import { renderScene } from '../../src/render/scene'
import { shapesScene } from '../visual/scenes'

const FONTS = { hand: 'Caveat', ui: 'Caveat' }

/** A napi canvas with the browser's `toBlob`, which napi lacks. */
function canvasFactory(): () => HTMLCanvasElement {
  return () => {
    const canvas = createCanvas(1, 1)
    return Object.assign(canvas, {
      toBlob(callback: (blob: Blob | null) => void, type?: string) {
        callback(new Blob([canvas.toBuffer('image/png')], { type }))
      },
    }) as unknown as HTMLCanvasElement
  }
}

async function decode(blob: Blob): Promise<Canvas> {
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
  const canvas = createCanvas(image.width, image.height)
  canvas.getContext('2d').drawImage(image, 0, 0)
  return canvas
}

describe('exportScenePng', () => {
  it('returns a PNG blob framed on the element bounds plus the margin', async () => {
    const blob = await exportScenePng(
      [
        createElement('rectangle', {
          id: 'r',
          index: 'a0',
          seed: 1,
          x: 100,
          y: 50,
          width: 200,
          height: 100,
        }),
      ],
      { fonts: FONTS },
      canvasFactory(),
    )
    expect(blob.type).toBe('image/png')
    const canvas = await decode(blob)
    expect(canvas.width).toBe(232)
    expect(canvas.height).toBe(132)
  })

  it('scales the backing store by the scale option', async () => {
    const blob = await exportScenePng(
      shapesScene(),
      { fonts: FONTS, scale: 2 },
      canvasFactory(),
    )
    const canvas = await decode(blob)
    const bounds = exportBounds(shapesScene())
    expect(canvas.width).toBe(Math.ceil(bounds.width) * 2)
    expect(canvas.height).toBe(Math.ceil(bounds.height) * 2)
  })

  it('exports an empty board as a one by one background pixel', async () => {
    const blob = await exportScenePng(
      [],
      { background: '#FF0000' },
      canvasFactory(),
    )
    const canvas = await decode(blob)
    expect(canvas.width).toBe(1)
    expect(
      Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data),
    ).toEqual([255, 0, 0, 255])
  })

  it('produces the same pixels as the scene renderer on the same frame', async () => {
    const elements = shapesScene()
    const bounds = exportBounds(elements)
    const width = Math.ceil(bounds.width)
    const height = Math.ceil(bounds.height)
    const reference = createCanvas(width, height)
    renderScene(reference as unknown as HTMLCanvasElement, {
      elements,
      camera: { x: bounds.x, y: bounds.y, zoom: 1 },
      viewport: { width, height },
      fonts: FONTS,
    })
    const exported = await decode(
      await exportScenePng(elements, { fonts: FONTS }, canvasFactory()),
    )
    const mismatched = pixelmatch(
      exported.getContext('2d').getImageData(0, 0, width, height).data,
      reference.getContext('2d').getImageData(0, 0, width, height).data,
      undefined,
      width,
      height,
      { threshold: 0 },
    )
    expect(mismatched).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/export/png.test.ts`
Expected: FAIL, `png.ts` does not exist.

- [ ] **Step 3: Implement the PNG export**

Create `packages/engine/src/export/png.ts`:

```ts
import type { BoardElement, ElementId } from '../model/element'
import { type ImageResolver, renderScene } from '../render/scene'
import type { FontConfig } from '../render/text'
import { exportBounds, selectExportElements } from './bounds'

export interface PngExportOptions {
  /** Empty or absent exports the whole board. */
  ids?: readonly ElementId[]
  background?: string
  fonts?: FontConfig
  resolveImage?: ImageResolver
  /** Backing store pixels per world unit; 2 for a retina export. */
  scale?: number
}

/**
 * Rasterizes a scene through the scene renderer on an offscreen canvas,
 * framed on the element bounds plus the export margin, and encodes it
 * as PNG. `createCanvas` comes from the editor environment so this
 * stays testable without a DOM.
 */
export function exportScenePng(
  elements: readonly BoardElement[],
  options: PngExportOptions,
  createCanvas: () => HTMLCanvasElement,
): Promise<Blob> {
  const chosen = selectExportElements(elements, options.ids)
  const bounds = exportBounds(chosen)
  const canvas = createCanvas()
  renderScene(canvas, {
    elements: chosen,
    camera: { x: bounds.x, y: bounds.y, zoom: 1 },
    viewport: {
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height),
    },
    devicePixelRatio: options.scale ?? 1,
    fonts: options.fonts,
    resolveImage: options.resolveImage,
    background: options.background,
  })
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('PNG encoding failed'))
      }
    }, 'image/png')
  })
}
```

In `packages/engine/src/index.ts`, add:

```ts
export type { PngExportOptions } from './export/png'
export { exportScenePng } from './export/png'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test -- test/export`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/export/png.ts packages/engine/src/index.ts packages/engine/test/export/png.test.ts
git commit -m "✨ feat(export): rasterize a scene to PNG"
```

---
### Task 8: The editor shell: canvases, state, and camera

**Files:**

- Create: `packages/engine/src/editor/environment.ts`
- Create: `packages/engine/src/editor/types.ts`
- Create: `packages/engine/src/editor/editor.ts`
- Create: `packages/engine/test/editor/fakeDom.ts`
- Create: `packages/engine/test/editor/harness.ts`
- Test: `packages/engine/test/editor/editor.test.ts`

**Interfaces:**

- Consumes: `createInteractionController`, `createRenderer` (with the Task 3 `resize`), `createFrameScheduler`, `renderOverlay`, `sanitizePeers`, `zoomCamera`, `clampZoom`, `selectionBounds`, `getElementBounds`.
- Produces:
  - `interface EditorEnvironment { createCanvas(): HTMLCanvasElement; observeSize(container: HTMLElement, callback: (width: number, height: number) => void): () => void; observePixelRatio(callback: (ratio: number) => void): () => void; getPixelRatio(): number; keyboardTarget: EventTarget; requestFrame: FrameRequester }`
  - `resolveEnvironment(overrides?: Partial<EditorEnvironment>): EditorEnvironment` (browser defaults)
  - `type EditorAction = KeyboardAction`
  - `interface EditorOptions` (spec section 3 plus `environment?: Partial<EditorEnvironment>`)
  - `interface EditorState { activeTool: ToolType; selectedIds: ElementId[]; camera: Camera; gesture: GestureKind; readOnly: boolean; canUndo: boolean; canRedo: boolean }`
  - `interface Editor` with, in this task: `getState`, `subscribe`, `setActiveTool`, `setSelectedIds`, `setDefaults`, `setCamera`, `zoomTo(zoom, screenAnchor?)`, `zoomToFit(ids?)`, `worldToScreen`, `screenToWorld`, `getElementScreenRect`, `setPresence`, `destroy`. Later tasks append `execute`, `updateSelection`, `undo`, `redo`, `commitText`, `setReadOnly`, `exportPng`, `exportSvg`.
  - `createEditor(options: EditorOptions): Editor`
  - Test fakes: `FakeNode` (listeners, `dispatch(type, init)`, `listenerCount()`), `FakeCanvas` (napi canvas behind `width`/`height`/`getContext`, `style`, `captured` pointer ids, `toBlob`), `FakeContainer` (`children`, `style`, `rect`, `getBoundingClientRect`), `fakeEnvironment()` (`frames`, `flush()`, `keyboard: FakeNode`, `resize(width, height)`, `setPixelRatio(ratio)`), `mountEditor(options?)` returning `{ editor, store, container, env, scene, overlay, pointer, key, flush }`.

- [ ] **Step 1: Write the fakes and the harness**

Create `packages/engine/test/editor/fakeDom.ts`:

```ts
import { type Canvas, createCanvas } from '@napi-rs/canvas'
import type { EditorEnvironment } from '../../src/editor/environment'

type Listener = (event: FakeEvent) => void

export interface FakeEvent {
  type: string
  target: unknown
  defaultPrevented: boolean
  preventDefault(): void
  [key: string]: unknown
}

/** The slice of EventTarget the editor binds to, with a dispatcher. */
export class FakeNode {
  readonly listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  listenerCount(): number {
    let count = 0
    for (const set of this.listeners.values()) {
      count += set.size
    }
    return count
  }

  dispatch(type: string, init: Record<string, unknown> = {}): FakeEvent {
    const event: FakeEvent = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true
      },
      ...init,
    }
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event)
    }
    return event
  }
}

/** A napi canvas wearing the DOM surface the editor touches. */
export class FakeCanvas extends FakeNode {
  readonly napi: Canvas = createCanvas(1, 1)
  readonly style: Record<string, string> = {}
  readonly captured: number[] = []

  get width(): number {
    return this.napi.width
  }

  set width(value: number) {
    this.napi.width = value
  }

  get height(): number {
    return this.napi.height
  }

  set height(value: number) {
    this.napi.height = value
  }

  getContext(_type: '2d'): CanvasRenderingContext2D {
    return this.napi.getContext('2d') as unknown as CanvasRenderingContext2D
  }

  setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId)
  }

  toBlob(callback: (blob: Blob | null) => void, type = 'image/png'): void {
    callback(new Blob([this.napi.toBuffer('image/png')], { type }))
  }

  rgbaAt(x: number, y: number): number[] {
    return Array.from(
      this.napi.getContext('2d').getImageData(x, y, 1, 1).data,
    )
  }
}

export class FakeContainer extends FakeNode {
  readonly children: FakeCanvas[] = []
  readonly style: Record<string, string> = {}
  rect = { left: 10, top: 20, width: 400, height: 300 }

  appendChild(child: FakeCanvas): void {
    this.children.push(child)
  }

  removeChild(child: FakeCanvas): void {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
    }
  }

  getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.rect
    return {
      left,
      top,
      width,
      height,
      x: left,
      y: top,
      right: left + width,
      bottom: top + height,
    } as DOMRect
  }
}

export interface FakeEnvironment extends EditorEnvironment {
  frames: (() => void)[]
  flush(): void
  keyboard: FakeNode
  resize(width: number, height: number): void
  setPixelRatio(ratio: number): void
}

export function fakeEnvironment(): FakeEnvironment {
  let sizeListener: ((width: number, height: number) => void) | null = null
  let ratioListener: ((ratio: number) => void) | null = null
  let ratio = 1
  const keyboard = new FakeNode()
  const env: FakeEnvironment = {
    frames: [],
    keyboard,
    createCanvas: () => new FakeCanvas() as unknown as HTMLCanvasElement,
    observeSize: (container, callback) => {
      sizeListener = callback
      const { width, height } = (container as unknown as FakeContainer).rect
      callback(width, height)
      return () => {
        sizeListener = null
      }
    },
    observePixelRatio: (callback) => {
      ratioListener = callback
      return () => {
        ratioListener = null
      }
    },
    getPixelRatio: () => ratio,
    keyboardTarget: keyboard as unknown as EventTarget,
    requestFrame: (callback) => {
      env.frames.push(callback)
    },
    flush: () => {
      for (const frame of env.frames.splice(0)) {
        frame()
      }
    },
    resize: (width, height) => {
      sizeListener?.(width, height)
    },
    setPixelRatio: (next) => {
      ratio = next
      ratioListener?.(next)
    },
  }
  return env
}
```

Create `packages/engine/test/editor/harness.ts`:

```ts
import { createEditor } from '../../src/editor/editor'
import type { Editor, EditorOptions } from '../../src/editor/types'
import { InMemoryBoardStore } from '../../src/store/memory'
import {
  FakeCanvas,
  FakeContainer,
  type FakeEnvironment,
  type FakeEvent,
  fakeEnvironment,
} from './fakeDom'

export interface Mounted {
  editor: Editor
  store: InMemoryBoardStore
  container: FakeContainer
  env: FakeEnvironment
  scene: FakeCanvas
  overlay: FakeCanvas
  /** Dispatches a pointer event at container-relative CSS pixels. */
  pointer(
    type: string,
    x: number,
    y: number,
    init?: Record<string, unknown>,
  ): FakeEvent
  key(
    type: 'keydown' | 'keyup',
    key: string,
    init?: Record<string, unknown>,
  ): FakeEvent
  flush(): void
}

/** Container at (10, 20), 400 by 300 CSS pixels, pixel ratio 1. */
export function mountEditor(
  options: Partial<Omit<EditorOptions, 'container' | 'store'>> = {},
): Mounted {
  const store = new InMemoryBoardStore()
  const container = new FakeContainer()
  const env = fakeEnvironment()
  const editor = createEditor({
    container: container as unknown as HTMLElement,
    store,
    environment: env,
    fonts: { hand: 'Caveat', ui: 'Caveat' },
    ...options,
  })
  const [scene, overlay] = container.children
  if (!scene || !overlay) {
    throw new Error('createEditor did not mount two canvases')
  }
  return {
    editor,
    store,
    container,
    env,
    scene,
    overlay,
    pointer: (type, x, y, init = {}) =>
      overlay.dispatch(type, {
        clientX: x + container.rect.left,
        clientY: y + container.rect.top,
        button: 0,
        buttons: 1,
        pointerId: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        deltaX: 0,
        deltaY: 0,
        ...init,
      }),
    key: (type, key, init = {}) =>
      env.keyboard.dispatch(type, {
        key,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        target: null,
        ...init,
      }),
    flush: env.flush,
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/engine/test/editor/editor.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { MAX_ZOOM } from '../../src/camera'
import { createEditor } from '../../src/editor/editor'
import { createElement } from '../../src/model/create'
import { InMemoryBoardStore } from '../../src/store/memory'
import { FakeCanvas, FakeContainer, fakeEnvironment } from './fakeDom'
import { mountEditor } from './harness'

const box = (id: string, x: number, y: number) =>
  createElement('rectangle', {
    id,
    index: `a${id}`,
    seed: 1,
    x,
    y,
    width: 50,
    height: 50,
  })

describe('createEditor mounting', () => {
  it('appends a scene and an overlay canvas sized from the container', () => {
    const { container, scene, overlay, flush } = mountEditor()
    expect(container.children).toHaveLength(2)
    expect(container.style.position).toBe('relative')
    expect(scene.style.position).toBe('absolute')
    expect(overlay.style.touchAction).toBe('none')
    flush()
    expect(scene.width).toBe(400)
    expect(scene.height).toBe(300)
    expect(overlay.width).toBe(400)
  })

  it('follows container resizes and pixel ratio changes', () => {
    const { scene, overlay, env, flush } = mountEditor()
    flush()
    env.resize(800, 600)
    flush()
    expect(scene.width).toBe(800)
    expect(overlay.height).toBe(600)
    env.setPixelRatio(2)
    flush()
    expect(scene.width).toBe(1600)
    expect(overlay.width).toBe(1600)
  })

  it('throws when the canvas has no 2D context', () => {
    const env = fakeEnvironment()
    env.createCanvas = () => {
      const canvas = new FakeCanvas()
      canvas.getContext = () => null as unknown as CanvasRenderingContext2D
      return canvas as unknown as HTMLCanvasElement
    }
    expect(() =>
      createEditor({
        container: new FakeContainer() as unknown as HTMLElement,
        store: new InMemoryBoardStore(),
        environment: env,
      }),
    ).toThrow(/2D/)
  })
})

describe('editor state', () => {
  it('starts on the select tool with nothing selected', () => {
    const { editor } = mountEditor()
    expect(editor.getState()).toEqual({
      activeTool: 'select',
      selectedIds: [],
      camera: { x: 0, y: 0, zoom: 1 },
      gesture: 'idle',
      readOnly: false,
      canUndo: false,
      canRedo: false,
    })
    expect(editor.getState()).toBe(editor.getState())
  })

  it('notifies once per change and not for a no-op', () => {
    const { editor, store } = mountEditor()
    const listener = vi.fn()
    editor.subscribe(listener)
    editor.setActiveTool('rectangle')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(editor.getState().activeTool).toBe('rectangle')
    editor.setActiveTool('rectangle')
    expect(listener).toHaveBeenCalledTimes(1)
    store.applyChanges([{ kind: 'create', element: box('a', 0, 0) }])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(editor.getState().canUndo).toBe(true)
  })

  it('reflects the selection and unsubscribes cleanly', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 0, 0) }])
    const listener = vi.fn()
    const stop = editor.subscribe(listener)
    editor.setSelectedIds(['a'])
    expect(editor.getState().selectedIds).toEqual(['a'])
    stop()
    editor.setSelectedIds([])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('editor camera', () => {
  it('clamps the zoom and notifies', () => {
    const { editor } = mountEditor()
    const listener = vi.fn()
    editor.subscribe(listener)
    editor.setCamera({ x: 10, y: 20, zoom: 1000 })
    expect(editor.getState().camera).toEqual({ x: 10, y: 20, zoom: MAX_ZOOM })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('zooms around the given anchor, defaulting to the viewport center', () => {
    const { editor } = mountEditor()
    editor.zoomTo(2, { x: 100, y: 100 })
    expect(editor.screenToWorld({ x: 100, y: 100 })).toEqual({ x: 100, y: 100 })
    expect(editor.getState().camera.zoom).toBe(2)
    editor.setCamera({ x: 0, y: 0, zoom: 1 })
    editor.zoomTo(4)
    expect(editor.screenToWorld({ x: 200, y: 150 })).toEqual({ x: 200, y: 150 })
  })

  it('fits the whole board, or the given ids, with padding', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      { kind: 'create', element: box('a', 0, 0) },
      { kind: 'create', element: box('b', 950, 550) },
    ])
    editor.zoomToFit()
    const { camera } = editor.getState()
    const center = editor.worldToScreen({ x: 500, y: 300 })
    expect(center.x).toBeCloseTo(200, 6)
    expect(center.y).toBeCloseTo(150, 6)
    expect(camera.zoom).toBeCloseTo((400 - 96) / 1000, 5)
    editor.zoomToFit(['a'])
    const single = editor.worldToScreen({ x: 25, y: 25 })
    expect(single.x).toBeCloseTo(200, 6)
    expect(single.y).toBeCloseTo(150, 6)
  })

  it('resets to the origin when there is nothing to fit', () => {
    const { editor } = mountEditor()
    editor.setCamera({ x: 500, y: 500, zoom: 3 })
    editor.zoomToFit()
    expect(editor.getState().camera).toEqual({ x: -200, y: -150, zoom: 1 })
  })

  it('projects an element frame to screen pixels', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 100, 100) }])
    editor.setCamera({ x: 50, y: 50, zoom: 2 })
    expect(editor.getElementScreenRect('a')).toEqual({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    })
    expect(editor.getElementScreenRect('missing')).toBeNull()
  })
})

describe('editor presence', () => {
  it('paints peers on the overlay only', () => {
    const { editor, overlay, env, flush } = mountEditor()
    flush()
    editor.setPresence([
      {
        id: 'p',
        name: 'Ada',
        color: '#00AA00',
        cursor: { x: 100, y: 100 },
        selectedIds: [],
        isAgent: false,
      },
      { id: 'broken' } as never,
    ])
    editor.setPresence([
      {
        id: 'p',
        name: 'Ada',
        color: '#00AA00',
        cursor: { x: 100, y: 100 },
        selectedIds: [],
        isAgent: false,
      },
    ])
    expect(env.frames).toHaveLength(1)
    flush()
    expect(overlay.rgbaAt(102, 108)).toEqual([0, 170, 0, 255])
  })
})

describe('editor destroy', () => {
  it('removes the canvases and observers, then ignores every call', () => {
    const { editor, container, env, store } = mountEditor()
    editor.setActiveTool('hand')
    const before = editor.getState()
    editor.destroy()
    editor.destroy()
    expect(container.children).toHaveLength(0)
    expect(env.keyboard.listenerCount()).toBe(0)
    env.frames.length = 0
    store.applyChanges([{ kind: 'create', element: box('a', 0, 0) }])
    editor.setActiveTool('rectangle')
    editor.setCamera({ x: 1, y: 1, zoom: 1 })
    expect(env.frames).toHaveLength(0)
    expect(editor.getState()).toBe(before)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/editor`
Expected: FAIL, `src/editor/editor.ts` does not exist.

- [ ] **Step 4: Implement the environment, the types, and the editor shell**

Create `packages/engine/src/editor/environment.ts`:

```ts
import { defaultRequestFrame, type FrameRequester } from '../render/schedule'

/**
 * Everything the editor needs from the browser, behind one seam. The
 * defaults reach for the DOM; tests hand in fakes. Nothing else in the
 * engine touches `document` or `window`.
 */
export interface EditorEnvironment {
  createCanvas(): HTMLCanvasElement
  /** Reports the container's CSS size now and after every change. */
  observeSize(
    container: HTMLElement,
    callback: (width: number, height: number) => void,
  ): () => void
  /** Reports each change of the device pixel ratio (monitor switch). */
  observePixelRatio(callback: (ratio: number) => void): () => void
  getPixelRatio(): number
  /** Where keyboard events are listened to; `window` in a browser. */
  keyboardTarget: EventTarget
  requestFrame: FrameRequester
}

export function resolveEnvironment(
  overrides: Partial<EditorEnvironment> = {},
): EditorEnvironment {
  return {
    createCanvas: () => document.createElement('canvas'),
    observeSize: observeSizeWithResizeObserver,
    observePixelRatio: observePixelRatioWithMatchMedia,
    getPixelRatio: () => window.devicePixelRatio || 1,
    // `globalThis` is `window` in a browser; tests always override it.
    keyboardTarget: globalThis as unknown as EventTarget,
    requestFrame: defaultRequestFrame,
    ...overrides,
  }
}

function observeSizeWithResizeObserver(
  container: HTMLElement,
  callback: (width: number, height: number) => void,
): () => void {
  const report = (): void => {
    const rect = container.getBoundingClientRect()
    callback(rect.width, rect.height)
  }
  report()
  const observer = new ResizeObserver(() => report())
  observer.observe(container)
  return () => observer.disconnect()
}

/**
 * A media query matching the current ratio fires once when the window
 * moves to a screen with another ratio; it is re-armed for the new one.
 */
function observePixelRatioWithMatchMedia(
  callback: (ratio: number) => void,
): () => void {
  let query: MediaQueryList | null = null
  let stopped = false
  const onChange = (): void => {
    callback(window.devicePixelRatio || 1)
    arm()
  }
  const arm = (): void => {
    if (stopped) {
      return
    }
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    query.addEventListener('change', onChange, { once: true })
  }
  arm()
  return () => {
    stopped = true
    query?.removeEventListener('change', onChange)
  }
}
```

Create `packages/engine/src/editor/types.ts`:

```ts
import type { Camera } from '../camera'
import type { Rect } from '../geometry/bounds'
import type { KeyboardAction } from '../keyboard'
import type { ElementId, ElementProps, Point } from '../model/element'
import type { Peer } from '../presence'
import type { OverlayTheme } from '../render/overlay'
import type { ImageResolver } from '../render/scene'
import type { FontConfig } from '../render/text'
import type { BoardStore } from '../store/types'
import type { GestureKind, PendingImage, ToolType } from '../tools/types'
import type { EditorEnvironment } from './environment'

/**
 * The keyboard table resolves to it and the client chrome (toolbar,
 * contextual panel, overflow menu) dispatches it directly.
 */
export type EditorAction = KeyboardAction

export interface EditorOptions {
  container: HTMLElement
  store: BoardStore
  fonts?: FontConfig
  /** Scene and PNG export. */
  resolveImage?: ImageResolver
  /** SVG export: an href (data or content URL); null omits the image. */
  resolveImageUrl?: (assetHash: string) => string | null
  background?: string
  defaults?: ElementProps
  readOnly?: boolean
  theme?: Partial<OverlayTheme>
  onTextEditRequest?: (id: ElementId) => void
  getPendingImage?: () => PendingImage | null
  /** World position of the local pointer; null when it leaves the canvas. */
  onCursorMove?: (point: Point | null) => void
  /** Browser seam; tests replace it, hosts leave it alone. */
  environment?: Partial<EditorEnvironment>
}

export interface EditorState {
  activeTool: ToolType
  selectedIds: ElementId[]
  camera: Camera
  gesture: GestureKind
  readOnly: boolean
  canUndo: boolean
  canRedo: boolean
}

export interface Editor {
  /** A new object only when something changed; safe for `useSyncExternalStore`. */
  getState(): EditorState
  subscribe(listener: () => void): () => void

  setActiveTool(type: ToolType): void
  setSelectedIds(ids: ElementId[]): void
  /** Merged into the creation defaults (contextual panel writes here). */
  setDefaults(patch: ElementProps): void

  setCamera(camera: Camera): void
  /** Zooms toward the anchor (CSS pixels), the viewport center by default. */
  zoomTo(zoom: number, screenAnchor?: Point): void
  /** Frames the ids, or the whole board; resets to the origin when empty. */
  zoomToFit(ids?: ElementId[]): void
  worldToScreen(point: Point): Point
  screenToWorld(point: Point): Point
  /** Screen rect of the element's bounding box; null for an unknown id. */
  getElementScreenRect(id: ElementId): Rect | null

  /** Replaces the whole peer list; malformed peers are dropped. */
  setPresence(peers: Peer[]): void

  destroy(): void
}
```

Create `packages/engine/src/editor/editor.ts`:

```ts
import {
  type Camera,
  clampZoom,
  screenToWorld,
  worldToScreen,
  zoomCamera,
} from '../camera'
import { getElementBounds } from '../geometry/bounds'
import { createInteractionController } from '../interaction/controller'
import type { ElementId, ElementProps, Point } from '../model/element'
import type { ToolType } from '../tools/types'
import { type Peer, sanitizePeers } from '../presence'
import {
  DEFAULT_OVERLAY_THEME,
  type OverlayTheme,
  renderOverlay,
} from '../render/overlay'
import { createRenderer } from '../render/renderer'
import { createFrameScheduler } from '../render/schedule'
import { selectionBounds } from '../selection'
import { resolveEnvironment } from './environment'
import type { Editor, EditorOptions, EditorState } from './types'

/** CSS pixels kept around a fitted selection on each side. */
const FIT_PADDING = 48

const CANVAS_STYLE = {
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  touchAction: 'none',
} as const

/**
 * The DOM-bound editor: two stacked canvases (scene below, overlay
 * above) in the host's container, the interaction controller behind
 * them, and one immutable state snapshot for the host's UI. Element
 * mutations still go through the injected store.
 */
export function createEditor(options: EditorOptions): Editor {
  const { container, store } = options
  if (
    typeof HTMLElement !== 'undefined' &&
    !(container instanceof HTMLElement)
  ) {
    throw new TypeError('createEditor: container must be an HTMLElement')
  }
  const env = resolveEnvironment(options.environment)
  const theme: OverlayTheme = { ...DEFAULT_OVERLAY_THEME, ...options.theme }
  // Inline style only: a host positioning the container from a
  // stylesheet keeps its own value.
  if (!container.style.position) {
    container.style.position = 'relative'
  }
  const sceneCanvas = env.createCanvas()
  const overlayCanvas = env.createCanvas()
  for (const canvas of [sceneCanvas, overlayCanvas]) {
    Object.assign(canvas.style, CANVAS_STYLE)
    container.appendChild(canvas)
  }
  if (!sceneCanvas.getContext('2d') || !overlayCanvas.getContext('2d')) {
    container.removeChild(overlayCanvas)
    container.removeChild(sceneCanvas)
    throw new Error('createEditor: 2D canvas context unavailable')
  }

  let viewport = { width: 0, height: 0 }
  let pixelRatio = env.getPixelRatio()
  let peers: Peer[] = []
  let destroyed = false
  const readOnly = options.readOnly ?? false

  const renderer = createRenderer({
    canvas: sceneCanvas,
    store,
    width: 0,
    height: 0,
    devicePixelRatio: pixelRatio,
    fonts: options.fonts,
    resolveImage: options.resolveImage,
    background: options.background,
    requestFrame: env.requestFrame,
  })

  const setCamera = (camera: Camera): void => {
    if (destroyed) {
      return
    }
    renderer.setCamera(camera)
    overlay.markDirty()
    refresh()
  }

  const controller = createInteractionController({
    store,
    getCamera: () => renderer.getCamera(),
    setCamera,
    defaults: options.defaults,
    onTextEditRequest: options.onTextEditRequest,
    getPendingImage: options.getPendingImage,
  })

  const overlay = createFrameScheduler(() => {
    renderOverlay(overlayCanvas, {
      elements: store.listElements(),
      snapshot: controller.getSnapshot(),
      camera: renderer.getCamera(),
      viewport,
      devicePixelRatio: pixelRatio,
      peers,
      theme,
    })
  }, env.requestFrame)

  const listeners = new Set<() => void>()
  const compute = (): EditorState => {
    const snapshot = controller.getSnapshot()
    return {
      activeTool: snapshot.activeTool,
      selectedIds: snapshot.selectedIds,
      camera: renderer.getCamera(),
      gesture: snapshot.gesture,
      readOnly,
      canUndo: store.canUndo(),
      canRedo: store.canRedo(),
    }
  }
  let state = compute()
  const refresh = (): void => {
    if (destroyed) {
      return
    }
    const next = compute()
    if (sameState(state, next)) {
      return
    }
    state = next
    for (const listener of listeners) {
      listener()
    }
  }

  const invalidate = (): void => {
    overlay.markDirty()
    refresh()
  }
  const unsubscribeController = controller.subscribe(invalidate)
  const unsubscribeStore = store.subscribe(invalidate)
  const stopSizing = env.observeSize(container, (width, height) => {
    viewport = { width, height }
    renderer.resize(width, height, pixelRatio)
    overlay.markDirty()
  })
  const stopRatio = env.observePixelRatio((ratio) => {
    pixelRatio = ratio
    renderer.resize(viewport.width, viewport.height, ratio)
    overlay.markDirty()
  })

  const fitCamera = (ids?: ElementId[]): Camera => {
    const elements = store.listElements()
    const bounds = selectionBounds(
      elements,
      ids ?? elements.map((element) => element.id),
    )
    if (!bounds || viewport.width === 0 || viewport.height === 0) {
      return { x: -viewport.width / 2, y: -viewport.height / 2, zoom: 1 }
    }
    const zoom = clampZoom(
      Math.min(
        (viewport.width - FIT_PADDING * 2) / Math.max(bounds.width, 1),
        (viewport.height - FIT_PADDING * 2) / Math.max(bounds.height, 1),
      ),
    )
    return {
      x: bounds.x + bounds.width / 2 - viewport.width / (2 * zoom),
      y: bounds.y + bounds.height / 2 - viewport.height / (2 * zoom),
      zoom,
    }
  }

  /** Every mutator is inert after destroy. */
  const alive =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (!destroyed) {
        fn(...args)
      }
    }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setActiveTool: alive((type: ToolType) => controller.setActiveTool(type)),
    setSelectedIds: alive((ids: ElementId[]) => controller.setSelectedIds(ids)),
    setDefaults: alive((patch: ElementProps) => controller.setDefaults(patch)),
    setCamera,
    zoomTo: alive((zoom: number, anchor?: Point) =>
      setCamera(
        zoomCamera(
          renderer.getCamera(),
          anchor ?? { x: viewport.width / 2, y: viewport.height / 2 },
          zoom,
        ),
      ),
    ),
    zoomToFit: alive((ids?: ElementId[]) => setCamera(fitCamera(ids))),
    worldToScreen: (point) => worldToScreen(renderer.getCamera(), point),
    screenToWorld: (point) => screenToWorld(renderer.getCamera(), point),
    getElementScreenRect: (id) => {
      const element = store.getElement(id)
      if (!element) {
        return null
      }
      const bounds = getElementBounds(element)
      const camera = renderer.getCamera()
      const origin = worldToScreen(camera, bounds)
      return {
        x: origin.x,
        y: origin.y,
        width: bounds.width * camera.zoom,
        height: bounds.height * camera.zoom,
      }
    },
    setPresence: alive((next: Peer[]) => {
      peers = sanitizePeers(next)
      overlay.markDirty()
    }),
    destroy: () => {
      if (destroyed) {
        return
      }
      destroyed = true
      stopSizing()
      stopRatio()
      unsubscribeController()
      unsubscribeStore()
      controller.destroy()
      renderer.destroy()
      overlay.destroy()
      container.removeChild(overlayCanvas)
      container.removeChild(sceneCanvas)
      listeners.clear()
    },
  }
}

function sameState(a: EditorState, b: EditorState): boolean {
  return (
    a.activeTool === b.activeTool &&
    a.gesture === b.gesture &&
    a.readOnly === b.readOnly &&
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.camera.x === b.camera.x &&
    a.camera.y === b.camera.y &&
    a.camera.zoom === b.camera.zoom &&
    a.selectedIds.length === b.selectedIds.length &&
    a.selectedIds.every((id, index) => id === b.selectedIds[index])
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test -- test/editor`
Expected: PASS. If `zoomTo` disagrees by floating point, compare with `toBeCloseTo` on both coordinates rather than loosening the implementation.

- [ ] **Step 6: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/editor packages/engine/test/editor
git commit -m "✨ feat(editor): mount two canvases and expose the editor state"
```

---

### Task 9: Pointer, wheel, and cursor binding

**Files:**

- Create: `packages/engine/src/editor/cursor.ts`
- Create: `packages/engine/src/editor/input.ts`
- Modify: `packages/engine/src/editor/editor.ts`
- Test: `packages/engine/test/editor/cursor.test.ts`
- Test: `packages/engine/test/editor/input.test.ts`

**Interfaces:**

- Consumes: `InteractionController` (`pointerDown`, `pointerMove`, `pointerUp`, `cancelGesture`, `handleKey`, `getSnapshot`); `panCamera`, `zoomCamera`, `screenToWorld`; `hitTestHandles`, `hitTestScene`, `HIT_TOLERANCE`.
- Produces:
  - `interface CursorContext { tool: ToolType; gesture: GestureKind; panning: boolean; panReady: boolean; pressed: boolean; handle: HandleKind | null; overSelected: boolean; angle: number }`
  - `cursorFor(context: CursorContext): string`
  - `interface InputHost { store: BoardStore; controller: InteractionController; getCamera(): Camera; setCamera(camera: Camera): void; toScreen(event: { clientX: number; clientY: number }): Point; isReadOnly(): boolean; onDoubleClick(world: Point): void; onCursorMove(point: Point | null): void }`
  - `bindInput(surface: HTMLCanvasElement, keyboardTarget: EventTarget, host: InputHost): () => void` (listeners: `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `pointerleave`, `dblclick`, `wheel` on the surface; `keydown`, `keyup`, `blur` on the keyboard target)

The keyboard listener is bound here because the held space bar is part
of pointer panning; the key routing itself (`handleKey`) is exercised
by Task 10's tests. `onDoubleClick` on the editor's host is a no-op
until Task 11 wires text editing; `isReadOnly` reads the flag Task 12
makes switchable.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/editor/cursor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { type CursorContext, cursorFor } from '../../src/editor/cursor'

const base: CursorContext = {
  tool: 'select',
  gesture: 'idle',
  panning: false,
  panReady: false,
  pressed: false,
  handle: null,
  overSelected: false,
  angle: 0,
}

describe('cursorFor', () => {
  it('shows a hand while panning, whatever the tool', () => {
    expect(cursorFor({ ...base, tool: 'rectangle', panning: true })).toBe(
      'grabbing',
    )
    expect(cursorFor({ ...base, panReady: true })).toBe('grab')
    expect(cursorFor({ ...base, tool: 'hand' })).toBe('grab')
    expect(cursorFor({ ...base, tool: 'hand', pressed: true })).toBe('grabbing')
  })

  it('uses a crosshair for every creation tool', () => {
    for (const tool of [
      'rectangle',
      'ellipse',
      'diamond',
      'arrow',
      'line',
      'draw',
      'text',
      'image',
      'eraser',
    ] as const) {
      expect(cursorFor({ ...base, tool })).toBe('crosshair')
    }
  })

  it('maps resize handles to directional cursors, rotated with the selection', () => {
    expect(cursorFor({ ...base, handle: 'n' })).toBe('ns-resize')
    expect(cursorFor({ ...base, handle: 'e' })).toBe('ew-resize')
    expect(cursorFor({ ...base, handle: 'ne' })).toBe('nesw-resize')
    expect(cursorFor({ ...base, handle: 'se' })).toBe('nwse-resize')
    expect(cursorFor({ ...base, handle: 'n', angle: Math.PI / 2 })).toBe(
      'ew-resize',
    )
    expect(cursorFor({ ...base, handle: 'sw', angle: -Math.PI / 4 })).toBe(
      'ns-resize',
    )
    expect(cursorFor({ ...base, handle: 'rotate' })).toBe('grab')
  })

  it('shows move over a selected element or during a move, default otherwise', () => {
    expect(cursorFor({ ...base, overSelected: true })).toBe('move')
    expect(cursorFor({ ...base, gesture: 'moving' })).toBe('move')
    expect(cursorFor(base)).toBe('default')
  })
})
```

Create `packages/engine/test/editor/input.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/model/create'
import { mountEditor } from './harness'

const box = (id: string, x: number, y: number) =>
  createElement('rectangle', {
    id,
    index: `a${id}`,
    seed: 1,
    x,
    y,
    width: 100,
    height: 100,
  })

describe('pointer binding', () => {
  it('draws a rectangle through pointer events, in container coordinates', () => {
    const { editor, store, pointer, overlay } = mountEditor()
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 10, 10)
    expect(overlay.captured).toEqual([1])
    pointer('pointermove', 110, 60)
    pointer('pointerup', 110, 60)
    expect(store.listElements()[0]).toMatchObject({
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
    })
    expect(editor.getState().activeTool).toBe('select')
  })

  it('projects through the camera', () => {
    const { editor, store, pointer } = mountEditor()
    editor.setCamera({ x: 100, y: 50, zoom: 2 })
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 20, 20)
    pointer('pointermove', 60, 40)
    pointer('pointerup', 60, 40)
    expect(store.listElements()[0]).toMatchObject({
      x: 110,
      y: 60,
      width: 20,
      height: 10,
    })
  })

  it('ignores the right button', () => {
    const { editor, store, pointer, overlay } = mountEditor()
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 10, 10, { button: 2, buttons: 2 })
    pointer('pointermove', 50, 50, { buttons: 2 })
    pointer('pointerup', 50, 50, { button: 2, buttons: 0 })
    expect(store.listElements()).toHaveLength(0)
    expect(overlay.captured).toEqual([])
  })

  it('abandons the gesture on pointercancel', () => {
    const { editor, store, pointer } = mountEditor()
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 10, 10)
    pointer('pointermove', 60, 60)
    expect(store.listElements()).toHaveLength(1)
    pointer('pointercancel', 60, 60)
    expect(store.listElements()).toHaveLength(0)
  })

  it('pans with the middle button without changing the tool', () => {
    const { editor, pointer } = mountEditor()
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 0, 0, { button: 1, buttons: 4 })
    pointer('pointermove', 30, 40, { buttons: 4 })
    pointer('pointerup', 30, 40, { button: 1, buttons: 0 })
    expect(editor.getState().camera).toEqual({ x: -30, y: -40, zoom: 1 })
    expect(editor.getState().activeTool).toBe('rectangle')
  })

  it('pans while the space bar is held, then returns to the tool', () => {
    const { editor, store, pointer, key } = mountEditor()
    editor.setActiveTool('rectangle')
    expect(key('keydown', ' ').defaultPrevented).toBe(true)
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 10, 0)
    pointer('pointerup', 10, 0)
    expect(editor.getState().camera.x).toBe(-10)
    expect(store.listElements()).toHaveLength(0)
    key('keyup', ' ')
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 50, 50)
    pointer('pointerup', 50, 50)
    expect(store.listElements()).toHaveLength(1)
  })

  it('reports the local cursor in world coordinates and null on leave', () => {
    const onCursorMove = vi.fn()
    const { editor, pointer } = mountEditor({ onCursorMove })
    editor.setCamera({ x: 100, y: 100, zoom: 1 })
    pointer('pointermove', 5, 6, { buttons: 0 })
    expect(onCursorMove).toHaveBeenLastCalledWith({ x: 105, y: 106 })
    pointer('pointerleave', 0, 0, { buttons: 0 })
    expect(onCursorMove).toHaveBeenLastCalledWith(null)
  })
})

describe('wheel binding', () => {
  it('zooms around the pointer with a modifier held', () => {
    const { editor, pointer } = mountEditor()
    const before = editor.screenToWorld({ x: 100, y: 80 })
    const event = pointer('wheel', 100, 80, { deltaY: -100, ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(editor.getState().camera.zoom).toBeGreaterThan(1)
    const after = editor.screenToWorld({ x: 100, y: 80 })
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    pointer('wheel', 100, 80, { deltaY: 100, metaKey: true })
    expect(editor.getState().camera.zoom).toBeCloseTo(1, 6)
  })

  it('pans without a modifier', () => {
    const { editor, pointer } = mountEditor()
    const event = pointer('wheel', 0, 0, { deltaX: 10, deltaY: 20 })
    expect(event.defaultPrevented).toBe(true)
    expect(editor.getState().camera).toEqual({ x: 10, y: 20, zoom: 1 })
  })
})

describe('cursor binding', () => {
  it('follows the tool and the hovered handle or element', () => {
    const { editor, store, pointer, overlay } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 100, 100) }])
    pointer('pointermove', 5, 5, { buttons: 0 })
    expect(overlay.style.cursor).toBe('default')
    editor.setActiveTool('hand')
    pointer('pointermove', 5, 5, { buttons: 0 })
    expect(overlay.style.cursor).toBe('grab')
    editor.setActiveTool('rectangle')
    pointer('pointermove', 5, 5, { buttons: 0 })
    expect(overlay.style.cursor).toBe('crosshair')
    editor.setActiveTool('select')
    editor.setSelectedIds(['a'])
    pointer('pointermove', 200, 150, { buttons: 0 })
    expect(overlay.style.cursor).toBe('ew-resize')
    // On the top edge, away from the handles: a hollow rectangle is hit
    // on its outline, exactly where the select tool grabs it.
    pointer('pointermove', 130, 100, { buttons: 0 })
    expect(overlay.style.cursor).toBe('move')
    pointer('pointermove', 20, 20, { buttons: 0 })
    expect(overlay.style.cursor).toBe('default')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/editor/cursor.test.ts test/editor/input.test.ts`
Expected: FAIL, `cursor.ts` and `input.ts` do not exist; the pointer tests find no listeners.

- [ ] **Step 3: Implement the cursor choice and the input binding**

Create `packages/engine/src/editor/cursor.ts`:

```ts
import type { HandleKind } from '../geometry/transform'
import type { GestureKind, ToolType } from '../tools/types'

export interface CursorContext {
  tool: ToolType
  gesture: GestureKind
  /** Temporary pan (space bar or middle button) in progress. */
  panning: boolean
  /** Space bar held, pan about to start on press. */
  panReady: boolean
  /** Primary button held. */
  pressed: boolean
  handle: HandleKind | null
  overSelected: boolean
  /** Angle of the single selected element, so handle cursors turn with it. */
  angle: number
}

const CREATION_TOOLS: ReadonlySet<ToolType> = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'draw',
  'text',
  'image',
  'eraser',
])

/** Clockwise from north, one entry per 45 degrees. */
const DIRECTIONS: readonly HandleKind[] = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
]
const RESIZE_CURSORS = [
  'ns-resize',
  'nesw-resize',
  'ew-resize',
  'nwse-resize',
] as const

/** CSS cursor for the pointer's situation; pure so the table is testable. */
export function cursorFor(context: CursorContext): string {
  if (context.panning) {
    return 'grabbing'
  }
  if (context.panReady) {
    return 'grab'
  }
  if (context.tool === 'hand') {
    return context.pressed ? 'grabbing' : 'grab'
  }
  if (CREATION_TOOLS.has(context.tool)) {
    return 'crosshair'
  }
  if (context.gesture === 'moving') {
    return 'move'
  }
  if (context.handle === 'rotate') {
    return 'grab'
  }
  if (context.handle) {
    return resizeCursor(context.handle, context.angle)
  }
  return context.overSelected ? 'move' : 'default'
}

function resizeCursor(handle: HandleKind, angle: number): string {
  const base = DIRECTIONS.indexOf(handle)
  const turns = Math.round(angle / (Math.PI / 4))
  const direction = (((base + turns) % 8) + 8) % 8
  return RESIZE_CURSORS[direction % 4] as string
}
```

Create `packages/engine/src/editor/input.ts`:

```ts
import {
  type Camera,
  panCamera,
  screenToWorld,
  zoomCamera,
} from '../camera'
import { hitTestScene } from '../geometry/hit'
import { hitTestHandles } from '../geometry/transform'
import type { InteractionController } from '../interaction/controller'
import type { Point } from '../model/element'
import type { BoardStore } from '../store/types'
import { HIT_TOLERANCE, type PointerInput } from '../tools/types'
import { cursorFor } from './cursor'

export interface InputHost {
  store: BoardStore
  controller: InteractionController
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** CSS pixel position relative to the container. */
  toScreen(event: { clientX: number; clientY: number }): Point
  isReadOnly(): boolean
  onDoubleClick(world: Point): void
  onCursorMove(point: Point | null): void
}

/** Wheel pixels to zoom factor: about 100 px doubles or halves the zoom. */
const WHEEL_ZOOM_SENSITIVITY = 0.007

/**
 * Binds the browser's pointer, wheel, and keyboard events onto the
 * controller. Pointer positions are projected through the camera here;
 * the controller only ever sees `PointerInput`. Returns the disposer.
 */
export function bindInput(
  surface: HTMLCanvasElement,
  keyboardTarget: EventTarget,
  host: InputHost,
): () => void {
  let spaceHeld = false
  let pressed = false
  /** Last screen point of the temporary pan in progress, if any. */
  let pan: Point | null = null
  let lastWorld: Point = { x: 0, y: 0 }

  const worldOf = (event: { clientX: number; clientY: number }): Point =>
    screenToWorld(host.getCamera(), host.toScreen(event))

  const toInput = (event: PointerEvent): PointerInput => {
    const screen = host.toScreen(event)
    return {
      world: screenToWorld(host.getCamera(), screen),
      screen,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    }
  }

  const updateCursor = (): void => {
    const camera = host.getCamera()
    const snapshot = host.controller.getSnapshot()
    const handle = pan
      ? null
      : hitTestHandles(snapshot.handles, lastWorld, camera.zoom)
    const hit =
      snapshot.selectedIds.length > 0
        ? hitTestScene(
            host.store.listElements(),
            lastWorld,
            HIT_TOLERANCE / camera.zoom,
          )
        : null
    const single =
      snapshot.selectedIds.length === 1
        ? host.store.getElement(snapshot.selectedIds[0] as string)
        : undefined
    surface.style.cursor = cursorFor({
      tool: snapshot.activeTool,
      gesture: snapshot.gesture,
      panning: pan !== null,
      panReady: spaceHeld,
      pressed,
      handle,
      overSelected: hit !== null && snapshot.selectedIds.includes(hit.id),
      angle: single?.angle ?? 0,
    })
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) {
      return
    }
    const screen = host.toScreen(event)
    lastWorld = screenToWorld(host.getCamera(), screen)
    if (event.button === 1 || spaceHeld) {
      surface.setPointerCapture(event.pointerId)
      pan = screen
      event.preventDefault()
      updateCursor()
      return
    }
    if (event.button !== 0) {
      return
    }
    surface.setPointerCapture(event.pointerId)
    pressed = true
    host.controller.pointerDown(toInput(event))
    updateCursor()
  }

  const onPointerMove = (event: PointerEvent): void => {
    const screen = host.toScreen(event)
    lastWorld = screenToWorld(host.getCamera(), screen)
    host.onCursorMove(lastWorld)
    if (pan) {
      host.setCamera(
        panCamera(host.getCamera(), screen.x - pan.x, screen.y - pan.y),
      )
      pan = screen
      return
    }
    if (pressed) {
      host.controller.pointerMove(toInput(event))
    }
    updateCursor()
  }

  const onPointerUp = (event: PointerEvent): void => {
    lastWorld = worldOf(event)
    if (pan) {
      pan = null
      updateCursor()
      return
    }
    if (!pressed) {
      return
    }
    pressed = false
    host.controller.pointerUp(toInput(event))
    updateCursor()
  }

  const onPointerCancel = (): void => {
    pan = null
    if (pressed) {
      pressed = false
      host.controller.cancelGesture()
    }
    updateCursor()
  }

  const onPointerLeave = (): void => {
    host.onCursorMove(null)
  }

  const onDoubleClick = (event: MouseEvent): void => {
    if (host.isReadOnly()) {
      return
    }
    host.onDoubleClick(worldOf(event))
  }

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const camera = host.getCamera()
    if (event.ctrlKey || event.metaKey) {
      host.setCamera(
        zoomCamera(
          camera,
          host.toScreen(event),
          camera.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
        ),
      )
      return
    }
    host.setCamera(panCamera(camera, -event.deltaX, -event.deltaY))
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) {
      return
    }
    if (event.key === ' ') {
      spaceHeld = true
      event.preventDefault()
      updateCursor()
      return
    }
    if (host.isReadOnly()) {
      return
    }
    const consumed = host.controller.handleKey({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    })
    if (consumed) {
      event.preventDefault()
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ') {
      spaceHeld = false
      updateCursor()
    }
  }

  /** A key held while the window loses focus never gets its keyup. */
  const onBlur = (): void => {
    spaceHeld = false
  }

  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('pointermove', onPointerMove)
  surface.addEventListener('pointerup', onPointerUp)
  surface.addEventListener('pointercancel', onPointerCancel)
  surface.addEventListener('pointerleave', onPointerLeave)
  surface.addEventListener('dblclick', onDoubleClick)
  // Explicitly non-passive: Chrome otherwise ignores preventDefault on
  // wheel and scrolls the page under the board.
  surface.addEventListener('wheel', onWheel, { passive: false })
  keyboardTarget.addEventListener('keydown', onKeyDown as EventListener)
  keyboardTarget.addEventListener('keyup', onKeyUp as EventListener)
  keyboardTarget.addEventListener('blur', onBlur)

  return () => {
    surface.removeEventListener('pointerdown', onPointerDown)
    surface.removeEventListener('pointermove', onPointerMove)
    surface.removeEventListener('pointerup', onPointerUp)
    surface.removeEventListener('pointercancel', onPointerCancel)
    surface.removeEventListener('pointerleave', onPointerLeave)
    surface.removeEventListener('dblclick', onDoubleClick)
    surface.removeEventListener('wheel', onWheel)
    keyboardTarget.removeEventListener('keydown', onKeyDown as EventListener)
    keyboardTarget.removeEventListener('keyup', onKeyUp as EventListener)
    keyboardTarget.removeEventListener('blur', onBlur)
  }
}

/** The host's text editor and board name keep their keys. */
function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') {
    return false
  }
  const element = target as { tagName?: string; isContentEditable?: boolean }
  const tag = element.tagName?.toUpperCase()
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    element.isContentEditable === true
  )
}
```

In `packages/engine/src/editor/editor.ts`:

Add the import `import { bindInput } from './input'`.

After the `stopRatio` observer, add:

```ts
  const unbindInput = bindInput(overlayCanvas, env.keyboardTarget, {
    store,
    controller,
    getCamera: () => renderer.getCamera(),
    setCamera,
    toScreen: (event) => {
      const rect = container.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    },
    isReadOnly: () => readOnly,
    // Text editing on double-click arrives with commitText; until then a
    // double-click does nothing.
    onDoubleClick: () => {},
    onCursorMove: (point) => options.onCursorMove?.(point),
  })
```

In `destroy`, call `unbindInput()` right after `destroyed = true`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test -- test/editor`
Expected: PASS, including the Task 8 `destroy` test, which now also checks the keyboard listeners are gone.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/editor packages/engine/test/editor
git commit -m "✨ feat(editor): bind pointer, wheel, and cursor input"
```

---

### Task 10: Keyboard routing and programmatic actions

**Files:**

- Modify: `packages/engine/src/interaction/controller.ts`
- Modify: `packages/engine/src/editor/types.ts`
- Modify: `packages/engine/src/editor/editor.ts`
- Test: `packages/engine/test/interaction/controller.test.ts`
- Test: `packages/engine/test/editor/actions.test.ts`

**Interfaces:**

- Consumes: `applyWithBindings` (Task 1); `KeyboardAction`.
- Produces:
  - `InteractionController.execute(action: KeyboardAction): void` (runs the action and notifies, exactly like a consumed key)
  - `Editor.execute(action: EditorAction): void`
  - `Editor.updateSelection(patch: ElementProps): void` (one undo entry over every selected element; bound arrows and labels follow)
  - `Editor.undo(): void`, `Editor.redo(): void`

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/test/interaction/controller.test.ts` inside the main `describe`:

```ts
  it('executes an action programmatically and notifies', () => {
    const { controller } = setup()
    let notified = 0
    controller.subscribe(() => {
      notified += 1
    })
    controller.execute({ kind: 'set-tool', tool: 'hand' })
    expect(controller.getActiveTool()).toBe('hand')
    expect(notified).toBe(1)
  })
```

Create `packages/engine/test/editor/actions.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/model/create'
import { mountEditor } from './harness'

const box = (id: string, index: string, x: number) =>
  createElement('rectangle', {
    id,
    index,
    seed: 1,
    x,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000000',
  })

describe('keyboard routing', () => {
  it('routes shortcuts to the controller and prevents their default', () => {
    const { editor, key } = mountEditor()
    expect(key('keydown', '3').defaultPrevented).toBe(true)
    expect(editor.getState().activeTool).toBe('rectangle')
    expect(key('keydown', 'q').defaultPrevented).toBe(false)
  })

  it('leaves editable targets alone', () => {
    const { editor, key } = mountEditor()
    const input = { tagName: 'input' }
    expect(key('keydown', '3', { target: input }).defaultPrevented).toBe(false)
    expect(editor.getState().activeTool).toBe('select')
    const editable = { tagName: 'DIV', isContentEditable: true }
    key('keydown', '2', { target: editable })
    expect(editor.getState().activeTool).toBe('select')
  })
})

describe('editor actions', () => {
  it('executes actions from the chrome', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      { kind: 'create', element: box('a', 'a0', 0) },
      { kind: 'create', element: box('b', 'a1', 200) },
    ])
    editor.setSelectedIds(['a'])
    editor.execute({ kind: 'bring-to-front' })
    expect(store.listElements().map((element) => element.id)).toEqual([
      'b',
      'a',
    ])
    editor.execute({ kind: 'delete-selection' })
    expect(store.listElements().map((element) => element.id)).toEqual(['b'])
    expect(editor.getState().selectedIds).toEqual([])
  })

  it('applies a style patch to the selection as one undo entry', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      { kind: 'create', element: box('a', 'a0', 0) },
      { kind: 'create', element: box('b', 'a1', 200) },
    ])
    store.stopCapturing()
    editor.setSelectedIds(['a', 'b'])
    const listener = vi.fn()
    editor.subscribe(listener)
    editor.updateSelection({ strokeColor: '#FF0000', strokeWidth: 4 })
    expect(store.getElement('a')).toMatchObject({
      strokeColor: '#FF0000',
      strokeWidth: 4,
    })
    expect(store.getElement('b')).toMatchObject({ strokeColor: '#FF0000' })
    editor.undo()
    expect(store.getElement('a')?.strokeColor).toBe('#000000')
    expect(store.getElement('b')?.strokeColor).toBe('#000000')
    expect(editor.getState().canRedo).toBe(true)
    editor.redo()
    expect(store.getElement('b')?.strokeColor).toBe('#FF0000')
    expect(listener).toHaveBeenCalled()
  })

  it('does nothing without a selection', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 'a0', 0) }])
    store.clearHistory()
    editor.updateSelection({ strokeColor: '#FF0000' })
    expect(store.getElement('a')?.strokeColor).toBe('#000000')
    expect(editor.getState().canUndo).toBe(false)
  })

  it('moves bound labels along with a positional patch', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      { kind: 'create', element: box('a', 'a0', 0) },
      {
        kind: 'create',
        element: createElement('text', {
          id: 'label',
          index: 'a1',
          x: 40,
          y: 40,
          width: 20,
          height: 20,
          text: 'a',
          containerId: 'a',
        }),
      },
    ])
    editor.setSelectedIds(['a'])
    editor.updateSelection({ x: 500 })
    expect(store.getElement('label')).toMatchObject({ x: 540, y: 40 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/interaction test/editor/actions.test.ts`
Expected: FAIL, `execute`, `updateSelection`, `undo`, and `redo` do not exist on the controller or the editor. (`store.clearHistory` exists on the contract already; check `src/store/types.ts` if the test reports otherwise.)

- [ ] **Step 3: Implement the controller and editor actions**

In `packages/engine/src/interaction/controller.ts`, add to the `InteractionController` interface after `handleKey`:

```ts
  /** Runs an action as a consumed key would; the client chrome calls it. */
  execute(action: KeyboardAction): void
```

and in the returned object, after `handleKey`:

```ts
    execute: (action) => {
      execute(action)
      notify()
    },
```

In `packages/engine/src/editor/types.ts`, add to `Editor` after `setDefaults`:

```ts
  /** Dispatches a chrome action (delete, duplicate, group, z-order...). */
  execute(action: EditorAction): void
  /** Applies a style or position patch to every selected element, one undo entry. */
  updateSelection(patch: ElementProps): void
  undo(): void
  redo(): void
```

In `packages/engine/src/editor/editor.ts`, add the import
`import { applyWithBindings } from '../model/bindings'`, extend the
types import to
`import type { Editor, EditorAction, EditorOptions, EditorState } from './types'`,
and add, in the returned object after `setDefaults`:

```ts
    execute: alive((action: EditorAction) => controller.execute(action)),
    updateSelection: alive((patch: ElementProps) => {
      const ids = controller.getSelectedIds()
      if (ids.length === 0) {
        return
      }
      store.stopCapturing()
      applyWithBindings(
        store,
        ids.map((id) => ({ kind: 'update', id, props: patch })),
        new Set(ids),
      )
      store.stopCapturing()
    }),
    undo: alive(() => store.undo()),
    redo: alive(() => store.redo()),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/interaction/controller.ts packages/engine/src/editor packages/engine/test/interaction/controller.test.ts packages/engine/test/editor/actions.test.ts
git commit -m "✨ feat(editor): route the keyboard and expose chrome actions"
```

---
### Task 11: Double-click text editing and labels

**Files:**

- Create: `packages/engine/src/editor/textEditing.ts`
- Modify: `packages/engine/src/editor/types.ts`
- Modify: `packages/engine/src/editor/editor.ts`
- Test: `packages/engine/test/editor/textEditing.test.ts`
- Test: `packages/engine/test/editor/text.test.ts`

**Interfaces:**

- Consumes: `labelFrame`, `isBindable` (Task 1); `measureText`, `TextSpec`, `TextSize` (Task 2); `hitTestElement`, `hitTestElementInterior`; `deleteElements`; `createElement`; `topIndex`, `HIT_TOLERANCE`.
- Produces:
  - `type Measure = (spec: TextSpec) => TextSize`
  - `type DoubleClickTarget = { kind: 'edit'; id: ElementId } | { kind: 'label'; containerId: ElementId } | { kind: 'create' } | { kind: 'none' }`
  - `resolveDoubleClick(elements: readonly BoardElement[], world: Point, tolerance: number): DoubleClickTarget`
  - `commitTextChanges(elements: readonly BoardElement[], id: ElementId, text: string, measure: Measure): BoardChange[]`
  - `createLabel(container: BoardElement, index: string, defaults: ElementProps, measure: Measure): TextElement`
  - `Editor.commitText(id: ElementId, text: string): void`
  - The editor's `onDoubleClick` host callback, replacing the Task 9 no-op.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/editor/textEditing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  commitTextChanges,
  createLabel,
  resolveDoubleClick,
} from '../../src/editor/textEditing'
import { createElement } from '../../src/model/create'
import type { TextSpec } from '../../src/render/text'

/** Ten units per character, one line of 25: predictable frames. */
const measure = (spec: TextSpec) => {
  const lines = spec.text.split('\n')
  return {
    width: Math.max(...lines.map((line) => line.length)) * 10,
    height: lines.length * 25,
  }
}

const shape = createElement('rectangle', {
  id: 'shape',
  index: 'a0',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
})
const label = createElement('text', {
  id: 'label',
  index: 'a1',
  x: 90,
  y: 37.5,
  width: 20,
  height: 25,
  text: 'ab',
  containerId: 'shape',
})
const loose = createElement('text', {
  id: 'loose',
  index: 'a2',
  x: 400,
  y: 400,
  width: 50,
  height: 25,
  text: 'hello',
})
const line = createElement('line', {
  id: 'line',
  index: 'a3',
  x: 600,
  y: 0,
  width: 100,
  height: 0,
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
})

describe('resolveDoubleClick', () => {
  it('edits a text element under the point', () => {
    expect(
      resolveDoubleClick([shape, label, loose, line], { x: 420, y: 410 }, 4),
    ).toEqual({ kind: 'edit', id: 'loose' })
  })

  it('labels a shape without one, and edits the label it has', () => {
    expect(resolveDoubleClick([shape], { x: 20, y: 20 }, 4)).toEqual({
      kind: 'label',
      containerId: 'shape',
    })
    expect(resolveDoubleClick([shape, label], { x: 20, y: 20 }, 4)).toEqual({
      kind: 'edit',
      id: 'label',
    })
  })

  it('creates a text on empty canvas and nothing on other elements', () => {
    expect(resolveDoubleClick([shape, line], { x: 300, y: 300 }, 4)).toEqual({
      kind: 'create',
    })
    expect(resolveDoubleClick([shape, line], { x: 650, y: 0 }, 4)).toEqual({
      kind: 'none',
    })
  })
})

describe('commitTextChanges', () => {
  it('writes the text and the measured size', () => {
    expect(commitTextChanges([loose], 'loose', 'hi\nthere', measure)).toEqual([
      {
        kind: 'update',
        id: 'loose',
        props: { text: 'hi\nthere', width: 50, height: 50 },
      },
    ])
  })

  it('recenters a label in its container', () => {
    expect(commitTextChanges([shape, label], 'label', 'abcd', measure)).toEqual([
      {
        kind: 'update',
        id: 'label',
        props: { text: 'abcd', width: 40, height: 25, x: 80, y: 37.5, angle: 0 },
      },
    ])
  })

  it('deletes an element committed empty and ignores unknown ids', () => {
    expect(commitTextChanges([loose], 'loose', '  \n ', measure)).toEqual([
      { kind: 'delete', id: 'loose' },
    ])
    expect(commitTextChanges([shape], 'shape', 'x', measure)).toEqual([])
    expect(commitTextChanges([], 'missing', 'x', measure)).toEqual([])
  })
})

describe('createLabel', () => {
  it('centers an empty, center-aligned text in the container', () => {
    const created = createLabel(
      shape,
      'a9',
      { strokeColor: '#123456', fontSize: 30 },
      measure,
    )
    expect(created).toMatchObject({
      type: 'text',
      index: 'a9',
      text: '',
      containerId: 'shape',
      textAlign: 'center',
      fontSize: 30,
      strokeColor: '#123456',
      width: 0,
      height: 25,
      x: 100,
      y: 37.5,
      angle: 0,
    })
  })
})
```

Create `packages/engine/test/editor/text.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/model/create'
import type { TextElement } from '../../src/model/element'
import { LINE_HEIGHT } from '../../src/render/text'
import { mountEditor } from './harness'

const shape = () =>
  createElement('rectangle', {
    id: 'shape',
    index: 'a0',
    seed: 1,
    x: 100,
    y: 100,
    width: 200,
    height: 100,
  })

describe('double-click text editing', () => {
  it('creates a text on empty canvas, selects it, and asks the host to edit', () => {
    const onTextEditRequest = vi.fn()
    const { editor, store, pointer } = mountEditor({ onTextEditRequest })
    pointer('dblclick', 30, 40)
    const [text] = store.listElements() as TextElement[]
    expect(text).toMatchObject({ type: 'text', x: 30, y: 40, text: '' })
    expect(editor.getState().selectedIds).toEqual([text?.id])
    expect(onTextEditRequest).toHaveBeenCalledWith(text?.id)
  })

  it('creates a centered label inside a shape, once', () => {
    const onTextEditRequest = vi.fn()
    const { store, pointer } = mountEditor({ onTextEditRequest })
    store.applyChanges([{ kind: 'create', element: shape() }])
    pointer('dblclick', 150, 150)
    const label = store
      .listElements()
      .find((element) => element.type === 'text') as TextElement
    expect(label).toMatchObject({
      containerId: 'shape',
      textAlign: 'center',
      x: 200,
      width: 0,
      height: 20 * LINE_HEIGHT,
    })
    expect(label.y).toBeCloseTo(150 - (20 * LINE_HEIGHT) / 2, 6)
    pointer('dblclick', 120, 120)
    expect(store.listElements()).toHaveLength(2)
    expect(onTextEditRequest).toHaveBeenLastCalledWith(label.id)
  })

  it('edits an existing text instead of creating one', () => {
    const onTextEditRequest = vi.fn()
    const { store, pointer } = mountEditor({ onTextEditRequest })
    store.applyChanges([
      {
        kind: 'create',
        element: createElement('text', {
          id: 't',
          index: 'a0',
          x: 10,
          y: 10,
          width: 80,
          height: 25,
          text: 'hello',
        }),
      },
    ])
    pointer('dblclick', 40, 20)
    expect(store.listElements()).toHaveLength(1)
    expect(onTextEditRequest).toHaveBeenCalledWith('t')
  })
})

describe('commitText', () => {
  it('sizes the text with the scene metrics, as one undo entry', () => {
    const { editor, store } = mountEditor()
    store.applyChanges([
      {
        kind: 'create',
        element: createElement('text', {
          id: 't',
          index: 'a0',
          x: 10,
          y: 10,
          text: '',
          fontSize: 20,
        }),
      },
    ])
    store.stopCapturing()
    editor.commitText('t', 'hello\nworld')
    const text = store.getElement('t') as TextElement
    expect(text.text).toBe('hello\nworld')
    expect(text.width).toBeGreaterThan(0)
    expect(text.height).toBe(2 * 20 * LINE_HEIGHT)
    editor.undo()
    expect((store.getElement('t') as TextElement).text).toBe('')
  })

  it('recenters a label and deletes an empty commit', () => {
    const { editor, store, pointer } = mountEditor()
    store.applyChanges([{ kind: 'create', element: shape() }])
    pointer('dblclick', 150, 150)
    const label = store
      .listElements()
      .find((element) => element.type === 'text') as TextElement
    editor.commitText(label.id, 'centered')
    const committed = store.getElement(label.id) as TextElement
    expect(committed.x + committed.width / 2).toBeCloseTo(200, 6)
    expect(committed.y + committed.height / 2).toBeCloseTo(150, 6)
    editor.commitText(label.id, '')
    expect(store.getElement(label.id)).toBeUndefined()
    expect(store.listElements()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/editor/textEditing.test.ts test/editor/text.test.ts`
Expected: FAIL, `textEditing.ts` does not exist and `commitText` is not on the editor.

- [ ] **Step 3: Implement the helpers and wire the editor**

Create `packages/engine/src/editor/textEditing.ts`:

```ts
import { hitTestElement, hitTestElementInterior } from '../geometry/hit'
import { isBindable, labelFrame } from '../model/bindings'
import { createElement } from '../model/create'
import type {
  BoardElement,
  ElementId,
  ElementProps,
  Point,
  TextElement,
} from '../model/element'
import { deleteElements } from '../model/operations'
import type { TextSize, TextSpec } from '../render/text'
import type { BoardChange } from '../store/types'

export type Measure = (spec: TextSpec) => TextSize

export type DoubleClickTarget =
  | { kind: 'edit'; id: ElementId }
  | { kind: 'label'; containerId: ElementId }
  | { kind: 'create' }
  | { kind: 'none' }

/**
 * What a double-click means, topmost element first: edit the text under
 * the point, label the shape under it (or edit the label it already
 * has), start a text on empty canvas, nothing on any other element. A
 * shape counts as hit anywhere inside, hollow or not, unlike a single
 * click that grabs its outline.
 */
export function resolveDoubleClick(
  elements: readonly BoardElement[],
  world: Point,
  tolerance: number,
): DoubleClickTarget {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i] as BoardElement
    if (element.opacity === 0) {
      continue
    }
    if (element.type === 'text') {
      if (hitTestElement(element, world, tolerance)) {
        return { kind: 'edit', id: element.id }
      }
      continue
    }
    if (isBindable(element)) {
      if (!hitTestElementInterior(element, world, tolerance)) {
        continue
      }
      const label = elements.find(
        (candidate) =>
          candidate.type === 'text' && candidate.containerId === element.id,
      )
      return label
        ? { kind: 'edit', id: label.id }
        : { kind: 'label', containerId: element.id }
    }
    if (hitTestElement(element, world, tolerance)) {
      return { kind: 'none' }
    }
  }
  return { kind: 'create' }
}

/**
 * Changes committing edited text: the text and its measured size, a
 * label recentered in its container, or a delete when the text is
 * blank. Empty for an unknown id or a non-text element.
 */
export function commitTextChanges(
  elements: readonly BoardElement[],
  id: ElementId,
  text: string,
  measure: Measure,
): BoardChange[] {
  const element = elements.find((candidate) => candidate.id === id)
  if (!element || element.type !== 'text') {
    return []
  }
  if (text.trim() === '') {
    return deleteElements(elements, [id])
  }
  const size = measure({
    text,
    fontSize: element.fontSize,
    fontFamily: element.fontFamily,
  })
  const props: ElementProps = {
    text,
    width: size.width,
    height: size.height,
  }
  const container = element.containerId
    ? elements.find((candidate) => candidate.id === element.containerId)
    : undefined
  if (container) {
    Object.assign(props, labelFrame(container, size))
  }
  return [{ kind: 'update', id, props }]
}

/** A new empty label: center aligned, one line tall, centered in its container. */
export function createLabel(
  container: BoardElement,
  index: string,
  defaults: ElementProps,
  measure: Measure,
): TextElement {
  const fontSize = defaults.fontSize ?? 20
  const fontFamily = defaults.fontFamily ?? 'hand'
  const size = measure({ text: '', fontSize, fontFamily })
  return createElement('text', {
    index,
    ...defaults,
    ...labelFrame(container, size),
    width: size.width,
    height: size.height,
    textAlign: 'center',
    containerId: container.id,
  }) as TextElement
}
```

In `packages/engine/src/editor/types.ts`, add to `Editor` after `updateSelection`:

```ts
  /**
   * Ends a host text edit: sizes the element with the scene metrics,
   * recenters a label in its container, deletes it when blank.
   */
  commitText(id: ElementId, text: string): void
```

In `packages/engine/src/editor/editor.ts`:

Add the imports:

```ts
import { createElement } from '../model/create'
import { DEFAULT_FONTS, measureText, type TextSpec } from '../render/text'
import { HIT_TOLERANCE, topIndex } from '../tools/types'
import { commitTextChanges, createLabel, resolveDoubleClick } from './textEditing'
```

and add `BoardElement` to the existing
`import type { ElementId, ElementProps, Point } from '../model/element'`.
The `ToolType` import from `'../tools/types'` merges into the value
import above as `type ToolType`.

After the 2D context check, create the measuring context and the
editor's copy of the creation defaults:

```ts
  const fonts = options.fonts ?? DEFAULT_FONTS
  const measuringCanvas = env.createCanvas()
  const measuringContext = measuringCanvas.getContext('2d')
  if (!measuringContext) {
    container.removeChild(overlayCanvas)
    container.removeChild(sceneCanvas)
    throw new Error('createEditor: 2D canvas context unavailable')
  }
  const measure = (spec: TextSpec) =>
    measureText(spec, fonts, measuringContext)
  /** Mirrors the controller's creation defaults for double-click text. */
  let defaults: ElementProps = { ...options.defaults }
```

Pass `fonts` (the resolved constant) to `createRenderer` instead of `options.fonts`.

Replace the `onDoubleClick: () => {}` host callback with:

```ts
    onDoubleClick: (world) => {
      const elements = store.listElements()
      const target = resolveDoubleClick(
        elements,
        world,
        HIT_TOLERANCE / renderer.getCamera().zoom,
      )
      switch (target.kind) {
        case 'none':
          return
        case 'edit':
          controller.setSelectedIds([target.id])
          options.onTextEditRequest?.(target.id)
          return
        case 'label': {
          const shape = store.getElement(target.containerId)
          if (shape) {
            placeText(createLabel(shape, topIndex(store), defaults, measure))
          }
          return
        }
        case 'create':
          placeText(
            createElement('text', {
              index: topIndex(store),
              ...defaults,
              x: world.x,
              y: world.y,
            }),
          )
          return
      }
    },
```

Add, before `bindInput` is called, the shared placement:

```ts
  /** One undo entry, selected, handed to the host's editor. */
  const placeText = (element: BoardElement): void => {
    store.stopCapturing()
    store.applyChanges([{ kind: 'create', element }])
    store.stopCapturing()
    controller.setActiveTool('select')
    controller.setSelectedIds([element.id])
    options.onTextEditRequest?.(element.id)
  }
```

(`BoardElement` joins the `../model/element` type import.)

Update `setDefaults` so both copies stay in sync, and add `commitText`
to the returned object:

```ts
    setDefaults: alive((patch: ElementProps) => {
      defaults = { ...defaults, ...patch }
      controller.setDefaults(patch)
    }),
    commitText: alive((id: ElementId, text: string) => {
      const changes = commitTextChanges(store.listElements(), id, text, measure)
      if (changes.length === 0) {
        return
      }
      store.stopCapturing()
      store.applyChanges(changes)
      store.stopCapturing()
    }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test -- test/editor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/editor packages/engine/test/editor
git commit -m "✨ feat(editor): edit text on double-click and commit it with labels"
```

---

### Task 12: Read-only mode

**Files:**

- Modify: `packages/engine/src/editor/types.ts`
- Modify: `packages/engine/src/editor/editor.ts`
- Test: `packages/engine/test/editor/readonly.test.ts`

**Interfaces:**

- Consumes: `isReadOnly` on the `InputHost` (Task 9 gates the keyboard and double-click on it).
- Produces: `Editor.setReadOnly(readOnly: boolean): void`; `EditorState.readOnly` follows it; in read-only mode the tool is `hand`, the selection is empty, and `setActiveTool`, `setSelectedIds`, `execute`, `updateSelection`, `commitText`, `undo`, `redo`, and double-click are no-ops.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/editor/readonly.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createElement } from '../../src/model/create'
import { mountEditor } from './harness'

const box = () =>
  createElement('rectangle', {
    id: 'a',
    index: 'a0',
    seed: 1,
    x: 100,
    y: 100,
    width: 100,
    height: 100,
  })

describe('read-only mode', () => {
  it('starts on the hand tool and only pans', () => {
    const { editor, store, pointer, key } = mountEditor({ readOnly: true })
    expect(editor.getState()).toMatchObject({
      readOnly: true,
      activeTool: 'hand',
    })
    expect(key('keydown', '3').defaultPrevented).toBe(false)
    editor.setActiveTool('rectangle')
    expect(editor.getState().activeTool).toBe('hand')
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 30, 40)
    pointer('pointerup', 30, 40)
    expect(editor.getState().camera).toEqual({ x: -30, y: -40, zoom: 1 })
    expect(store.listElements()).toHaveLength(0)
    pointer('dblclick', 50, 50)
    expect(store.listElements()).toHaveLength(0)
  })

  it('ignores every mutating call', () => {
    const { editor, store } = mountEditor({ readOnly: true })
    store.applyChanges([{ kind: 'create', element: box() }])
    store.clearHistory()
    editor.setSelectedIds(['a'])
    expect(editor.getState().selectedIds).toEqual([])
    editor.updateSelection({ strokeColor: '#FF0000' })
    editor.execute({ kind: 'select-all' })
    editor.execute({ kind: 'delete-selection' })
    editor.commitText('a', 'x')
    editor.undo()
    editor.redo()
    expect(store.listElements()).toEqual([store.getElement('a')])
    expect(editor.getState()).toMatchObject({
      selectedIds: [],
      canUndo: false,
    })
  })

  it('switches at runtime, clearing the selection on the way in', () => {
    const { editor, store, pointer } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box() }])
    editor.setSelectedIds(['a'])
    const listener = vi.fn()
    editor.subscribe(listener)
    editor.setReadOnly(true)
    expect(editor.getState()).toMatchObject({
      readOnly: true,
      activeTool: 'hand',
      selectedIds: [],
    })
    expect(listener).toHaveBeenCalledTimes(1)
    editor.setReadOnly(true)
    expect(listener).toHaveBeenCalledTimes(1)
    editor.setReadOnly(false)
    expect(editor.getState()).toMatchObject({
      readOnly: false,
      activeTool: 'select',
    })
    editor.setActiveTool('rectangle')
    pointer('pointerdown', 0, 0)
    pointer('pointermove', 50, 50)
    pointer('pointerup', 50, 50)
    expect(store.listElements()).toHaveLength(2)
  })

  it('still paints presence and reports the local cursor', () => {
    const onCursorMove = vi.fn()
    const { editor, overlay, pointer, flush } = mountEditor({
      readOnly: true,
      onCursorMove,
    })
    flush()
    editor.setPresence([
      {
        id: 'p',
        name: 'Ada',
        color: '#00AA00',
        cursor: { x: 100, y: 100 },
        selectedIds: [],
        isAgent: false,
      },
    ])
    flush()
    expect(overlay.rgbaAt(102, 108)).toEqual([0, 170, 0, 255])
    pointer('pointermove', 5, 6, { buttons: 0 })
    expect(onCursorMove).toHaveBeenLastCalledWith({ x: 5, y: 6 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/editor/readonly.test.ts`
Expected: FAIL, `setReadOnly` does not exist and the read-only editor still starts on `select`.

- [ ] **Step 3: Implement read-only gating**

In `packages/engine/src/editor/types.ts`, add to `Editor` after `setDefaults`:

```ts
  /**
   * Viewing mode: hand tool, no selection, every mutating call ignored.
   * The client-side half of the enforcement; the server rejects updates
   * on read-only connections regardless.
   */
  setReadOnly(readOnly: boolean): void
```

In `packages/engine/src/editor/editor.ts`:

Change `const readOnly = options.readOnly ?? false` to `let readOnly = options.readOnly ?? false`.

Right after the controller is created, apply the initial mode:

```ts
  if (readOnly) {
    controller.setActiveTool('hand')
  }
```

Next to the `alive` helper, add the gate for mutators:

```ts
  /** Mutators are also inert in read-only mode. */
  const editable =
    <A extends unknown[]>(fn: (...args: A) => void) =>
      alive((...args: A) => {
        if (!readOnly) {
          fn(...args)
        }
      })
```

Wrap with `editable` instead of `alive`: `setActiveTool`, `setSelectedIds`,
`execute`, `updateSelection`, `commitText`, `undo`, `redo`. Keep `alive`
on `setDefaults`, `zoomTo`, `zoomToFit`, `setPresence`.

In the `onDoubleClick` host callback, `bindInput` already returns early
through `isReadOnly`; nothing to add there.

Switching mode makes two controller calls (clear the selection, change
the tool), and each one notifies. The host must see a single state
change, so `refresh` is held while they run. Add the flag next to
`destroyed`:

```ts
  /** True while several controller calls form one state change. */
  let batching = false
```

and make `refresh` bail out on it: replace `if (destroyed) {` at the
top of `refresh` with `if (destroyed || batching) {`.

Add `setReadOnly` to the returned object:

```ts
    setReadOnly: alive((next: boolean) => {
      if (readOnly === next) {
        return
      }
      readOnly = next
      batching = true
      if (next) {
        controller.setSelectedIds([])
        controller.setActiveTool('hand')
      } else {
        controller.setActiveTool('select')
      }
      batching = false
      invalidate()
    }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test -- test/editor`
Expected: PASS, the runtime switch test seeing exactly one notification.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/editor packages/engine/test/editor/readonly.test.ts
git commit -m "✨ feat(editor): add the read-only viewing mode"
```

---

### Task 13: Export from the editor, public exports, and documentation

**Files:**

- Modify: `packages/engine/src/editor/types.ts`
- Modify: `packages/engine/src/editor/editor.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `.claude/superpowers/specs/2026-08-25-tlwb-engine-editor-api-design.md` (status line only)
- Test: `packages/engine/test/editor/export.test.ts`
- Test: `packages/engine/test/index.test.ts`

**Interfaces:**

- Consumes: `exportScenePng` (Task 7), `exportSceneSvg` (Task 6), `env.createCanvas`.
- Produces:
  - `interface ExportOptions { ids?: ElementId[]; background?: string }`
  - `Editor.exportPng(options?: ExportOptions & { scale?: number }): Promise<Blob>`
  - `Editor.exportSvg(options?: ExportOptions): string`
  - Package exports for the whole editor layer.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/editor/export.test.ts`:

```ts
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import { mountEditor } from './harness'

const box = (id: string, index: string, x: number) =>
  createElement('rectangle', {
    id,
    index,
    seed: 1,
    x,
    y: 0,
    width: 100,
    height: 50,
  })

describe('editor export', () => {
  it('exports the board as SVG, whole or by ids', () => {
    const { editor, store } = mountEditor({
      resolveImageUrl: (hash) => `https://cdn.example/${hash}`,
    })
    store.applyChanges([
      { kind: 'create', element: box('a', 'a0', 0) },
      { kind: 'create', element: box('b', 'a1', 500) },
      {
        kind: 'create',
        element: createElement('image', {
          id: 'i',
          index: 'a2',
          x: 0,
          y: 200,
          width: 40,
          height: 30,
          assetHash: 'abc',
        }),
      },
    ])
    const whole = editor.exportSvg()
    expect(whole).toContain('viewBox="-16 -16 632 262"')
    expect(whole).toContain('href="https://cdn.example/abc"')
    const part = editor.exportSvg({ ids: ['b'], background: '#EEEEEE' })
    expect(part).toContain('viewBox="484 -16 132 82"')
    expect(part).toContain('fill="#EEEEEE"')
    expect(part).not.toContain('<image')
  })

  it('exports the board as a PNG blob at the requested scale', async () => {
    const { editor, store } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 'a0', 0) }])
    const blob = await editor.exportPng({ scale: 2 })
    expect(blob.type).toBe('image/png')
    const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
    expect(image.width).toBe(264)
    expect(image.height).toBe(164)
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([
      255, 255, 255, 255,
    ])
  })
})
```

Create `packages/engine/test/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as engine from '../src/index'

describe('package entry point', () => {
  it('exposes the editor layer', () => {
    expect(typeof engine.createEditor).toBe('function')
    expect(typeof engine.resolveEnvironment).toBe('function')
    expect(typeof engine.bindInput).toBe('function')
    expect(typeof engine.cursorFor).toBe('function')
    expect(typeof engine.renderOverlay).toBe('function')
    expect(typeof engine.exportSceneSvg).toBe('function')
    expect(typeof engine.exportScenePng).toBe('function')
    expect(typeof engine.measureText).toBe('function')
    expect(typeof engine.sanitizePeers).toBe('function')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test -- test/editor/export.test.ts test/index.test.ts`
Expected: FAIL, `exportSvg` and `exportPng` do not exist and `createEditor` is not exported from the package.

- [ ] **Step 3: Wire the exports and update the documentation**

In `packages/engine/src/editor/types.ts`, add:

```ts
export interface ExportOptions {
  /** Empty or absent exports the whole board. */
  ids?: ElementId[]
  background?: string
}
```

and to `Editor`, before `destroy`:

```ts
  /** The board as drawn, without overlay; the host triggers the download. */
  exportPng(options?: ExportOptions & { scale?: number }): Promise<Blob>
  exportSvg(options?: ExportOptions): string
```

In `packages/engine/src/editor/editor.ts`, add the imports
`import { exportScenePng } from '../export/png'` and
`import { exportSceneSvg } from '../export/svg'`, then in the returned
object before `destroy`:

```ts
    // Exports read the store only, so they keep working after destroy.
    exportPng: (exportOptions = {}) =>
      exportScenePng(
        store.listElements(),
        {
          ids: exportOptions.ids,
          background: exportOptions.background ?? options.background,
          scale: exportOptions.scale,
          fonts,
          resolveImage: options.resolveImage,
        },
        env.createCanvas,
      ),
    exportSvg: (exportOptions = {}) =>
      exportSceneSvg(store.listElements(), {
        ids: exportOptions.ids,
        background: exportOptions.background ?? options.background,
        fonts,
        resolveImageUrl: options.resolveImageUrl,
      }),
```

In `packages/engine/src/index.ts`, add:

```ts
export type { CursorContext } from './editor/cursor'
export { cursorFor } from './editor/cursor'
export { createEditor } from './editor/editor'
export type { EditorEnvironment } from './editor/environment'
export { resolveEnvironment } from './editor/environment'
export type { InputHost } from './editor/input'
export { bindInput } from './editor/input'
export type {
  DoubleClickTarget,
  Measure,
} from './editor/textEditing'
export {
  commitTextChanges,
  createLabel,
  resolveDoubleClick,
} from './editor/textEditing'
export type {
  Editor,
  EditorAction,
  EditorOptions,
  EditorState,
  ExportOptions,
} from './editor/types'
```

In `README.md`, replace the `packages/engine` bullet with:

```markdown
- `packages/engine`: framework-agnostic whiteboard engine, data layer,
  rendering, interactions, and public editor API (element model,
  fractional z-ordering, board store with per-origin undo and redo,
  versioned JSON snapshots, camera and viewport math, sketchy shape and
  free-drawing rendering, canvas text and images, an invalidation-driven
  render loop). The interaction layer hit-tests on real geometry and
  runs one state machine per tool, with group and lasso selection,
  resize and rotate handles, alignment snapping, arrow bindings and
  shape labels that follow their shapes, and keyboard shortcuts.
  `createEditor` binds it all to a DOM container: two stacked canvases
  (scene and overlay), pointer, wheel, and keyboard input, remote
  presence painting, double-click text editing, read-only mode, and PNG
  and SVG export.
```

In `CONTRIBUTING.md`, replace the repository layout bullet with:

```markdown
- `packages/engine`: the framework-agnostic whiteboard engine. Its data
  layer holds the element model, fractional z-ordering, the board store
  with per-origin undo and redo, and the versioned JSON snapshot format;
  rendering, tools, and the DOM-bound `createEditor` API sit on top.
  Tests run in Node against `@napi-rs/canvas` and a small fake DOM
  (`test/editor/fakeDom.ts`); the engine never needs jsdom or a browser.
```

In the spec, change the `Status:` line to `Status: implemented`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src packages/engine/test README.md CONTRIBUTING.md .claude/superpowers/specs/2026-08-25-tlwb-engine-editor-api-design.md
git commit -m "✨ feat(editor): export the board as PNG and SVG and publish the editor API"
```

---

### Task 14: Verification

**Files:** none created.

- [ ] **Step 1: Run the full check suite**

From the repository root:

```bash
pnpm check
pnpm typecheck
pnpm test
```

Expected: all three pass, with the new visual baselines (`overlay-selection.png`, `overlay-presence.png`) and SVG snapshots committed.

- [ ] **Step 2: Confirm the dependency and environment constraints**

```bash
git diff main -- packages/engine/package.json pnpm-lock.yaml
grep -rn "document\.\|window\." packages/engine/src --include='*.ts' | grep -v 'src/editor/environment.ts'
```

Expected: an empty diff (no dependency change), and no `document.` or `window.` reference outside `src/editor/environment.ts`.

- [ ] **Step 3: Confirm the overlay-only invalidation criterion**

Run: `pnpm --filter @tlwb/engine test -- test/editor/editor.test.ts -t "paints peers on the overlay only"`
Expected: PASS (one pending frame after repeated `setPresence` calls: the scene scheduler was never marked).

- [ ] **Step 4: Report**

State in the final message which baselines and snapshots were added, and that `pnpm check`, `pnpm typecheck`, and `pnpm test` pass on the branch.

---

## Verification

After the last task, from the repository root:

- `pnpm check` passes (formatting, lint, import order).
- `pnpm typecheck` passes on Node 22 and 24 semantics (CI runs both).
- `pnpm test` passes, including the visual suite with its two new overlay baselines and the three SVG snapshots, with no jsdom, React, Yjs, or network dependency.
- `packages/engine` still depends only on `fractional-indexing`, `zod`, `roughjs`, `perfect-freehand` at runtime and adds no dev dependency.

## Out of Scope

Deferred to the next plans of the series and to the client: system
clipboard copy and paste between boards (client, on top of
`exportSnapshot` and `importSnapshot`), multitouch and native pinch,
dark mode, in-canvas text editing (the host owns the DOM editor and
calls `commitText`), image upload and asset storage, font embedding in
SVG, hover highlighting of elements, selecting a label's container when
the label itself is clicked (a click on a label selects the label; a
dragged label leaves its container until the container moves again),
`packages/store-yjs`, the React client, and the collaboration server.
