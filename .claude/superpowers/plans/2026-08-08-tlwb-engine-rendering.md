# tlwb Engine Canvas Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the rendering layer of `packages/engine`: camera and
viewport math, sketchy shape rendering through rough.js with stable
seeds, free drawing through perfect-freehand, canvas text and images, an
invalidation-driven render loop over the board store, and a visual
regression suite over reference scenes.

**Architecture:** Second plan of the canvas engine series defined by
`.claude/superpowers/specs/2026-08-08-tlwb-canvas-engine-realtime-design.md`
(section 4, "Rendering"). Everything lives in `packages/engine` and
consumes the `BoardStore` interface delivered by the previous plan. Pure
generation modules (drawables, freehand outlines, text layout) are
separated from the painter (`renderScene`) and from the scheduler
(`createRenderer`), so everything below the canvas boundary stays
unit-testable in Node. Tests rasterize through `@napi-rs/canvas`, which
bundles its own Skia, so pixels are comparable across macOS and CI.

**Tech Stack:** TypeScript (strict), Vitest, `roughjs` (MIT),
`perfect-freehand` (MIT), `@napi-rs/canvas` (MIT, test only),
`pixelmatch` (ISC, test only).

## Global Constraints

- License: MIT, copyright JDevelop.
- All file content, code, comments, and commit messages in English.
- Commits: gitmoji + Conventional Commits (`<emoji> <type>(<scope>): <summary>`).
- TDD is mandatory: every behavior lands red first, then green.
- Node.js >= 22, pnpm 11, `"type": "module"` (ESM only), TypeScript `strict` plus `noUncheckedIndexedAccess`.
- Biome enforces style: single quotes, no semicolons, trailing commas, 2-space indent, line width 80, organized imports. Run `pnpm check:write` before every commit; CI runs `pnpm check`.
- `packages/engine` runtime dependencies after this plan: `fractional-indexing`, `zod`, `roughjs`, `perfect-freehand`. Nothing else. No React, no Yjs, no network code. Canvas types come from the `DOM` lib already enabled in `tsconfig.base.json`.
- Test-only dependencies added by this plan: `@napi-rs/canvas`, `pixelmatch`.
- Zoom range: 10% to 6400%, that is `MIN_ZOOM = 0.1` and `MAX_ZOOM = 64`.
- Angles are radians. Rotation pivots on the element center.
- `points` of `line`, `arrow`, and `draw` elements are relative to the element origin `(x, y)`; tools (a later plan) keep `width`/`height` enclosing the points, so the element frame is a valid culling box.
- Default background `#FFFFFF`. Image placeholder colors: fill `#F7F7F5`, border `#E5E4E0` (Foundations chrome palette).
- Default handwriting stack `'Caveat, cursive'`; the client overrides it with the exact Foundations token once the font is loaded. The engine never loads fonts.
- Elements arrive sorted back to front (`BoardStore.listElements()` guarantees it); the renderer never re-sorts.
- All commands run from the repository root.

## File Structure

- `src/geometry/bounds.ts`: `Rect`, rect intersection and expansion, rotated element bounding boxes. Culling math.
- `src/camera.ts`: `Camera`, zoom clamping, screen/world transforms, pan and anchored zoom, visible world rect.
- `src/render/shapes.ts`: rough.js drawable generation for `rectangle`, `ellipse`, `diamond`, `line`, `arrow`, with a per-element cache.
- `src/render/freehand.ts`: perfect-freehand outline of `draw` elements as an SVG path string, cached per element.
- `src/render/text.ts`: font configuration, line splitting, alignment anchor. Pure helpers, no canvas.
- `src/render/scene.ts`: `renderScene`, the one function that paints a scene onto a canvas (clear, DPR, camera transform, culling, per-type painters).
- `src/render/renderer.ts`: `createRenderer`, the invalidation loop binding a canvas to a `BoardStore`.
- `test/setup.ts`: Node test globals (`Path2D`, registered test font).
- `test/visual/scenes.ts`, `test/visual/visual.test.ts`, `test/visual/fixtures/`, `test/visual/__baselines__/`: visual regression suite.

The store contract is untouched: rendering only reads. Element caches key
on element object identity, which is safe because `InMemoryBoardStore`
freezes elements on write and replaces the object on every update.

---

### Task 1: Element bounds and culling geometry

**Files:**

- Create: `packages/engine/src/geometry/bounds.ts`
- Test: `packages/engine/test/geometry/bounds.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `BoardElement` from `src/model/element.ts`.
- Produces:
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `rectsIntersect(a: Rect, b: Rect): boolean`
  - `expandRect(rect: Rect, margin: number): Rect`
  - `getElementBounds(element: BoardElement): Rect` (axis-aligned box of the rotated frame)

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/geometry/bounds.test.ts
import { describe, expect, it } from 'vitest'
import {
  expandRect,
  getElementBounds,
  rectsIntersect,
} from '../../src/geometry/bounds'
import { createElement } from '../../src/model/create'

describe('rectsIntersect', () => {
  it('detects overlap and separation', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(rectsIntersect(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
    expect(rectsIntersect(a, { x: 20, y: 0, width: 5, height: 5 })).toBe(false)
  })

  it('treats touching edges as separate', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(rectsIntersect(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false)
  })
})

describe('expandRect', () => {
  it('grows the rect on every side', () => {
    expect(expandRect({ x: 10, y: 20, width: 30, height: 40 }, 5)).toEqual({
      x: 5,
      y: 15,
      width: 40,
      height: 50,
    })
  })
})

describe('getElementBounds', () => {
  it('returns the frame of an unrotated element', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
    expect(getElementBounds(element)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
  })

  it('swaps extents for a quarter turn around the center', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      angle: Math.PI / 2,
    })
    const bounds = getElementBounds(element)
    expect(bounds.x).toBeCloseTo(50)
    expect(bounds.y).toBeCloseTo(-50)
    expect(bounds.width).toBeCloseTo(100)
    expect(bounds.height).toBeCloseTo(200)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, cannot resolve `../../src/geometry/bounds`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/engine/src/geometry/bounds.ts
import type { BoardElement } from '../model/element'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

export function expandRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  }
}

/**
 * Axis-aligned bounding box of the element's rotated frame. Linear
 * elements keep `width`/`height` enclosing their points, so the frame
 * alone is enough for culling.
 */
export function getElementBounds(element: BoardElement): Rect {
  const { x, y, width, height, angle } = element
  if (angle === 0) {
    return { x, y, width, height }
  }
  const centerX = x + width / 2
  const centerY = y + height / 2
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const rotatedWidth = width * cos + height * sin
  const rotatedHeight = width * sin + height * cos
  return {
    x: centerX - rotatedWidth / 2,
    y: centerY - rotatedHeight / 2,
    width: rotatedWidth,
    height: rotatedHeight,
  }
}
```

Add to `packages/engine/src/index.ts` (Biome will order the lines):

```ts
export type { Rect } from './geometry/bounds'
export {
  expandRect,
  getElementBounds,
  rectsIntersect,
} from './geometry/bounds'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS, all suites green.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/geometry/bounds.ts packages/engine/test/geometry/bounds.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): add element bounds and viewport culling geometry"
```

---

### Task 2: Camera model and coordinate transforms

**Files:**

- Create: `packages/engine/src/camera.ts`
- Test: `packages/engine/test/camera.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `Rect` from Task 1, `Point` from `src/model/element.ts`.
- Produces:
  - `interface Camera { x: number; y: number; zoom: number }` where `(x, y)` is the world point at the screen origin
  - `interface Viewport { width: number; height: number }` (CSS pixels)
  - `MIN_ZOOM = 0.1`, `MAX_ZOOM = 64`
  - `createCamera(): Camera` (origin, zoom 1)
  - `clampZoom(zoom: number): number`
  - `screenToWorld(camera: Camera, point: Point): Point`
  - `worldToScreen(camera: Camera, point: Point): Point`
  - `panCamera(camera: Camera, dx: number, dy: number): Camera` (screen-space delta)
  - `zoomCamera(camera: Camera, anchor: Point, nextZoom: number): Camera` (anchor in screen coordinates stays fixed)
  - `visibleRect(camera: Camera, viewport: Viewport): Rect` (world coordinates)

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/camera.test.ts
import { describe, expect, it } from 'vitest'
import {
  clampZoom,
  createCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  panCamera,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomCamera,
} from '../../src/camera'

describe('clampZoom', () => {
  it('clamps to the 10 percent to 6400 percent range', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(2)).toBe(2)
  })
})

describe('coordinate transforms', () => {
  it('round-trips between screen and world', () => {
    const camera = { x: 100, y: 50, zoom: 2 }
    const screen = { x: 30, y: 40 }
    expect(worldToScreen(camera, screenToWorld(camera, screen))).toEqual(
      screen,
    )
  })

  it('maps the camera position to the screen origin', () => {
    const camera = { x: 100, y: 50, zoom: 2 }
    expect(worldToScreen(camera, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 })
  })
})

describe('panCamera', () => {
  it('moves the world opposite to the screen drag, scaled by zoom', () => {
    const camera = panCamera({ x: 0, y: 0, zoom: 2 }, 10, -20)
    expect(camera).toEqual({ x: -5, y: 10, zoom: 2 })
  })
})

describe('zoomCamera', () => {
  it('keeps the world point under the anchor fixed', () => {
    const camera = createCamera()
    const anchor = { x: 200, y: 150 }
    const before = screenToWorld(camera, anchor)
    const zoomed = zoomCamera(camera, anchor, 4)
    expect(zoomed.zoom).toBe(4)
    const after = screenToWorld(zoomed, anchor)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('clamps the requested zoom', () => {
    expect(zoomCamera(createCamera(), { x: 0, y: 0 }, 1000).zoom).toBe(
      MAX_ZOOM,
    )
  })
})

describe('visibleRect', () => {
  it('converts the viewport to world coordinates', () => {
    expect(
      visibleRect({ x: 100, y: 50, zoom: 2 }, { width: 800, height: 600 }),
    ).toEqual({ x: 100, y: 50, width: 400, height: 300 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, cannot resolve `../../src/camera`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/engine/src/camera.ts
import type { Rect } from './geometry/bounds'
import type { Point } from './model/element'

/** `(x, y)` is the world point rendered at the screen origin. */
export interface Camera {
  x: number
  y: number
  zoom: number
}

/** Viewport size in CSS pixels. */
export interface Viewport {
  width: number
  height: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 64

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 }
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function screenToWorld(camera: Camera, point: Point): Point {
  return {
    x: camera.x + point.x / camera.zoom,
    y: camera.y + point.y / camera.zoom,
  }
}

export function worldToScreen(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  }
}

/** Pans by a screen-space delta, as produced by pointer or wheel events. */
export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    x: camera.x - dx / camera.zoom,
    y: camera.y - dy / camera.zoom,
  }
}

/**
 * Zooms toward `anchor` (screen coordinates): the world point under the
 * anchor stays under it, which is what wheel-zoom and pinch expect.
 */
export function zoomCamera(
  camera: Camera,
  anchor: Point,
  nextZoom: number,
): Camera {
  const zoom = clampZoom(nextZoom)
  const fixed = screenToWorld(camera, anchor)
  return {
    x: fixed.x - anchor.x / zoom,
    y: fixed.y - anchor.y / zoom,
    zoom,
  }
}

export function visibleRect(camera: Camera, viewport: Viewport): Rect {
  return {
    x: camera.x,
    y: camera.y,
    width: viewport.width / camera.zoom,
    height: viewport.height / camera.zoom,
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type { Camera, Viewport } from './camera'
export {
  clampZoom,
  createCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  panCamera,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomCamera,
} from './camera'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/camera.ts packages/engine/test/camera.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): add the camera model and coordinate transforms"
```

---

### Task 3: Sketchy shape drawables with stable seeds

**Files:**

- Create: `packages/engine/src/render/shapes.ts`
- Test: `packages/engine/test/render/shapes.test.ts`
- Modify: `packages/engine/package.json` (dependency), `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: element types from `src/model/element.ts`; `RoughGenerator` from `roughjs/bin/generator`; `Drawable`, `Options` from `roughjs/bin/core`.
- Produces:
  - `type SketchyElement = RectangleElement | EllipseElement | DiamondElement | LineElement | ArrowElement`
  - `getShapeDrawables(element: SketchyElement): Drawable[]`, drawables in element-local coordinates (origin at the element's `(x, y)`), cached per element object.
- Rendering decisions locked here:
  - `seed` passes to rough.js as `Math.max(1, element.seed)` (rough.js treats 0 as "randomize", which would break cross-client determinism).
  - `sketchiness` maps directly to rough.js `roughness` (0 clean, 1 default, 2 rough).
  - `dashed` maps to `strokeLineDash: [strokeWidth * 4, strokeWidth * 4]`.
  - Fill uses `fillStyle: 'solid'` (pastel solid fills per the product palette, not hachure).
  - Arrows: shaft is a rough `line` for 2 points or a rough `curve` beyond, plus an arrowhead at the last point only: two lines of length `strokeWidth * 4 + 8` at `Math.PI / 6` on each side of the final segment direction.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @tlwb/engine add roughjs
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/engine/test/render/shapes.test.ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { ArrowElement, RectangleElement } from '../../src/model/element'
import { getShapeDrawables } from '../../src/render/shapes'

function rectangle(overrides = {}): RectangleElement {
  return createElement('rectangle', {
    id: 'rect-1',
    index: 'a0',
    seed: 42,
    width: 100,
    height: 60,
    ...overrides,
  }) as RectangleElement
}

describe('getShapeDrawables', () => {
  it('is deterministic for identical elements', () => {
    const first = getShapeDrawables(rectangle())
    const second = getShapeDrawables(rectangle())
    expect(JSON.parse(JSON.stringify(second))).toEqual(
      JSON.parse(JSON.stringify(first)),
    )
  })

  it('returns the cached array for the same element object', () => {
    const element = rectangle()
    expect(getShapeDrawables(element)).toBe(getShapeDrawables(element))
  })

  it('changes output when the seed changes', () => {
    const first = getShapeDrawables(rectangle({ seed: 1 }))
    const second = getShapeDrawables(rectangle({ seed: 2 }))
    expect(JSON.stringify(second)).not.toEqual(JSON.stringify(first))
  })

  it('never passes the randomizing seed 0 to rough.js', () => {
    const drawable = getShapeDrawables(rectangle({ seed: 0 }))[0]
    expect(drawable?.options.seed).toBe(1)
  })

  it('maps stroke style and solid fill onto rough options', () => {
    const drawable = getShapeDrawables(
      rectangle({ strokeStyle: 'dashed', fillColor: '#FADDD8' }),
    )[0]
    expect(drawable?.options.strokeLineDash).toEqual([8, 8])
    expect(drawable?.options.fill).toBe('#FADDD8')
    expect(drawable?.options.fillStyle).toBe('solid')
  })

  it('adds an arrowhead at the tip of an arrow', () => {
    const arrow = createElement('arrow', {
      id: 'arrow-1',
      index: 'a0',
      seed: 7,
      width: 100,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    }) as ArrowElement
    // Shaft plus two arrowhead wings.
    expect(getShapeDrawables(arrow)).toHaveLength(3)
  })

  it('returns no drawables for an arrow without enough points', () => {
    const arrow = createElement('arrow', {
      id: 'arrow-2',
      index: 'a0',
      seed: 7,
    }) as ArrowElement
    expect(getShapeDrawables(arrow)).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, cannot resolve `../../src/render/shapes`.

- [ ] **Step 4: Write the implementation**

```ts
// packages/engine/src/render/shapes.ts
import type { Drawable, Options } from 'roughjs/bin/core'
import { RoughGenerator } from 'roughjs/bin/generator'
import type {
  ArrowElement,
  DiamondElement,
  EllipseElement,
  LineElement,
  RectangleElement,
} from '../model/element'

export type SketchyElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | LineElement
  | ArrowElement

const ARROWHEAD_ANGLE = Math.PI / 6

const generator = new RoughGenerator()
const cache = new WeakMap<SketchyElement, Drawable[]>()

/**
 * Drawables for a sketchy element, in element-local coordinates. Cached
 * on the element object: stores freeze elements and replace them on
 * every update, so identity is a valid cache key.
 */
export function getShapeDrawables(element: SketchyElement): Drawable[] {
  const cached = cache.get(element)
  if (cached) {
    return cached
  }
  const drawables = buildDrawables(element)
  cache.set(element, drawables)
  return drawables
}

function buildDrawables(element: SketchyElement): Drawable[] {
  const options = baseOptions(element)
  switch (element.type) {
    case 'rectangle':
      return [
        generator.rectangle(0, 0, element.width, element.height, options),
      ]
    case 'ellipse':
      return [
        generator.ellipse(
          element.width / 2,
          element.height / 2,
          element.width,
          element.height,
          options,
        ),
      ]
    case 'diamond': {
      const { width, height } = element
      return [
        generator.polygon(
          [
            [width / 2, 0],
            [width, height / 2],
            [width / 2, height],
            [0, height / 2],
          ],
          options,
        ),
      ]
    }
    case 'line': {
      if (element.points.length < 2) {
        return []
      }
      return [
        generator.linearPath(
          element.points.map((point) => [point.x, point.y]),
          options,
        ),
      ]
    }
    case 'arrow':
      return arrowDrawables(element, options)
  }
}

function baseOptions(element: SketchyElement): Options {
  const options: Options = {
    seed: Math.max(1, element.seed),
    roughness: element.sketchiness,
    stroke: element.strokeColor,
    strokeWidth: element.strokeWidth,
  }
  if (element.strokeStyle === 'dashed') {
    options.strokeLineDash = [
      element.strokeWidth * 4,
      element.strokeWidth * 4,
    ]
  }
  if (element.fillColor) {
    options.fill = element.fillColor
    options.fillStyle = 'solid'
  }
  return options
}

function arrowDrawables(
  element: ArrowElement,
  options: Options,
): Drawable[] {
  const points = element.points
  const tip = points.at(-1)
  const beforeTip = points.at(-2)
  if (!tip || !beforeTip) {
    return []
  }
  const shaft =
    points.length === 2
      ? generator.line(beforeTip.x, beforeTip.y, tip.x, tip.y, options)
      : generator.curve(
          points.map((point): [number, number] => [point.x, point.y]),
          options,
        )
  const direction = Math.atan2(tip.y - beforeTip.y, tip.x - beforeTip.x)
  const size = element.strokeWidth * 4 + 8
  const wings = [-1, 1].map((side) =>
    generator.line(
      tip.x,
      tip.y,
      tip.x - size * Math.cos(direction + side * ARROWHEAD_ANGLE),
      tip.y - size * Math.sin(direction + side * ARROWHEAD_ANGLE),
      options,
    ),
  )
  return [shaft, ...wings]
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type { SketchyElement } from './render/shapes'
export { getShapeDrawables } from './render/shapes'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 6: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/render/shapes.ts packages/engine/test/render/shapes.test.ts packages/engine/src/index.ts packages/engine/package.json pnpm-lock.yaml
git commit -m "✨ feat(engine): generate sketchy shape drawables with stable seeds"
```

---

### Task 4: Free drawing outlines with simulated pressure

**Files:**

- Create: `packages/engine/src/render/freehand.ts`
- Test: `packages/engine/test/render/freehand.test.ts`
- Modify: `packages/engine/package.json` (dependency), `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `DrawElement` from `src/model/element.ts`; `getStroke` from `perfect-freehand`.
- Produces:
  - `getFreehandPath(element: DrawElement): string`, an SVG path string of the filled stroke outline in element-local coordinates, `''` when the element has no points, cached per element object.
- Rendering decisions locked here: `size: strokeWidth * 4`, `thinning: 0.6`, `smoothing: 0.5`, `streamline: 0.5`, `simulatePressure: true`, `last: true`. Simulated pressure derives from inter-point distance, so output is deterministic. The outline is emitted as a closed polygon (`M ... L ... Z`); perfect-freehand outlines are dense enough that straight segments are visually smooth.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @tlwb/engine add perfect-freehand
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/engine/test/render/freehand.test.ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { DrawElement, Point } from '../../src/model/element'
import { getFreehandPath } from '../../src/render/freehand'

function draw(points: Point[]): DrawElement {
  return createElement('draw', {
    id: 'draw-1',
    index: 'a0',
    seed: 9,
    points,
  }) as DrawElement
}

const wave: Point[] = Array.from({ length: 20 }, (_, i) => ({
  x: i * 10,
  y: Math.sin(i / 3) * 40,
}))

describe('getFreehandPath', () => {
  it('returns an empty path for an element without points', () => {
    expect(getFreehandPath(draw([]))).toBe('')
  })

  it('returns a closed path', () => {
    const path = getFreehandPath(draw(wave))
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('is deterministic for identical elements', () => {
    expect(getFreehandPath(draw(wave))).toBe(getFreehandPath(draw(wave)))
  })

  it('caches per element object', () => {
    const element = draw(wave)
    const first = getFreehandPath(element)
    expect(getFreehandPath(element)).toBe(first)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, cannot resolve `../../src/render/freehand`.

- [ ] **Step 4: Write the implementation**

```ts
// packages/engine/src/render/freehand.ts
import { getStroke } from 'perfect-freehand'
import type { DrawElement } from '../model/element'

const cache = new WeakMap<DrawElement, string>()

/**
 * SVG path of the filled stroke outline, in element-local coordinates.
 * Pressure is simulated from point spacing, so the same points always
 * produce the same outline on every client.
 */
export function getFreehandPath(element: DrawElement): string {
  const cached = cache.get(element)
  if (cached !== undefined) {
    return cached
  }
  const outline = getStroke(
    element.points.map((point) => [point.x, point.y]),
    {
      size: element.strokeWidth * 4,
      thinning: 0.6,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: true,
      last: true,
    },
  )
  const path = svgPathFromOutline(outline)
  cache.set(element, path)
  return path
}

function svgPathFromOutline(outline: number[][]): string {
  if (outline.length < 3) {
    return ''
  }
  const segments = outline.map((point) => `${point[0]},${point[1]}`)
  return `M${segments[0]}L${segments.slice(1).join(' ')}Z`
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { getFreehandPath } from './render/freehand'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 6: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/render/freehand.ts packages/engine/test/render/freehand.test.ts packages/engine/src/index.ts packages/engine/package.json pnpm-lock.yaml
git commit -m "✨ feat(engine): outline free drawing strokes with simulated pressure"
```

---

### Task 5: Canvas text layout helpers

**Files:**

- Create: `packages/engine/src/render/text.ts`
- Test: `packages/engine/test/render/text.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `TextElement` from `src/model/element.ts`.
- Produces:
  - `interface FontConfig { hand: string; ui: string }`
  - `DEFAULT_FONTS: FontConfig` = `{ hand: 'Caveat, cursive', ui: 'system-ui, sans-serif' }` (the client overrides `hand` with the exact Foundations token)
  - `LINE_HEIGHT = 1.25` (multiplier on `fontSize`)
  - `fontString(element: TextElement, fonts: FontConfig): string` (CSS shorthand for `ctx.font`)
  - `textLines(element: TextElement): string[]` (split on `'\n'`, no wrapping in v1)
  - `textAnchorX(element: TextElement): number` (x of the alignment anchor inside the element frame: `0`, `width / 2`, or `width`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/render/text.test.ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { TextElement } from '../../src/model/element'
import {
  DEFAULT_FONTS,
  fontString,
  textAnchorX,
  textLines,
} from '../../src/render/text'

function text(overrides = {}): TextElement {
  return createElement('text', {
    id: 'text-1',
    index: 'a0',
    width: 200,
    height: 50,
    text: 'hello',
    fontSize: 20,
    ...overrides,
  }) as TextElement
}

describe('fontString', () => {
  it('uses the handwriting family by default', () => {
    expect(fontString(text(), DEFAULT_FONTS)).toBe('20px Caveat, cursive')
  })

  it('uses the ui family when the element asks for it', () => {
    expect(fontString(text({ fontFamily: 'ui' }), DEFAULT_FONTS)).toBe(
      '20px system-ui, sans-serif',
    )
  })
})

describe('textLines', () => {
  it('splits on newlines without wrapping', () => {
    expect(textLines(text({ text: 'one\ntwo\n' }))).toEqual([
      'one',
      'two',
      '',
    ])
  })
})

describe('textAnchorX', () => {
  it('anchors left, center, and right inside the frame', () => {
    expect(textAnchorX(text({ textAlign: 'left' }))).toBe(0)
    expect(textAnchorX(text({ textAlign: 'center' }))).toBe(100)
    expect(textAnchorX(text({ textAlign: 'right' }))).toBe(200)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, cannot resolve `../../src/render/text`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/engine/src/render/text.ts
import type { TextElement } from '../model/element'

export interface FontConfig {
  hand: string
  ui: string
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

export function fontString(
  element: TextElement,
  fonts: FontConfig,
): string {
  return `${element.fontSize}px ${fonts[element.fontFamily]}`
}

/** v1 text has no wrapping: lines are exactly the typed newlines. */
export function textLines(element: TextElement): string[] {
  return element.text.split('\n')
}

/** X of the alignment anchor inside the element frame. */
export function textAnchorX(element: TextElement): number {
  switch (element.textAlign) {
    case 'left':
      return 0
    case 'center':
      return element.width / 2
    case 'right':
      return element.width
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type { FontConfig } from './render/text'
export {
  DEFAULT_FONTS,
  fontString,
  LINE_HEIGHT,
  textAnchorX,
  textLines,
} from './render/text'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/render/text.ts packages/engine/test/render/text.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): add canvas text layout helpers"
```

---

### Task 6: Scene renderer

**Files:**

- Create: `packages/engine/src/render/scene.ts`, `packages/engine/test/setup.ts`
- Test: `packages/engine/test/render/scene.test.ts`
- Modify: `packages/engine/package.json` (dev dependency), `packages/engine/vitest.config.ts` (setup file), `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `Camera`, `visibleRect` (Task 2); `expandRect`, `getElementBounds`, `rectsIntersect` (Task 1); `getShapeDrawables` (Task 3); `getFreehandPath` (Task 4); `DEFAULT_FONTS`, `fontString`, `LINE_HEIGHT`, `textAnchorX`, `textLines`, `FontConfig` (Task 5); `RoughCanvas` from `roughjs/bin/canvas`.
- Produces:
  - `type ImageResolver = (assetHash: string) => CanvasImageSource | null`
  - `interface RenderSceneOptions { elements: readonly BoardElement[]; camera: Camera; viewport: Viewport; devicePixelRatio?: number; fonts?: FontConfig; resolveImage?: ImageResolver; background?: string }`
  - `renderScene(canvas: HTMLCanvasElement, options: RenderSceneOptions): void`
- Behavior locked here:
  - The canvas backing size becomes `round(viewport * devicePixelRatio)` when it differs; the context transform is `dpr` scale, then camera `zoom` scale, then `translate(-camera.x, -camera.y)`.
  - Elements are painted in the given order (back to front); each paints inside `save`/`restore` with `globalAlpha = opacity` and center-pivot rotation; `opacity === 0` skips entirely.
  - Culling: element bounds are tested against the visible world rect expanded by a 32 world-unit margin (stroke overshoot); culled elements touch nothing, not even the image resolver.
  - `draw` elements fill the freehand path with `strokeColor`; `text` paints with `textBaseline 'top'`, one line every `fontSize * LINE_HEIGHT`; unresolved images paint the `#F7F7F5`/`#E5E4E0` placeholder.

- [ ] **Step 1: Add the test rasterizer and wire the setup file**

```bash
pnpm --filter @tlwb/engine add -D @napi-rs/canvas
```

```ts
// packages/engine/test/setup.ts
import { Path2D } from '@napi-rs/canvas'

// The engine references the DOM Path2D global; tests run in Node where
// @napi-rs/canvas provides the implementation.
globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D
```

```ts
// packages/engine/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
})
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/engine/test/render/scene.test.ts
import { type Canvas, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { createCamera } from '../../src/camera'
import { createElement } from '../../src/model/create'
import type { BoardElement } from '../../src/model/element'
import { renderScene } from '../../src/render/scene'

const VIEWPORT = { width: 100, height: 100 }

function render(
  elements: BoardElement[],
  overrides: Record<string, unknown> = {},
): Canvas {
  const canvas = createCanvas(100, 100)
  renderScene(canvas as unknown as HTMLCanvasElement, {
    elements,
    camera: createCamera(),
    viewport: VIEWPORT,
    ...overrides,
  })
  return canvas
}

function rgbaAt(canvas: Canvas, x: number, y: number): number[] {
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)
}

function redSquare(overrides: Record<string, unknown> = {}): BoardElement {
  return createElement('rectangle', {
    id: 'red-1',
    index: 'a0',
    seed: 5,
    x: 20,
    y: 20,
    width: 60,
    height: 60,
    strokeColor: '#FF0000',
    fillColor: '#FF0000',
    sketchiness: 0,
    ...overrides,
  })
}

describe('renderScene', () => {
  it('paints the background on an empty scene', () => {
    expect(rgbaAt(render([]), 50, 50)).toEqual([255, 255, 255, 255])
  })

  it('paints a filled shape', () => {
    expect(rgbaAt(render([redSquare()]), 50, 50)).toEqual([255, 0, 0, 255])
  })

  it('skips fully transparent elements', () => {
    expect(rgbaAt(render([redSquare({ opacity: 0 })]), 50, 50)).toEqual([
      255, 255, 255, 255,
    ])
  })

  it('applies the camera transform', () => {
    const canvas = render([redSquare()], {
      camera: { x: 0, y: 0, zoom: 2 },
    })
    // World (40, 40) is inside the square and lands on screen (80, 80).
    expect(rgbaAt(canvas, 80, 80)).toEqual([255, 0, 0, 255])
    // World (60, 60) lands outside the 100px viewport; screen (10, 10)
    // shows world (5, 5), which is background.
    expect(rgbaAt(canvas, 10, 10)).toEqual([255, 255, 255, 255])
  })

  it('sizes the backing store from the device pixel ratio', () => {
    const canvas = render([], { devicePixelRatio: 2 })
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(200)
  })

  it('culls elements outside the viewport without touching them', () => {
    const resolved: string[] = []
    const resolveImage = (assetHash: string) => {
      resolved.push(assetHash)
      return null
    }
    const inside = createElement('image', {
      id: 'img-in',
      index: 'a0',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      assetHash: 'inside',
    })
    const outside = createElement('image', {
      id: 'img-out',
      index: 'a1',
      x: 5000,
      y: 5000,
      width: 20,
      height: 20,
      assetHash: 'outside',
    })
    render([inside, outside], { resolveImage })
    expect(resolved).toEqual(['inside'])
  })

  it('paints a placeholder for unresolved images', () => {
    const image = createElement('image', {
      id: 'img-1',
      index: 'a0',
      x: 20,
      y: 20,
      width: 60,
      height: 60,
      assetHash: 'missing',
    })
    // #F7F7F5 placeholder fill.
    expect(rgbaAt(render([image]), 50, 50)).toEqual([247, 247, 245, 255])
  })

  it('draws resolved images', () => {
    const blue = createCanvas(20, 20)
    const blueCtx = blue.getContext('2d')
    blueCtx.fillStyle = '#0000FF'
    blueCtx.fillRect(0, 0, 20, 20)
    const image = createElement('image', {
      id: 'img-2',
      index: 'a0',
      x: 20,
      y: 20,
      width: 60,
      height: 60,
      assetHash: 'blue',
    })
    const canvas = render([image], {
      resolveImage: () => blue as unknown as CanvasImageSource,
    })
    expect(rgbaAt(canvas, 50, 50)).toEqual([0, 0, 255, 255])
  })

  it('fills free drawing strokes', () => {
    const draw = createElement('draw', {
      id: 'draw-1',
      index: 'a0',
      seed: 3,
      x: 10,
      y: 50,
      width: 80,
      height: 0,
      strokeColor: '#FF0000',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 80, y: 0 },
      ],
    })
    // The stroke passes through world (50, 50) with a 4px half-width.
    expect(rgbaAt(render([draw]), 50, 50)).toEqual([255, 0, 0, 255])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, cannot resolve `../../src/render/scene`.

- [ ] **Step 4: Write the implementation**

```ts
// packages/engine/src/render/scene.ts
import { RoughCanvas } from 'roughjs/bin/canvas'
import { type Camera, type Viewport, visibleRect } from '../camera'
import {
  expandRect,
  getElementBounds,
  rectsIntersect,
} from '../geometry/bounds'
import type {
  BoardElement,
  ImageElement,
  TextElement,
} from '../model/element'
import { getFreehandPath } from './freehand'
import { getShapeDrawables } from './shapes'
import {
  DEFAULT_FONTS,
  type FontConfig,
  fontString,
  LINE_HEIGHT,
  textAnchorX,
  textLines,
} from './text'

export type ImageResolver = (assetHash: string) => CanvasImageSource | null

export interface RenderSceneOptions {
  /** Sorted back to front, as `BoardStore.listElements()` returns them. */
  elements: readonly BoardElement[]
  camera: Camera
  /** CSS pixels; the backing store scales by `devicePixelRatio`. */
  viewport: Viewport
  devicePixelRatio?: number
  fonts?: FontConfig
  resolveImage?: ImageResolver
  background?: string
}

/** World-unit slack for stroke overshoot around sketchy outlines. */
const CULLING_MARGIN = 32

const noImage: ImageResolver = () => null

export function renderScene(
  canvas: HTMLCanvasElement,
  options: RenderSceneOptions,
): void {
  const {
    elements,
    camera,
    viewport,
    devicePixelRatio = 1,
    fonts = DEFAULT_FONTS,
    resolveImage = noImage,
    background = '#FFFFFF',
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
  const rough = new RoughCanvas(canvas)
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, viewport.width, viewport.height)
  ctx.scale(camera.zoom, camera.zoom)
  ctx.translate(-camera.x, -camera.y)
  const visible = expandRect(
    visibleRect(camera, viewport),
    CULLING_MARGIN,
  )
  for (const element of elements) {
    if (element.opacity === 0) {
      continue
    }
    if (!rectsIntersect(getElementBounds(element), visible)) {
      continue
    }
    ctx.save()
    ctx.globalAlpha = element.opacity
    ctx.translate(
      element.x + element.width / 2,
      element.y + element.height / 2,
    )
    ctx.rotate(element.angle)
    ctx.translate(-element.width / 2, -element.height / 2)
    paintElement(ctx, rough, element, fonts, resolveImage)
    ctx.restore()
  }
}

function paintElement(
  ctx: CanvasRenderingContext2D,
  rough: RoughCanvas,
  element: BoardElement,
  fonts: FontConfig,
  resolveImage: ImageResolver,
): void {
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'line':
    case 'arrow': {
      for (const drawable of getShapeDrawables(element)) {
        rough.draw(drawable)
      }
      return
    }
    case 'draw': {
      const path = getFreehandPath(element)
      if (path === '') {
        return
      }
      ctx.fillStyle = element.strokeColor
      ctx.fill(new Path2D(path))
      return
    }
    case 'text':
      paintText(ctx, element, fonts)
      return
    case 'image':
      paintImage(ctx, element, resolveImage)
      return
  }
}

function paintText(
  ctx: CanvasRenderingContext2D,
  element: TextElement,
  fonts: FontConfig,
): void {
  ctx.fillStyle = element.strokeColor
  ctx.font = fontString(element, fonts)
  ctx.textAlign = element.textAlign
  ctx.textBaseline = 'top'
  const anchorX = textAnchorX(element)
  textLines(element).forEach((line, row) => {
    ctx.fillText(line, anchorX, row * element.fontSize * LINE_HEIGHT)
  })
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  element: ImageElement,
  resolveImage: ImageResolver,
): void {
  const image = resolveImage(element.assetHash)
  if (image) {
    ctx.drawImage(image, 0, 0, element.width, element.height)
    return
  }
  ctx.fillStyle = '#F7F7F5'
  ctx.fillRect(0, 0, element.width, element.height)
  ctx.strokeStyle = '#E5E4E0'
  ctx.lineWidth = 2
  ctx.strokeRect(0, 0, element.width, element.height)
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type { ImageResolver, RenderSceneOptions } from './render/scene'
export { renderScene } from './render/scene'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS. If the freehand pixel assertion is off by the stroke
taper, sample `(50, 50)` against the midpoint of the stroke rather than
its start; the stroke center at mid-path is fully opaque.

- [ ] **Step 6: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/render/scene.ts packages/engine/test/render/scene.test.ts packages/engine/test/setup.ts packages/engine/vitest.config.ts packages/engine/src/index.ts packages/engine/package.json pnpm-lock.yaml
git commit -m "✨ feat(engine): render board scenes onto a canvas"
```

---

### Task 7: Invalidation-driven render loop

**Files:**

- Create: `packages/engine/src/render/renderer.ts`
- Test: `packages/engine/test/render/renderer.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `BoardStore` from `src/store/types.ts`; `Camera`, `clampZoom`, `createCamera` (Task 2); `renderScene`, `ImageResolver` (Task 6); `FontConfig` (Task 5).
- Produces:
  - `interface RendererOptions { canvas: HTMLCanvasElement; store: BoardStore; width: number; height: number; devicePixelRatio?: number; fonts?: FontConfig; resolveImage?: ImageResolver; background?: string; requestFrame?: (callback: () => void) => void }`
  - `interface Renderer { getCamera(): Camera; setCamera(camera: Camera): void; resize(width: number, height: number): void; markDirty(): void; destroy(): void }`
  - `createRenderer(options: RendererOptions): Renderer`
- Behavior locked here:
  - There is no continuous loop: `markDirty` schedules exactly one frame through `requestFrame` (default `requestAnimationFrame`, falling back to a 16 ms `setTimeout` where it does not exist); further `markDirty` calls before the frame runs coalesce into it.
  - The renderer subscribes to the store and marks dirty on every event; it schedules one initial frame at creation.
  - `setCamera` clamps zoom through `clampZoom` and marks dirty; `resize` updates the viewport and marks dirty.
  - `destroy` unsubscribes and turns every later frame and `markDirty` into a no-op.

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/render/renderer.test.ts
import { type Canvas, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { MAX_ZOOM } from '../../src/camera'
import { createElement } from '../../src/model/create'
import { createRenderer } from '../../src/render/renderer'
import { InMemoryBoardStore } from '../../src/store/memory'

function harness() {
  const frames: (() => void)[] = []
  const store = new InMemoryBoardStore()
  const canvas = createCanvas(100, 100)
  const renderer = createRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    store,
    width: 100,
    height: 100,
    requestFrame: (callback) => {
      frames.push(callback)
    },
  })
  const flush = () => {
    for (const frame of frames.splice(0)) {
      frame()
    }
  }
  return { canvas, frames, flush, renderer, store }
}

function rgbaAt(canvas: Canvas, x: number, y: number): number[] {
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)
}

const redSquare = () =>
  createElement('rectangle', {
    id: 'red-1',
    index: 'a0',
    seed: 5,
    x: 20,
    y: 20,
    width: 60,
    height: 60,
    strokeColor: '#FF0000',
    fillColor: '#FF0000',
    sketchiness: 0,
  })

describe('createRenderer', () => {
  it('schedules one initial frame and paints the store on flush', () => {
    const { canvas, frames, flush, store } = harness()
    expect(frames).toHaveLength(1)
    store.applyChanges([{ kind: 'create', element: redSquare() }])
    flush()
    expect(rgbaAt(canvas, 50, 50)).toEqual([255, 0, 0, 255])
  })

  it('coalesces store events into a single pending frame', () => {
    const { frames, flush, store } = harness()
    flush()
    store.applyChanges([{ kind: 'create', element: redSquare() }])
    store.applyChanges([{ kind: 'update', id: 'red-1', props: { x: 30 } }])
    store.applyChanges([{ kind: 'update', id: 'red-1', props: { y: 30 } }])
    expect(frames).toHaveLength(1)
    flush()
    store.applyChanges([{ kind: 'update', id: 'red-1', props: { x: 40 } }])
    expect(frames).toHaveLength(1)
  })

  it('clamps the camera zoom', () => {
    const { renderer } = harness()
    renderer.setCamera({ x: 0, y: 0, zoom: 1000 })
    expect(renderer.getCamera().zoom).toBe(MAX_ZOOM)
  })

  it('repaints through the camera on flush', () => {
    const { canvas, flush, renderer, store } = harness()
    store.applyChanges([{ kind: 'create', element: redSquare() }])
    renderer.setCamera({ x: 0, y: 0, zoom: 2 })
    flush()
    expect(rgbaAt(canvas, 80, 80)).toEqual([255, 0, 0, 255])
  })

  it('stops scheduling after destroy', () => {
    const { frames, flush, renderer, store } = harness()
    flush()
    renderer.destroy()
    store.applyChanges([{ kind: 'create', element: redSquare() }])
    renderer.markDirty()
    expect(frames).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL, cannot resolve `../../src/render/renderer`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/engine/src/render/renderer.ts
import { type Camera, clampZoom, createCamera } from '../camera'
import type { BoardStore } from '../store/types'
import { type ImageResolver, renderScene } from './scene'
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
  requestFrame?: (callback: () => void) => void
}

export interface Renderer {
  getCamera(): Camera
  setCamera(camera: Camera): void
  resize(width: number, height: number): void
  markDirty(): void
  destroy(): void
}

const defaultRequestFrame = (callback: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback())
  } else {
    setTimeout(callback, 16)
  }
}

/**
 * Binds a canvas to a board store: every store event invalidates the
 * scene, and at most one frame is pending at any time. There is no
 * continuous loop; a clean board costs nothing.
 */
export function createRenderer(options: RendererOptions): Renderer {
  const { canvas, store, requestFrame = defaultRequestFrame } = options
  let camera = createCamera()
  let viewport = { width: options.width, height: options.height }
  let dirty = false
  let destroyed = false

  const renderNow = (): void => {
    renderScene(canvas, {
      elements: store.listElements(),
      camera,
      viewport,
      devicePixelRatio: options.devicePixelRatio,
      fonts: options.fonts,
      resolveImage: options.resolveImage,
      background: options.background,
    })
  }

  const markDirty = (): void => {
    if (dirty || destroyed) {
      return
    }
    dirty = true
    requestFrame(() => {
      dirty = false
      if (destroyed) {
        return
      }
      renderNow()
    })
  }

  const unsubscribe = store.subscribe(() => markDirty())
  markDirty()

  return {
    getCamera: () => camera,
    setCamera: (next) => {
      camera = { ...next, zoom: clampZoom(next.zoom) }
      markDirty()
    },
    resize: (width, height) => {
      viewport = { width, height }
      markDirty()
    },
    markDirty,
    destroy: () => {
      destroyed = true
      unsubscribe()
    },
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type { Renderer, RendererOptions } from './render/renderer'
export { createRenderer } from './render/renderer'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/render/renderer.ts packages/engine/test/render/renderer.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): drive rendering with an invalidation loop"
```

---

### Task 8: Visual regression suite over reference scenes

**Files:**

- Create: `packages/engine/test/visual/scenes.ts`, `packages/engine/test/visual/visual.test.ts`, `packages/engine/test/visual/fixtures/Caveat.ttf`, `packages/engine/test/visual/fixtures/OFL.txt`
- Modify: `packages/engine/test/setup.ts` (font registration), `packages/engine/package.json` (dev dependency + script), `.gitignore` (diff output)
- Generated and committed: `packages/engine/test/visual/__baselines__/shapes.png`, `freehand.png`, `text.png`

**Interfaces:**

- Consumes: `renderScene` (Task 6), `createCamera` (Task 2), `createElement`; `pixelmatch`; `createCanvas`, `loadImage`, `GlobalFonts` from `@napi-rs/canvas`.
- Produces: three reference scene builders (`shapesScene()`, `freehandScene()`, `textScene(): BoardElement[]`), committed PNG baselines, and the update flow `pnpm --filter @tlwb/engine test:visual:update`.
- Comparison contract: 720x560 viewport at DPR 1, `pixelmatch` threshold `0.12`, failure above `0.2%` mismatched pixels; on failure the diff PNG lands in `test/visual/__diffs__/` (gitignored). Determinism holds because seeds are fixed, freehand pressure is simulated, and `@napi-rs/canvas` bundles its own Skia and the test font.

- [ ] **Step 1: Add the dev dependency, the script, and the font fixture**

```bash
pnpm --filter @tlwb/engine add -D pixelmatch
mkdir -p packages/engine/test/visual/fixtures
curl -fsSL -o 'packages/engine/test/visual/fixtures/Caveat.ttf' 'https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf'
curl -fsSL -o 'packages/engine/test/visual/fixtures/OFL.txt' 'https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/OFL.txt'
```

Add to `packages/engine/package.json` scripts:

```json
"test:visual:update": "UPDATE_BASELINES=1 vitest run test/visual"
```

Append to the root `.gitignore`:

```gitignore
__diffs__/
```

Replace `packages/engine/test/setup.ts` with:

```ts
// packages/engine/test/setup.ts
import { fileURLToPath } from 'node:url'
import { GlobalFonts, Path2D } from '@napi-rs/canvas'

// The engine references the DOM Path2D global; tests run in Node where
// @napi-rs/canvas provides the implementation.
globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D

// Caveat (SIL OFL, see test/visual/fixtures/OFL.txt) keeps text
// rasterization identical on every platform Skia runs on.
GlobalFonts.registerFromPath(
  fileURLToPath(new URL('./visual/fixtures/Caveat.ttf', import.meta.url)),
  'Caveat',
)
```

- [ ] **Step 2: Write the reference scenes**

```ts
// packages/engine/test/visual/scenes.ts
import { createElement } from '../../src/model/create'
import type { BoardElement, Point } from '../../src/model/element'

/** Every id, index, and seed is fixed: these scenes must never vary. */
export function shapesScene(): BoardElement[] {
  return [
    createElement('rectangle', {
      id: 'rect-1',
      index: 'a0',
      seed: 101,
      x: 40,
      y: 40,
      width: 180,
      height: 120,
    }),
    createElement('rectangle', {
      id: 'rect-2',
      index: 'a1',
      seed: 102,
      x: 260,
      y: 40,
      width: 180,
      height: 120,
      strokeColor: '#C0392B',
      fillColor: '#FADDD8',
      strokeStyle: 'dashed',
    }),
    createElement('ellipse', {
      id: 'ellipse-1',
      index: 'a2',
      seed: 103,
      x: 480,
      y: 40,
      width: 200,
      height: 120,
      sketchiness: 2,
    }),
    createElement('diamond', {
      id: 'diamond-1',
      index: 'a3',
      seed: 104,
      x: 40,
      y: 220,
      width: 160,
      height: 140,
      fillColor: '#D6E9F8',
    }),
    createElement('line', {
      id: 'line-1',
      index: 'a4',
      seed: 105,
      x: 260,
      y: 230,
      width: 200,
      height: 90,
      points: [
        { x: 0, y: 90 },
        { x: 100, y: 0 },
        { x: 200, y: 60 },
      ],
    }),
    createElement('arrow', {
      id: 'arrow-1',
      index: 'a5',
      seed: 106,
      x: 500,
      y: 220,
      width: 180,
      height: 120,
      strokeWidth: 3,
      points: [
        { x: 0, y: 120 },
        { x: 180, y: 0 },
      ],
    }),
    createElement('rectangle', {
      id: 'rect-3',
      index: 'a6',
      seed: 107,
      x: 280,
      y: 400,
      width: 160,
      height: 100,
      angle: Math.PI / 8,
      opacity: 0.5,
    }),
  ]
}

export function freehandScene(): BoardElement[] {
  const points: Point[] = Array.from({ length: 48 }, (_, i) => ({
    x: i * 12,
    y: 80 + Math.sin(i / 4) * 60,
  }))
  return [
    createElement('draw', {
      id: 'draw-1',
      index: 'a0',
      seed: 201,
      x: 80,
      y: 180,
      width: 570,
      height: 160,
      strokeWidth: 3,
      points,
    }),
  ]
}

export function textScene(): BoardElement[] {
  return [
    createElement('text', {
      id: 'text-1',
      index: 'a0',
      seed: 301,
      x: 80,
      y: 80,
      width: 480,
      height: 130,
      text: 'tlwb sketches ideas\nacross two lines',
      fontSize: 44,
    }),
    createElement('text', {
      id: 'text-2',
      index: 'a1',
      seed: 302,
      x: 80,
      y: 320,
      width: 480,
      height: 60,
      text: 'centered label',
      fontSize: 30,
      textAlign: 'center',
    }),
  ]
}
```

- [ ] **Step 3: Write the failing test**

```ts
// packages/engine/test/visual/visual.test.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Canvas, createCanvas, loadImage } from '@napi-rs/canvas'
import pixelmatch from 'pixelmatch'
import { describe, expect, it } from 'vitest'
import { createCamera } from '../../src/camera'
import type { BoardElement } from '../../src/model/element'
import { renderScene } from '../../src/render/scene'
import { freehandScene, shapesScene, textScene } from './scenes'

const WIDTH = 720
const HEIGHT = 560
const THRESHOLD = 0.12
const MAX_MISMATCH_RATIO = 0.002
const update = process.env.UPDATE_BASELINES === '1'

const pathTo = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url))

function renderToCanvas(elements: BoardElement[]): Canvas {
  const canvas = createCanvas(WIDTH, HEIGHT)
  renderScene(canvas as unknown as HTMLCanvasElement, {
    elements,
    camera: createCamera(),
    viewport: { width: WIDTH, height: HEIGHT },
    fonts: { hand: 'Caveat', ui: 'Caveat' },
  })
  return canvas
}

async function expectMatchesBaseline(
  name: string,
  canvas: Canvas,
): Promise<void> {
  const baselinePath = pathTo(`__baselines__/${name}.png`)
  if (update) {
    mkdirSync(pathTo('__baselines__'), { recursive: true })
    writeFileSync(baselinePath, canvas.toBuffer('image/png'))
    return
  }
  if (!existsSync(baselinePath)) {
    throw new Error(
      `Missing baseline ${name}.png. Run` +
        ' `pnpm --filter @tlwb/engine test:visual:update`,' +
        ' review the PNG, and commit it.',
    )
  }
  const actual = canvas
    .getContext('2d')
    .getImageData(0, 0, WIDTH, HEIGHT)
  const baselineCanvas = createCanvas(WIDTH, HEIGHT)
  const baselineCtx = baselineCanvas.getContext('2d')
  baselineCtx.drawImage(await loadImage(baselinePath), 0, 0)
  const expected = baselineCtx.getImageData(0, 0, WIDTH, HEIGHT)
  const diffCanvas = createCanvas(WIDTH, HEIGHT)
  const diffCtx = diffCanvas.getContext('2d')
  const diffImage = diffCtx.createImageData(WIDTH, HEIGHT)
  const mismatched = pixelmatch(
    actual.data,
    expected.data,
    diffImage.data,
    WIDTH,
    HEIGHT,
    { threshold: THRESHOLD },
  )
  const ratio = mismatched / (WIDTH * HEIGHT)
  if (ratio > MAX_MISMATCH_RATIO) {
    mkdirSync(pathTo('__diffs__'), { recursive: true })
    diffCtx.putImageData(diffImage, 0, 0)
    writeFileSync(
      pathTo(`__diffs__/${name}.png`),
      diffCanvas.toBuffer('image/png'),
    )
  }
  expect(ratio).toBeLessThanOrEqual(MAX_MISMATCH_RATIO)
}

describe('visual regression', () => {
  it('matches the shapes baseline', async () => {
    await expectMatchesBaseline('shapes', renderToCanvas(shapesScene()))
  })

  it('matches the freehand baseline', async () => {
    await expectMatchesBaseline('freehand', renderToCanvas(freehandScene()))
  })

  it('matches the text baseline', async () => {
    await expectMatchesBaseline('text', renderToCanvas(textScene()))
  })
})
```

- [ ] **Step 4: Run the test to verify it fails for the right reason**

Run: `pnpm --filter @tlwb/engine test`
Expected: FAIL on all three visual tests with the "Missing baseline" error (not an import or type error).

- [ ] **Step 5: Generate the baselines and inspect them**

```bash
pnpm --filter @tlwb/engine test:visual:update
```

Open the three PNGs under `packages/engine/test/visual/__baselines__/`
and check them by eye: sketchy outlines on every shape, dashed red
rectangle with a pastel fill, rougher ellipse, one arrowhead on the
arrow, a rotated half-transparent rectangle, a tapering freehand wave,
and Caveat handwriting on both text blocks (left and centered). A blank
or system-font baseline means the scene or the font registration is
wrong; fix that before committing.

- [ ] **Step 6: Run the full suite to verify it passes against the baselines**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS, including the three visual tests.

- [ ] **Step 7: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/test/visual packages/engine/test/setup.ts packages/engine/package.json pnpm-lock.yaml .gitignore
git commit -m "✅ test(engine): add visual regression suite over reference scenes"
```

---

## Verification

After the last task, from the repository root:

- `pnpm check` passes (formatting, lint, import order).
- `pnpm typecheck` passes on Node 22 and 24 semantics (CI runs both).
- `pnpm test` passes, including the visual suite, with no React, Yjs, network, or DOM dependency beyond the canvas types.

## Out of Scope

Deferred to the next plans of the series: hit-testing on real geometry,
tool state machines and selection, the `createEditor` public API, PNG and
SVG export as API surface, image asset storage and upload, `store-yjs`,
the React client, and the collaboration server. The 60 fps on 1000
elements criterion is addressed structurally here (culling, per-element
caches, invalidation-only frames) and gets measured once the client
exists.
