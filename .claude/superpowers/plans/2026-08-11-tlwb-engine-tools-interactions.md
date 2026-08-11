# tlwb Engine Tools and Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the interaction layer of `packages/engine`: hit-testing
on real geometry, selection with groups and lasso, one state machine per
tool (select, hand, rectangle, ellipse, diamond, arrow, line, draw,
text, image, eraser), resize and rotate handles, light snapping, arrow
bindings that follow their shapes, keyboard shortcuts, and a headless
interaction controller that ties them together.

**Architecture:** Third plan of the canvas engine series defined by
`.claude/superpowers/specs/2026-08-08-tlwb-canvas-engine-realtime-design.md`
(section 4, "Tools and interactions"). Everything lives in
`packages/engine` and mutates the board exclusively through the
`BoardStore` interface, so every gesture streams through the same
pipeline collaborators and agents use. Pure geometry (hit-testing,
transforms, snapping, bindings) is separated from tool state machines,
which are separated from the controller that routes pointer and
keyboard input. Nothing here touches the DOM: the controller consumes
already-projected `PointerInput` values and exposes an
`InteractionSnapshot` that the next plan's overlay rendering and
`createEditor` DOM binding will consume.

**Tech Stack:** TypeScript (strict), Vitest. No new dependencies: the
whole layer is pure TypeScript over the existing store and geometry
modules.

## Global Constraints

- License: MIT, copyright JDevelop.
- All file content, code, comments, and commit messages in English.
- Commits: gitmoji + Conventional Commits (`<emoji> <type>(<scope>): <summary>`).
- TDD is mandatory: every behavior lands red first, then green.
- Node.js >= 22, pnpm 11, `"type": "module"` (ESM only), TypeScript `strict` plus `noUncheckedIndexedAccess`.
- `packages/engine` runtime dependencies stay exactly `fractional-indexing`, `zod`, `roughjs`, `perfect-freehand`. This plan adds nothing, dev dependencies included. No React, no Yjs, no network code, no DOM beyond the types already granted by the `DOM` lib.
- Angles are radians. Rotation pivots on the element center.
- `points` of `line`, `arrow`, and `draw` elements are relative to the element origin `(x, y)`, and tools keep `width`/`height` enclosing the points so the element frame stays a valid culling box.
- Screen-space constants (hit tolerance, handle size, snap threshold) are expressed in CSS pixels and divided by `camera.zoom` at the call site, so behavior feels identical at every zoom level.
- The toolbar order fixed by the Paper artboards is: select, hand, rectangle, ellipse, diamond, arrow, line, draw, text, image, eraser. Numbered shortcuts follow that order: `1` through `9`, then `0` for image and `E` for eraser.
- All commands run from the repository root.

## File Structure

- `src/geometry/points.ts`: point and segment primitives (distance, distance to segment, point in polygon, segment intersection) plus `normalizeLinearPoints`, the frame rebuild every linear tool relies on.
- `src/geometry/hit.ts`: local-frame transforms and hit-testing on real geometry (outline hits for hollow shapes, interior hits for filled ones, polyline distance for linear elements), plus topmost scene hit.
- `src/geometry/transform.ts`: resize and rotate handle model and math.
- `src/geometry/snap.ts`: move snapping against other elements' edges and centers, with alignment guides.
- `src/selection.ts`: pure selection queries: group expansion, selection bounds, lasso containment.
- `src/model/operations.ts`: change-batch builders over a selection: delete (with binding cleanup and bound-label cascade), duplicate (with id, group, and binding remapping), group, ungroup, z-order.
- `src/model/bindings.ts`: arrow binding helpers: find a bind target, attachment point on a shape outline, updates for arrows whose bound shapes moved.
- `src/store/types.ts`, `src/store/memory.ts`, `src/store/contract.ts` (modified): undo capture boundaries (`stopCapturing`), so a whole gesture undoes as one step while streaming live.
- `src/tools/types.ts`: `Tool`, `ToolContext`, `PointerInput`, `ToolType`, shared constants and helpers.
- `src/tools/hand.ts`, `src/tools/shape.ts`, `src/tools/linear.ts`, `src/tools/draw.ts`, `src/tools/eraser.ts`, `src/tools/text.ts`, `src/tools/image.ts`, `src/tools/select.ts`: one state machine per tool.
- `src/keyboard.ts`: pure resolution of keyboard input to editor actions.
- `src/interaction/controller.ts`: `createInteractionController`, the headless object that owns the active tool and the selection, routes input, executes keyboard actions, and exposes `InteractionSnapshot`.
- `test/tools/helpers.ts`: shared test `ToolContext` over `InMemoryBoardStore`.

The next plan (`createEditor` public API) binds DOM events to the
controller, paints the interaction snapshot as a canvas overlay
(selection box, handles, lasso, snap guides), and adds PNG/SVG export.

---

### Task 1: Hit-testing on real geometry

**Files:**

- Create: `packages/engine/src/geometry/points.ts`
- Create: `packages/engine/src/geometry/hit.ts`
- Test: `packages/engine/test/geometry/points.test.ts`
- Test: `packages/engine/test/geometry/hit.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `BoardElement`, `Point` from `src/model/element.ts`; `createElement` in tests.
- Produces:
  - `distance(a: Point, b: Point): number`
  - `distanceToSegment(point: Point, a: Point, b: Point): number`
  - `pointInPolygon(point: Point, polygon: readonly Point[]): boolean`
  - `segmentsIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null`
  - `interface LinearFrame { x: number; y: number; width: number; height: number; points: Point[] }`
  - `normalizeLinearPoints(worldPoints: readonly Point[]): LinearFrame`
  - `toLocalPoint(element: BoardElement, point: Point): Point` (world to unrotated local frame)
  - `toWorldPoint(element: BoardElement, local: Point): Point` (inverse)
  - `hitTestElement(element: BoardElement, point: Point, tolerance: number): boolean` (outline for hollow shapes, interior for filled ones; `tolerance` in world units)
  - `hitTestElementInterior(element: BoardElement, point: Point, tolerance: number): boolean` (shapes always treated as filled; used by bindings)
  - `hitTestScene(elements: readonly BoardElement[], point: Point, tolerance: number): BoardElement | null` (topmost; `elements` sorted back to front as `BoardStore.listElements()` returns them; skips `opacity === 0`)

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/geometry/points.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  distance,
  distanceToSegment,
  normalizeLinearPoints,
  pointInPolygon,
  segmentsIntersection,
} from '../../src/geometry/points'

describe('distance', () => {
  it('measures the euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('distanceToSegment', () => {
  it('projects onto the segment interior', () => {
    const d = distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(d).toBe(3)
  })

  it('clamps to the nearest endpoint beyond the segment', () => {
    const d = distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(d).toBe(5)
  })

  it('degenerates to point distance on a zero-length segment', () => {
    const d = distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })
    expect(d).toBe(5)
  })
})

describe('pointInPolygon', () => {
  const diamond = [
    { x: 5, y: 0 },
    { x: 10, y: 5 },
    { x: 5, y: 10 },
    { x: 0, y: 5 },
  ]

  it('accepts an interior point', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, diamond)).toBe(true)
  })

  it('rejects a bounding-box corner outside the polygon', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, diamond)).toBe(false)
  })
})

describe('segmentsIntersection', () => {
  it('returns the crossing point of two segments', () => {
    const hit = segmentsIntersection(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    )
    expect(hit).toEqual({ x: 5, y: 5 })
  })

  it('returns null when the segments do not cross', () => {
    const hit = segmentsIntersection(
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    )
    expect(hit).toBeNull()
  })
})

describe('normalizeLinearPoints', () => {
  it('anchors the frame at the top-left of the points', () => {
    const frame = normalizeLinearPoints([
      { x: 30, y: 50 },
      { x: 10, y: 90 },
    ])
    expect(frame).toEqual({
      x: 10,
      y: 50,
      width: 20,
      height: 40,
      points: [
        { x: 20, y: 0 },
        { x: 0, y: 40 },
      ],
    })
  })

  it('returns an empty frame for no points', () => {
    expect(normalizeLinearPoints([])).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: [],
    })
  })
})
```

`packages/engine/test/geometry/hit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  hitTestElement,
  hitTestElementInterior,
  hitTestScene,
  toLocalPoint,
  toWorldPoint,
} from '../../src/geometry/hit'
import { createElement } from '../../src/model/create'

const TOLERANCE = 4

describe('toLocalPoint / toWorldPoint', () => {
  it('round-trips through a rotated frame', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 100,
      y: 100,
      width: 40,
      height: 20,
      angle: Math.PI / 3,
    })
    const world = { x: 117, y: 93 }
    expect(toWorldPoint(element, toLocalPoint(element, world)).x).toBeCloseTo(
      world.x,
    )
    expect(toWorldPoint(element, toLocalPoint(element, world)).y).toBeCloseTo(
      world.y,
    )
  })
})

describe('hitTestElement', () => {
  it('hits a hollow rectangle on its border, not in its middle', () => {
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    })
    expect(hitTestElement(rectangle, { x: 50, y: 1 }, TOLERANCE)).toBe(true)
    expect(hitTestElement(rectangle, { x: 50, y: 40 }, TOLERANCE)).toBe(false)
  })

  it('hits a filled rectangle anywhere inside', () => {
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      fillColor: '#FFD8CF',
    })
    expect(hitTestElement(rectangle, { x: 50, y: 40 }, TOLERANCE)).toBe(true)
  })

  it('misses the bounding-box corner of an ellipse', () => {
    const ellipse = createElement('ellipse', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    expect(hitTestElement(ellipse, { x: 6, y: 6 }, TOLERANCE)).toBe(false)
    expect(hitTestElement(ellipse, { x: 50, y: 2 }, TOLERANCE)).toBe(true)
  })

  it('misses the bounding-box corner of a diamond but hits its edge', () => {
    const diamond = createElement('diamond', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(hitTestElement(diamond, { x: 8, y: 8 }, TOLERANCE)).toBe(false)
    expect(hitTestElement(diamond, { x: 26, y: 26 }, TOLERANCE)).toBe(true)
  })

  it('hits a line near any of its segments', () => {
    const line = createElement('line', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    })
    expect(hitTestElement(line, { x: 102, y: 50 }, TOLERANCE)).toBe(true)
    expect(hitTestElement(line, { x: 50, y: 50 }, TOLERANCE)).toBe(false)
  })

  it('hits text and image anywhere in their box', () => {
    const text = createElement('text', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 60,
      height: 24,
      text: 'hello',
    })
    expect(hitTestElement(text, { x: 30, y: 12 }, TOLERANCE)).toBe(true)
    expect(hitTestElement(text, { x: 30, y: 40 }, TOLERANCE)).toBe(false)
  })

  it('respects rotation', () => {
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 10,
      angle: Math.PI / 2,
    })
    // Rotated 90 degrees around (50, 5): now spans x in [45, 55], y in [-45, 55].
    expect(hitTestElement(rectangle, { x: 50, y: -40 }, TOLERANCE)).toBe(true)
    expect(hitTestElement(rectangle, { x: 5, y: 5 }, TOLERANCE)).toBe(false)
  })
})

describe('hitTestElementInterior', () => {
  it('treats hollow shapes as filled', () => {
    const rectangle = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    })
    expect(hitTestElementInterior(rectangle, { x: 50, y: 40 }, TOLERANCE)).toBe(
      true,
    )
    expect(
      hitTestElementInterior(rectangle, { x: 120, y: 40 }, TOLERANCE),
    ).toBe(false)
  })
})

describe('hitTestScene', () => {
  it('returns the topmost hit and skips invisible elements', () => {
    const back = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    const front = createElement('rectangle', {
      index: 'a1',
      x: 25,
      y: 25,
      width: 50,
      height: 50,
      fillColor: '#D9F2E5',
    })
    const invisible = createElement('rectangle', {
      index: 'a2',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFF9C9',
      opacity: 0,
    })
    const elements = [back, front, invisible]
    expect(hitTestScene(elements, { x: 50, y: 50 }, TOLERANCE)?.id).toBe(
      front.id,
    )
    expect(hitTestScene(elements, { x: 5, y: 5 }, TOLERANCE)?.id).toBe(back.id)
    expect(hitTestScene(elements, { x: 200, y: 200 }, TOLERANCE)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test test/geometry/points.test.ts test/geometry/hit.test.ts`
Expected: FAIL, both files cannot resolve their imports.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/geometry/points.ts`:

```ts
import type { Point } from '../model/element'

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lengthSquared = abx * abx + aby * aby
  if (lengthSquared === 0) {
    return distance(point, a)
  }
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared),
  )
  return distance(point, { x: a.x + t * abx, y: a.y + t * aby })
}

/** Ray-casting test; points exactly on an edge are not guaranteed either way. */
export function pointInPolygon(
  point: Point,
  polygon: readonly Point[],
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i] as Point
    const pj = polygon[j] as Point
    if (
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x
    ) {
      inside = !inside
    }
  }
  return inside
}

export function segmentsIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): Point | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y
  const denominator = d1x * d2y - d1y * d2x
  if (denominator === 0) {
    return null
  }
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denominator
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return null
  }
  return { x: p1.x + t * d1x, y: p1.y + t * d1y }
}

export interface LinearFrame {
  x: number
  y: number
  width: number
  height: number
  points: Point[]
}

/**
 * Rebuilds a linear element frame from points in world coordinates:
 * origin at the top-left of the points, points made relative to it,
 * width and height enclosing them. Keeping this invariant is what makes
 * the element frame a valid culling box for the renderer.
 */
export function normalizeLinearPoints(
  worldPoints: readonly Point[],
): LinearFrame {
  if (worldPoints.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0, points: [] }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of worldPoints) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: worldPoints.map((point) => ({
      x: point.x - minX,
      y: point.y - minY,
    })),
  }
}
```

`packages/engine/src/geometry/hit.ts`:

```ts
import type { BoardElement, Point } from '../model/element'
import { distanceToSegment, pointInPolygon } from './points'

/** Maps a world point into the element's unrotated local frame. */
export function toLocalPoint(element: BoardElement, point: Point): Point {
  if (element.angle === 0) {
    return { x: point.x - element.x, y: point.y - element.y }
  }
  const centerX = element.x + element.width / 2
  const centerY = element.y + element.height / 2
  const cos = Math.cos(-element.angle)
  const sin = Math.sin(-element.angle)
  const dx = point.x - centerX
  const dy = point.y - centerY
  return {
    x: centerX + dx * cos - dy * sin - element.x,
    y: centerY + dx * sin + dy * cos - element.y,
  }
}

/** Maps a point in the element's unrotated local frame back to world. */
export function toWorldPoint(element: BoardElement, local: Point): Point {
  if (element.angle === 0) {
    return { x: element.x + local.x, y: element.y + local.y }
  }
  const centerX = element.width / 2
  const centerY = element.height / 2
  const cos = Math.cos(element.angle)
  const sin = Math.sin(element.angle)
  const dx = local.x - centerX
  const dy = local.y - centerY
  return {
    x: element.x + centerX + dx * cos - dy * sin,
    y: element.y + centerY + dx * sin + dy * cos,
  }
}

function diamondPolygon(element: BoardElement): Point[] {
  const { width, height } = element
  return [
    { x: width / 2, y: 0 },
    { x: width, y: height / 2 },
    { x: width / 2, y: height },
    { x: 0, y: height / 2 },
  ]
}

function withinBox(
  local: Point,
  width: number,
  height: number,
  pad: number,
): boolean {
  return (
    local.x >= -pad &&
    local.x <= width + pad &&
    local.y >= -pad &&
    local.y <= height + pad
  )
}

function hitPolyline(
  points: readonly Point[],
  local: Point,
  pad: number,
): boolean {
  if (points.length === 0) {
    return false
  }
  if (points.length === 1) {
    const only = points[0] as Point
    return distanceToSegment(local, only, only) <= pad
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i] as Point
    const b = points[i + 1] as Point
    if (distanceToSegment(local, a, b) <= pad) {
      return true
    }
  }
  return false
}

function hitEllipse(
  element: BoardElement,
  local: Point,
  pad: number,
  interior: boolean,
): boolean {
  const rx = element.width / 2
  const ry = element.height / 2
  if (rx <= 0 || ry <= 0) {
    return false
  }
  const dx = local.x - rx
  const dy = local.y - ry
  const outer = (dx / (rx + pad)) ** 2 + (dy / (ry + pad)) ** 2
  if (outer > 1) {
    return false
  }
  if (interior || element.fillColor !== null) {
    return true
  }
  const innerRx = rx - pad
  const innerRy = ry - pad
  if (innerRx <= 0 || innerRy <= 0) {
    return true
  }
  return (dx / innerRx) ** 2 + (dy / innerRy) ** 2 >= 1
}

function hitShape(
  element: BoardElement,
  local: Point,
  pad: number,
  interior: boolean,
): boolean {
  switch (element.type) {
    case 'rectangle': {
      if (!withinBox(local, element.width, element.height, pad)) {
        return false
      }
      if (interior || element.fillColor !== null) {
        return true
      }
      const insideInner =
        local.x > pad &&
        local.x < element.width - pad &&
        local.y > pad &&
        local.y < element.height - pad
      return !insideInner
    }
    case 'ellipse':
      return hitEllipse(element, local, pad, interior)
    case 'diamond': {
      const polygon = diamondPolygon(element)
      if ((interior || element.fillColor !== null) && pointInPolygon(local, polygon)) {
        return true
      }
      return hitPolyline([...polygon, polygon[0] as Point], local, pad)
    }
    default:
      return false
  }
}

function hitTest(
  element: BoardElement,
  point: Point,
  tolerance: number,
  interior: boolean,
): boolean {
  const local = toLocalPoint(element, point)
  const pad = tolerance + element.strokeWidth / 2
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
      return hitShape(element, local, pad, interior)
    case 'line':
    case 'arrow':
    case 'draw':
      return hitPolyline(element.points, local, pad)
    case 'text':
    case 'image':
      return withinBox(local, element.width, element.height, tolerance)
  }
}

/**
 * True when the point touches the element as drawn: the outline (within
 * `tolerance` plus half the stroke width) for hollow shapes, anywhere
 * inside for filled shapes, near any segment for linear elements, and
 * anywhere in the box for text and images. `tolerance` is in world
 * units; callers divide a screen-space constant by the camera zoom.
 */
export function hitTestElement(
  element: BoardElement,
  point: Point,
  tolerance: number,
): boolean {
  return hitTest(element, point, tolerance, false)
}

/** Same as hitTestElement, but hollow shapes count as filled. */
export function hitTestElementInterior(
  element: BoardElement,
  point: Point,
  tolerance: number,
): boolean {
  return hitTest(element, point, tolerance, true)
}

/**
 * Topmost hit in a scene sorted back to front, as
 * `BoardStore.listElements()` returns it. Invisible elements
 * (`opacity === 0`) are not hittable.
 */
export function hitTestScene(
  elements: readonly BoardElement[],
  point: Point,
  tolerance: number,
): BoardElement | null {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i] as BoardElement
    if (element.opacity === 0) {
      continue
    }
    if (hitTestElement(element, point, tolerance)) {
      return element
    }
  }
  return null
}
```

Add to `packages/engine/src/index.ts`, keeping the existing alphabetical grouping:

```ts
export {
  hitTestElement,
  hitTestElementInterior,
  hitTestScene,
  toLocalPoint,
  toWorldPoint,
} from './geometry/hit'
export type { LinearFrame } from './geometry/points'
export {
  distance,
  distanceToSegment,
  normalizeLinearPoints,
  pointInPolygon,
  segmentsIntersection,
} from './geometry/points'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test test/geometry/points.test.ts test/geometry/hit.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/geometry packages/engine/test/geometry packages/engine/src/index.ts
git commit -m "✨ feat(engine): hit-test elements on their real geometry"
```

---

### Task 2: Selection queries with group expansion

**Files:**

- Create: `packages/engine/src/selection.ts`
- Test: `packages/engine/test/selection.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `getElementBounds`, `Rect`, `rectsIntersect` from `src/geometry/bounds.ts`; `BoardElement`, `ElementId` from `src/model/element.ts`.
- Produces:
  - `expandToGroups(elements: readonly BoardElement[], ids: readonly ElementId[]): ElementId[]` (adds every member of any group touched; result in z-order)
  - `selectionBounds(elements: readonly BoardElement[], ids: readonly ElementId[]): Rect | null` (union of rotated bounding boxes; `null` when nothing matches)
  - `elementsInRect(elements: readonly BoardElement[], rect: Rect): ElementId[]` (lasso semantics: an element is caught when its bounding box intersects the rect)

- [ ] **Step 1: Write the failing test**

`packages/engine/test/selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../src/model/create'
import {
  elementsInRect,
  expandToGroups,
  selectionBounds,
} from '../src/selection'

const groupA = 'group-a'

function sampleElements() {
  const first = createElement('rectangle', {
    index: 'a0',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    groupId: groupA,
  })
  const second = createElement('ellipse', {
    index: 'a1',
    x: 200,
    y: 0,
    width: 50,
    height: 50,
    groupId: groupA,
  })
  const loner = createElement('rectangle', {
    index: 'a2',
    x: 400,
    y: 400,
    width: 10,
    height: 10,
  })
  return { first, second, loner, all: [first, second, loner] }
}

describe('expandToGroups', () => {
  it('pulls in every member of a touched group, in z-order', () => {
    const { first, second, loner, all } = sampleElements()
    expect(expandToGroups(all, [second.id])).toEqual([first.id, second.id])
    expect(expandToGroups(all, [loner.id])).toEqual([loner.id])
  })

  it('keeps ungrouped ids untouched', () => {
    const { loner, all } = sampleElements()
    expect(expandToGroups(all, [loner.id, 'unknown'])).toEqual([loner.id])
  })
})

describe('selectionBounds', () => {
  it('unions the bounds of the selected elements', () => {
    const { first, second, all } = sampleElements()
    expect(selectionBounds(all, [first.id, second.id])).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 50,
    })
  })

  it('returns null for an empty or unknown selection', () => {
    const { all } = sampleElements()
    expect(selectionBounds(all, [])).toBeNull()
    expect(selectionBounds(all, ['unknown'])).toBeNull()
  })

  it('uses the rotated bounding box', () => {
    const rotated = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 10,
      angle: Math.PI / 2,
    })
    const bounds = selectionBounds([rotated], [rotated.id])
    expect(bounds?.width).toBeCloseTo(10)
    expect(bounds?.height).toBeCloseTo(100)
  })
})

describe('elementsInRect', () => {
  it('catches elements whose bounds intersect the rect', () => {
    const { first, second, loner, all } = sampleElements()
    const caught = elementsInRect(all, { x: 90, y: 0, width: 130, height: 50 })
    expect(caught).toEqual([first.id, second.id])
    expect(
      elementsInRect(all, { x: 300, y: 300, width: 200, height: 200 }),
    ).toEqual([loner.id])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test test/selection.test.ts`
Expected: FAIL, cannot resolve `../src/selection`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/selection.ts`:

```ts
import { getElementBounds, type Rect, rectsIntersect } from './geometry/bounds'
import type { BoardElement, ElementId } from './model/element'

/**
 * Selecting any member of a group selects the whole group. Returns the
 * expanded id list in z-order (the order of `elements`), dropping ids
 * the board does not hold.
 */
export function expandToGroups(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): ElementId[] {
  const wanted = new Set(ids)
  const groups = new Set<string>()
  for (const element of elements) {
    if (wanted.has(element.id) && element.groupId !== null) {
      groups.add(element.groupId)
    }
  }
  const expanded: ElementId[] = []
  for (const element of elements) {
    if (
      wanted.has(element.id) ||
      (element.groupId !== null && groups.has(element.groupId))
    ) {
      expanded.push(element.id)
    }
  }
  return expanded
}

/** Union of the rotated bounding boxes; null when nothing matches. */
export function selectionBounds(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): Rect | null {
  const wanted = new Set(ids)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let found = false
  for (const element of elements) {
    if (!wanted.has(element.id)) {
      continue
    }
    found = true
    const bounds = getElementBounds(element)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  if (!found) {
    return null
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Lasso semantics: caught when the element bounds intersect the rect. */
export function elementsInRect(
  elements: readonly BoardElement[],
  rect: Rect,
): ElementId[] {
  return elements
    .filter((element) => rectsIntersect(getElementBounds(element), rect))
    .map((element) => element.id)
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { elementsInRect, expandToGroups, selectionBounds } from './selection'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test test/selection.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/selection.ts packages/engine/test/selection.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): add selection queries with group expansion"
```

---

### Task 3: Change-batch builders over a selection

**Files:**

- Create: `packages/engine/src/model/operations.ts`
- Test: `packages/engine/test/model/operations.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `BoardChange` from `src/store/types.ts`; `BoardElement`, `ElementId`, `ElementProps`, `Point` from `src/model/element.ts`; `indexAfter`, `indexBetween` from `src/model/ordering.ts`; `expandToGroups` from `src/selection.ts`.
- Produces (every function takes `elements` sorted back to front, as `BoardStore.listElements()` returns them, and returns a batch for one `applyChanges` call):
  - `deleteElements(elements: readonly BoardElement[], ids: readonly ElementId[]): BoardChange[]` (cascades to bound text labels, clears bindings on surviving arrows)
  - `duplicateElements(elements: readonly BoardElement[], ids: readonly ElementId[], offset: Point): { changes: BoardChange[]; newIds: ElementId[] }` (fresh ids and group ids, bindings remapped when both sides are cloned and dropped otherwise, clones appended on top preserving relative order; `newIds` in the same order as the source elements)
  - `groupElements(elements: readonly BoardElement[], ids: readonly ElementId[]): BoardChange[]` (one fresh shared group id; merges any groups already touched; empty batch when fewer than two targets)
  - `ungroupElements(elements: readonly BoardElement[], ids: readonly ElementId[]): BoardChange[]`
  - `bringToFront(elements, ids)`, `sendToBack(elements, ids)`, `bringForward(elements, ids)`, `sendBackward(elements, ids)`: `(elements: readonly BoardElement[], ids: readonly ElementId[]) => BoardChange[]`. Forward/backward treat the selection as one block jumping over the nearest non-selected neighbor; empty batch when already at the extreme.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/model/operations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type {
  ArrowElement,
  BoardElement,
  TextElement,
} from '../../src/model/element'
import {
  bringForward,
  bringToFront,
  deleteElements,
  duplicateElements,
  groupElements,
  sendBackward,
  sendToBack,
  ungroupElements,
} from '../../src/model/operations'
import { sortByIndex } from '../../src/model/ordering'
import type { BoardChange } from '../../src/store/types'

function applyToList(
  elements: readonly BoardElement[],
  changes: readonly BoardChange[],
): BoardElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  for (const change of changes) {
    if (change.kind === 'create') {
      byId.set(change.element.id, change.element)
    } else if (change.kind === 'update') {
      const element = byId.get(change.id)
      if (element) {
        byId.set(change.id, { ...element, ...change.props } as BoardElement)
      }
    } else {
      byId.delete(change.id)
    }
  }
  return sortByIndex([...byId.values()])
}

describe('deleteElements', () => {
  it('cascades to bound labels and unbinds surviving arrows', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      width: 100,
      height: 100,
    })
    const label = createElement('text', {
      index: 'a1',
      text: 'label',
      containerId: shape.id,
    })
    const arrow = createElement('arrow', {
      index: 'a2',
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      startBinding: { elementId: shape.id },
      endBinding: null,
    })
    const elements = [shape, label, arrow]
    const after = applyToList(elements, deleteElements(elements, [shape.id]))
    expect(after.map((element) => element.id)).toEqual([arrow.id])
    expect((after[0] as ArrowElement).startBinding).toBeNull()
  })
})

describe('duplicateElements', () => {
  it('clones with fresh ids, offset, and top z-order', () => {
    const bottom = createElement('rectangle', { index: 'a0', x: 0, y: 0 })
    const top = createElement('ellipse', { index: 'a1', x: 10, y: 10 })
    const elements = [bottom, top]
    const { changes, newIds } = duplicateElements(
      elements,
      [bottom.id],
      { x: 10, y: 10 },
    )
    const after = applyToList(elements, changes)
    expect(newIds).toHaveLength(1)
    const clone = after.find((element) => element.id === newIds[0])
    expect(clone?.x).toBe(10)
    expect(clone?.y).toBe(10)
    expect(after.map((element) => element.id)).toEqual([
      bottom.id,
      top.id,
      newIds[0],
    ])
  })

  it('remaps groups, bindings, and label containers among the clones', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      width: 100,
      height: 100,
      groupId: 'g1',
    })
    const label = createElement('text', {
      index: 'a1',
      text: 'label',
      containerId: shape.id,
      groupId: 'g1',
    })
    const arrow = createElement('arrow', {
      index: 'a2',
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      startBinding: { elementId: shape.id },
      endBinding: { elementId: 'missing-elsewhere' },
      groupId: 'g1',
    })
    const elements = [shape, label, arrow]
    const { changes, newIds } = duplicateElements(
      elements,
      [shape.id, label.id, arrow.id],
      { x: 0, y: 0 },
    )
    const after = applyToList(elements, changes)
    const clones = after.filter((element) => newIds.includes(element.id))
    expect(clones).toHaveLength(3)
    const [shapeClone, labelClone, arrowClone] = clones as [
      BoardElement,
      TextElement,
      ArrowElement,
    ]
    expect(shapeClone.groupId).not.toBe('g1')
    expect(labelClone.groupId).toBe(shapeClone.groupId)
    expect(labelClone.containerId).toBe(shapeClone.id)
    expect(arrowClone.startBinding).toEqual({ elementId: shapeClone.id })
    expect(arrowClone.endBinding).toBeNull()
  })
})

describe('groupElements / ungroupElements', () => {
  it('assigns one fresh shared group id and merges touched groups', () => {
    const a = createElement('rectangle', { index: 'a0', groupId: 'old' })
    const b = createElement('rectangle', { index: 'a1', groupId: 'old' })
    const c = createElement('rectangle', { index: 'a2' })
    const elements = [a, b, c]
    const after = applyToList(elements, groupElements(elements, [a.id, c.id]))
    const groups = new Set(after.map((element) => element.groupId))
    expect(groups.size).toBe(1)
    expect(groups.has('old')).toBe(false)
    expect(groups.has(null)).toBe(false)
  })

  it('does nothing with fewer than two targets', () => {
    const a = createElement('rectangle', { index: 'a0' })
    expect(groupElements([a], [a.id])).toEqual([])
  })

  it('clears the group id of every member of touched groups', () => {
    const a = createElement('rectangle', { index: 'a0', groupId: 'g1' })
    const b = createElement('rectangle', { index: 'a1', groupId: 'g1' })
    const elements = [a, b]
    const after = applyToList(elements, ungroupElements(elements, [a.id]))
    expect(after.every((element) => element.groupId === null)).toBe(true)
  })
})

describe('z-order', () => {
  function ids(elements: readonly BoardElement[]): string[] {
    return elements.map((element) => element.id)
  }

  it('brings a selection to the front preserving relative order', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    const c = createElement('rectangle', { index: 'a2' })
    const elements = [a, b, c]
    const after = applyToList(elements, bringToFront(elements, [a.id, b.id]))
    expect(ids(after)).toEqual([c.id, a.id, b.id])
  })

  it('sends a selection to the back preserving relative order', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    const c = createElement('rectangle', { index: 'a2' })
    const elements = [a, b, c]
    const after = applyToList(elements, sendToBack(elements, [b.id, c.id]))
    expect(ids(after)).toEqual([b.id, c.id, a.id])
  })

  it('steps the selection block over its nearest neighbors', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    const c = createElement('rectangle', { index: 'a2' })
    const elements = [a, b, c]
    expect(ids(applyToList(elements, bringForward(elements, [a.id])))).toEqual(
      [b.id, a.id, c.id],
    )
    expect(ids(applyToList(elements, sendBackward(elements, [c.id])))).toEqual(
      [a.id, c.id, b.id],
    )
  })

  it('is a no-op at the extremes', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    const elements = [a, b]
    expect(bringForward(elements, [b.id])).toEqual([])
    expect(sendBackward(elements, [a.id])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test test/model/operations.test.ts`
Expected: FAIL, cannot resolve `../../src/model/operations`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/model/operations.ts`:

```ts
import { expandToGroups } from '../selection'
import type { BoardChange } from '../store/types'
import type {
  BoardElement,
  ElementId,
  ElementProps,
  Point,
} from './element'
import { indexAfter, indexBetween } from './ordering'

/**
 * Deletes the elements and everything that cannot survive them: text
 * labels bound to a deleted container die too, and surviving arrows
 * bound to a deleted element lose that binding.
 */
export function deleteElements(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const doomed = new Set(ids)
  for (const element of elements) {
    if (
      element.type === 'text' &&
      element.containerId !== null &&
      doomed.has(element.containerId)
    ) {
      doomed.add(element.id)
    }
  }
  const changes: BoardChange[] = []
  for (const element of elements) {
    if (element.type !== 'arrow' || doomed.has(element.id)) {
      continue
    }
    const props: ElementProps = {}
    if (element.startBinding && doomed.has(element.startBinding.elementId)) {
      props.startBinding = null
    }
    if (element.endBinding && doomed.has(element.endBinding.elementId)) {
      props.endBinding = null
    }
    if (Object.keys(props).length > 0) {
      changes.push({ kind: 'update', id: element.id, props })
    }
  }
  for (const element of elements) {
    if (doomed.has(element.id)) {
      changes.push({ kind: 'delete', id: element.id })
    }
  }
  return changes
}

/**
 * Clones the elements on top of the scene, preserving their relative
 * order. Groups get fresh shared ids; bindings and label containers are
 * remapped when their target is cloned too, and dropped otherwise. The
 * render seed is kept so a clone looks identical to its source.
 */
export function duplicateElements(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
  offset: Point,
): { changes: BoardChange[]; newIds: ElementId[] } {
  const wanted = new Set(ids)
  const source = elements.filter((element) => wanted.has(element.id))
  const idMap = new Map<ElementId, ElementId>()
  for (const element of source) {
    idMap.set(element.id, crypto.randomUUID())
  }
  const groupMap = new Map<string, string>()
  let lastIndex = elements.at(-1)?.index ?? null
  const changes: BoardChange[] = []
  for (const element of source) {
    const index = indexAfter(lastIndex)
    lastIndex = index
    const clone = {
      ...element,
      id: idMap.get(element.id) as ElementId,
      x: element.x + offset.x,
      y: element.y + offset.y,
      index,
    } as BoardElement
    if (element.groupId !== null) {
      let mapped = groupMap.get(element.groupId)
      if (!mapped) {
        mapped = crypto.randomUUID()
        groupMap.set(element.groupId, mapped)
      }
      clone.groupId = mapped
    }
    if (clone.type === 'arrow') {
      clone.points = clone.points.map((point) => ({ ...point }))
      const start = clone.startBinding
        ? idMap.get(clone.startBinding.elementId)
        : undefined
      const end = clone.endBinding
        ? idMap.get(clone.endBinding.elementId)
        : undefined
      clone.startBinding = start ? { elementId: start } : null
      clone.endBinding = end ? { elementId: end } : null
    } else if (clone.type === 'line' || clone.type === 'draw') {
      clone.points = clone.points.map((point) => ({ ...point }))
    } else if (clone.type === 'text' && clone.containerId !== null) {
      clone.containerId = idMap.get(clone.containerId) ?? null
    }
    changes.push({ kind: 'create', element: clone })
  }
  return { changes, newIds: source.map((element) => idMap.get(element.id) as ElementId) }
}

/** One fresh shared group id over the expanded selection. */
export function groupElements(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const targets = expandToGroups(elements, ids)
  if (targets.length < 2) {
    return []
  }
  const groupId = crypto.randomUUID()
  return targets.map((id) => ({ kind: 'update', id, props: { groupId } }))
}

/** Dissolves every group touched by the selection. */
export function ungroupElements(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const wanted = new Set(ids)
  const groups = new Set<string>()
  for (const element of elements) {
    if (wanted.has(element.id) && element.groupId !== null) {
      groups.add(element.groupId)
    }
  }
  return elements
    .filter(
      (element) => element.groupId !== null && groups.has(element.groupId),
    )
    .map((element) => ({
      kind: 'update' as const,
      id: element.id,
      props: { groupId: null },
    }))
}

function selectedInOrder(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardElement[] {
  const wanted = new Set(ids)
  return elements.filter((element) => wanted.has(element.id))
}

export function bringToFront(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const selected = selectedInOrder(elements, ids)
  let lastIndex = elements.at(-1)?.index ?? null
  return selected.map((element) => {
    const index = indexAfter(lastIndex)
    lastIndex = index
    return { kind: 'update' as const, id: element.id, props: { index } }
  })
}

export function sendToBack(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const selected = selectedInOrder(elements, ids)
  const wanted = new Set(ids)
  const bottom =
    elements.find((element) => !wanted.has(element.id))?.index ?? null
  let lower: string | null = null
  return selected.map((element) => {
    const index = indexBetween(lower, bottom)
    lower = index
    return { kind: 'update' as const, id: element.id, props: { index } }
  })
}

/**
 * Moves the selection as one block just above the nearest non-selected
 * element in front of it. Empty batch when nothing is in front.
 */
export function bringForward(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const selected = selectedInOrder(elements, ids)
  const topmost = selected.at(-1)
  if (!topmost) {
    return []
  }
  const wanted = new Set(ids)
  const remaining = elements.filter((element) => !wanted.has(element.id))
  const neighborPosition = remaining.findIndex(
    (element) => element.index > topmost.index,
  )
  if (neighborPosition === -1) {
    return []
  }
  let lower: string | null = (remaining[neighborPosition] as BoardElement)
    .index
  const upper = remaining[neighborPosition + 1]?.index ?? null
  return selected.map((element) => {
    const index = indexBetween(lower, upper)
    lower = index
    return { kind: 'update' as const, id: element.id, props: { index } }
  })
}

/** Mirror of bringForward, jumping below the nearest element behind. */
export function sendBackward(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const selected = selectedInOrder(elements, ids)
  const bottommost = selected[0]
  if (!bottommost) {
    return []
  }
  const wanted = new Set(ids)
  const remaining = elements.filter((element) => !wanted.has(element.id))
  let neighborPosition = -1
  for (let i = 0; i < remaining.length; i += 1) {
    if ((remaining[i] as BoardElement).index < bottommost.index) {
      neighborPosition = i
    }
  }
  if (neighborPosition === -1) {
    return []
  }
  const upper = (remaining[neighborPosition] as BoardElement).index
  let lower: string | null = remaining[neighborPosition - 1]?.index ?? null
  return selected.map((element) => {
    const index = indexBetween(lower, upper)
    lower = index
    return { kind: 'update' as const, id: element.id, props: { index } }
  })
}
```

Add to `packages/engine/src/index.ts`:

```ts
export {
  bringForward,
  bringToFront,
  deleteElements,
  duplicateElements,
  groupElements,
  sendBackward,
  sendToBack,
  ungroupElements,
} from './model/operations'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test test/model/operations.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/model/operations.ts packages/engine/test/model/operations.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): build change batches for selection operations"
```

---

### Task 4: Resize and rotate handle math

**Files:**

- Create: `packages/engine/src/geometry/transform.ts`
- Test: `packages/engine/test/geometry/transform.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `Rect` from `src/geometry/bounds.ts`; `BoardElement`, `ElementProps`, `Point` from `src/model/element.ts`.
- Produces:
  - `type HandleKind = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'`
  - `type ResizeHandleKind = Exclude<HandleKind, 'rotate'>`
  - `interface Handle { kind: HandleKind; x: number; y: number }` (world coordinates)
  - `HANDLE_SIZE = 8`, `ROTATE_HANDLE_OFFSET = 24` (CSS pixels; divided by zoom internally)
  - `getHandles(bounds: Rect, zoom: number): Handle[]` (four corners, four edge midpoints, rotate handle above the top-center)
  - `hitTestHandles(handles: readonly Handle[], point: Point, zoom: number): HandleKind | null`
  - `resizeRect(start: Rect, handle: ResizeHandleKind, delta: Point, lockAspect: boolean): Rect` (normalized, so dragging past the opposite edge flips the box; `lockAspect` applies to corner handles and anchors the opposite corner)
  - `scaleElement(element: BoardElement, from: Rect, to: Rect): ElementProps` (maps the element frame from one rect to the other; scales `points` and text `fontSize`)
  - `rotationAngle(center: Point, pointer: Point, snap: boolean): number` (0 when the pointer is straight above the center; `snap` rounds to 15-degree steps)

- [ ] **Step 1: Write the failing test**

`packages/engine/test/geometry/transform.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  getHandles,
  hitTestHandles,
  resizeRect,
  rotationAngle,
  scaleElement,
} from '../../src/geometry/transform'
import { createElement } from '../../src/model/create'
import type { LineElement, TextElement } from '../../src/model/element'

const bounds = { x: 100, y: 100, width: 200, height: 100 }

describe('getHandles', () => {
  it('places corners, edge midpoints, and the rotate handle', () => {
    const handles = getHandles(bounds, 1)
    const byKind = new Map(handles.map((handle) => [handle.kind, handle]))
    expect(handles).toHaveLength(9)
    expect(byKind.get('nw')).toMatchObject({ x: 100, y: 100 })
    expect(byKind.get('se')).toMatchObject({ x: 300, y: 200 })
    expect(byKind.get('e')).toMatchObject({ x: 300, y: 150 })
    expect(byKind.get('rotate')).toMatchObject({ x: 200, y: 76 })
  })

  it('keeps the rotate offset screen-fixed', () => {
    const handles = getHandles(bounds, 2)
    const rotate = handles.find((handle) => handle.kind === 'rotate')
    expect(rotate?.y).toBe(88)
  })
})

describe('hitTestHandles', () => {
  it('hits within a screen-fixed radius and misses beyond it', () => {
    const handles = getHandles(bounds, 1)
    expect(hitTestHandles(handles, { x: 302, y: 197 }, 1)).toBe('se')
    expect(hitTestHandles(handles, { x: 320, y: 220 }, 1)).toBeNull()
  })

  it('scales the radius with zoom', () => {
    const handles = getHandles(bounds, 4)
    expect(hitTestHandles(handles, { x: 303, y: 200 }, 4)).toBeNull()
    expect(hitTestHandles(handles, { x: 301, y: 200 }, 4)).toBe('se')
  })
})

describe('resizeRect', () => {
  it('moves only the edges the handle owns', () => {
    expect(resizeRect(bounds, 'se', { x: 20, y: 10 }, false)).toEqual({
      x: 100,
      y: 100,
      width: 220,
      height: 110,
    })
    expect(resizeRect(bounds, 'n', { x: 999, y: 10 }, false)).toEqual({
      x: 100,
      y: 110,
      width: 200,
      height: 90,
    })
  })

  it('normalizes when dragged past the opposite edge', () => {
    expect(resizeRect(bounds, 'e', { x: -250, y: 0 }, false)).toEqual({
      x: 50,
      y: 100,
      width: 50,
      height: 100,
    })
  })

  it('locks the aspect ratio from a corner, anchored opposite', () => {
    const resized = resizeRect(bounds, 'se', { x: 200, y: 0 }, true)
    expect(resized).toEqual({ x: 100, y: 100, width: 400, height: 200 })
  })
})

describe('scaleElement', () => {
  it('maps the frame proportionally into the new rect', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 150,
      y: 100,
      width: 100,
      height: 50,
    })
    const to = { x: 100, y: 100, width: 400, height: 200 }
    expect(scaleElement(element, bounds, to)).toMatchObject({
      x: 200,
      y: 100,
      width: 200,
      height: 100,
    })
  })

  it('scales points and font size', () => {
    const line = createElement('line', {
      index: 'a0',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 100 },
      ],
    }) as LineElement
    const text = createElement('text', {
      index: 'a1',
      x: 100,
      y: 100,
      width: 60,
      height: 24,
      text: 'hi',
      fontSize: 20,
    }) as TextElement
    const to = { x: 0, y: 0, width: 100, height: 50 }
    const lineProps = scaleElement(line, bounds, to)
    expect(lineProps.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ])
    const textProps = scaleElement(text, bounds, to)
    expect(textProps.fontSize).toBe(10)
  })
})

describe('rotationAngle', () => {
  it('is zero straight above and a quarter turn to the right', () => {
    const center = { x: 0, y: 0 }
    expect(rotationAngle(center, { x: 0, y: -10 }, false)).toBeCloseTo(0)
    expect(rotationAngle(center, { x: 10, y: 0 }, false)).toBeCloseTo(
      Math.PI / 2,
    )
  })

  it('snaps to 15-degree steps when asked', () => {
    const center = { x: 0, y: 0 }
    const loose = rotationAngle(center, { x: 3, y: -10 }, false)
    const snapped = rotationAngle(center, { x: 3, y: -10 }, true)
    expect(loose).not.toBeCloseTo(snapped)
    expect(snapped).toBeCloseTo(Math.PI / 12)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test test/geometry/transform.test.ts`
Expected: FAIL, cannot resolve `../../src/geometry/transform`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/geometry/transform.ts`:

```ts
import type { BoardElement, ElementProps, Point } from '../model/element'
import type { Rect } from './bounds'

export type HandleKind =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rotate'

export type ResizeHandleKind = Exclude<HandleKind, 'rotate'>

export interface Handle {
  kind: HandleKind
  x: number
  y: number
}

/** CSS pixels; divided by the camera zoom into world units. */
export const HANDLE_SIZE = 8
export const ROTATE_HANDLE_OFFSET = 24

/**
 * Handle positions for an axis-aligned selection box, in world
 * coordinates. Corners come first so they win over edge midpoints when
 * a tiny selection makes them overlap.
 */
export function getHandles(bounds: Rect, zoom: number): Handle[] {
  const { x, y, width, height } = bounds
  const midX = x + width / 2
  const midY = y + height / 2
  return [
    { kind: 'nw', x, y },
    { kind: 'ne', x: x + width, y },
    { kind: 'se', x: x + width, y: y + height },
    { kind: 'sw', x, y: y + height },
    { kind: 'n', x: midX, y },
    { kind: 'e', x: x + width, y: midY },
    { kind: 's', x: midX, y: y + height },
    { kind: 'w', x, y: midY },
    { kind: 'rotate', x: midX, y: y - ROTATE_HANDLE_OFFSET / zoom },
  ]
}

export function hitTestHandles(
  handles: readonly Handle[],
  point: Point,
  zoom: number,
): HandleKind | null {
  const radius = HANDLE_SIZE / zoom
  for (const handle of handles) {
    if (
      Math.abs(point.x - handle.x) <= radius &&
      Math.abs(point.y - handle.y) <= radius
    ) {
      return handle.kind
    }
  }
  return null
}

/**
 * Applies a pointer delta to the edges a handle owns and returns the
 * normalized rect, so dragging past the opposite edge flips the box.
 * With `lockAspect`, corner handles scale uniformly from the dominant
 * axis, anchored at the opposite corner.
 */
export function resizeRect(
  start: Rect,
  handle: ResizeHandleKind,
  delta: Point,
  lockAspect: boolean,
): Rect {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (handle.includes('w')) {
    left += delta.x
  }
  if (handle.includes('e')) {
    right += delta.x
  }
  if (handle.includes('n')) {
    top += delta.y
  }
  if (handle.includes('s')) {
    bottom += delta.y
  }
  if (
    lockAspect &&
    handle.length === 2 &&
    start.width > 0 &&
    start.height > 0
  ) {
    const anchorX = handle.includes('w') ? start.x + start.width : start.x
    const anchorY = handle.includes('n') ? start.y + start.height : start.y
    const movingX = handle.includes('w') ? left : right
    const movingY = handle.includes('n') ? top : bottom
    const scale = Math.max(
      Math.abs(movingX - anchorX) / start.width,
      Math.abs(movingY - anchorY) / start.height,
    )
    const width = start.width * scale
    const height = start.height * scale
    return {
      x: movingX >= anchorX ? anchorX : anchorX - width,
      y: movingY >= anchorY ? anchorY : anchorY - height,
      width,
      height,
    }
  }
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  }
}

/**
 * Maps an element frame from one rect to another, the way a selection
 * resize moves every selected element. Points of linear elements and
 * the font size of text scale along. The angle is untouched.
 */
export function scaleElement(
  element: BoardElement,
  from: Rect,
  to: Rect,
): ElementProps {
  const scaleX = from.width === 0 ? 1 : to.width / from.width
  const scaleY = from.height === 0 ? 1 : to.height / from.height
  const props: ElementProps = {
    x: to.x + (element.x - from.x) * scaleX,
    y: to.y + (element.y - from.y) * scaleY,
    width: element.width * scaleX,
    height: element.height * scaleY,
  }
  if (
    element.type === 'line' ||
    element.type === 'arrow' ||
    element.type === 'draw'
  ) {
    props.points = element.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    }))
  }
  if (element.type === 'text') {
    props.fontSize = element.fontSize * scaleY
  }
  return props
}

const ROTATION_STEP = Math.PI / 12

/**
 * Angle for the rotate handle: zero when the pointer sits straight
 * above the center, increasing clockwise. `snap` rounds to 15 degrees.
 */
export function rotationAngle(
  center: Point,
  pointer: Point,
  snap: boolean,
): number {
  const angle =
    Math.atan2(pointer.y - center.y, pointer.x - center.x) + Math.PI / 2
  if (!snap) {
    return angle
  }
  return Math.round(angle / ROTATION_STEP) * ROTATION_STEP
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type {
  Handle,
  HandleKind,
  ResizeHandleKind,
} from './geometry/transform'
export {
  getHandles,
  HANDLE_SIZE,
  hitTestHandles,
  resizeRect,
  ROTATE_HANDLE_OFFSET,
  rotationAngle,
  scaleElement,
} from './geometry/transform'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test test/geometry/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/geometry/transform.ts packages/engine/test/geometry/transform.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): add resize and rotate handle math"
```

---

### Task 5: Move snapping with alignment guides

**Files:**

- Create: `packages/engine/src/geometry/snap.ts`
- Test: `packages/engine/test/geometry/snap.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `Rect` from `src/geometry/bounds.ts`.
- Produces:
  - `SNAP_THRESHOLD = 8` (CSS pixels; callers divide by zoom)
  - `interface SnapGuide { orientation: 'vertical' | 'horizontal'; position: number }` (world coordinate of the aligned line)
  - `interface SnapResult { dx: number; dy: number; guides: SnapGuide[] }`
  - `snapMovedBounds(moving: Rect, others: readonly Rect[], threshold: number): SnapResult` (compares left/center/right and top/center/bottom stops per axis, picks the smallest correction within `threshold`, at most one guide per axis; zero correction and no guides when nothing is close)

- [ ] **Step 1: Write the failing test**

`packages/engine/test/geometry/snap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { snapMovedBounds } from '../../src/geometry/snap'

const other = { x: 100, y: 100, width: 100, height: 100 }

describe('snapMovedBounds', () => {
  it('snaps a nearby left edge and reports a vertical guide', () => {
    const moving = { x: 103, y: 300, width: 50, height: 50 }
    const result = snapMovedBounds(moving, [other], 8)
    expect(result.dx).toBe(-3)
    expect(result.dy).toBe(0)
    expect(result.guides).toEqual([
      { orientation: 'vertical', position: 100 },
    ])
  })

  it('snaps centers on both axes at once', () => {
    const moving = { x: 127, y: 122, width: 50, height: 50 }
    const result = snapMovedBounds(moving, [other], 8)
    expect(result.dx).toBe(-2)
    expect(result.dy).toBe(3)
    expect(result.guides).toHaveLength(2)
  })

  it('prefers the smallest correction', () => {
    const near = { x: 200, y: 0, width: 10, height: 10 }
    const moving = { x: 104, y: 300, width: 98, height: 50 }
    // Left edge is 4 away from other's left; right edge is 2 away from near's left.
    const result = snapMovedBounds(moving, [other, near], 8)
    expect(result.dx).toBe(-2)
  })

  it('returns zero and no guides beyond the threshold', () => {
    const moving = { x: 500, y: 500, width: 50, height: 50 }
    expect(snapMovedBounds(moving, [other], 8)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test test/geometry/snap.test.ts`
Expected: FAIL, cannot resolve `../../src/geometry/snap`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/geometry/snap.ts`:

```ts
import type { Rect } from './bounds'

/** CSS pixels; callers divide by the camera zoom. */
export const SNAP_THRESHOLD = 8

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal'
  position: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

interface AxisSnap {
  diff: number
  position: number
}

function stops(rect: Rect, vertical: boolean): number[] {
  return vertical
    ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    : [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
}

function bestAxisSnap(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
  vertical: boolean,
): AxisSnap | null {
  const movingStops = stops(moving, vertical)
  let best: AxisSnap | null = null
  for (const other of others) {
    for (const target of stops(other, vertical)) {
      for (const movingStop of movingStops) {
        const diff = target - movingStop
        if (
          Math.abs(diff) <= threshold &&
          (best === null || Math.abs(diff) < Math.abs(best.diff))
        ) {
          best = { diff, position: target }
        }
      }
    }
  }
  return best
}

/**
 * Light alignment snapping for a moving selection: edges and centers
 * against other elements' edges and centers, independently per axis.
 */
export function snapMovedBounds(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
): SnapResult {
  const vertical = bestAxisSnap(moving, others, threshold, true)
  const horizontal = bestAxisSnap(moving, others, threshold, false)
  const guides: SnapGuide[] = []
  if (vertical) {
    guides.push({ orientation: 'vertical', position: vertical.position })
  }
  if (horizontal) {
    guides.push({ orientation: 'horizontal', position: horizontal.position })
  }
  return { dx: vertical?.diff ?? 0, dy: horizontal?.diff ?? 0, guides }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type { SnapGuide, SnapResult } from './geometry/snap'
export { SNAP_THRESHOLD, snapMovedBounds } from './geometry/snap'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test test/geometry/snap.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/geometry/snap.ts packages/engine/test/geometry/snap.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): snap moved selections to nearby elements"
```

---

### Task 6: Arrow bindings that follow their shapes

**Files:**

- Create: `packages/engine/src/model/bindings.ts`
- Test: `packages/engine/test/model/bindings.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `hitTestElementInterior`, `toLocalPoint`, `toWorldPoint` from `src/geometry/hit.ts`; `normalizeLinearPoints`, `segmentsIntersection` from `src/geometry/points.ts`; `BoardChange` from `src/store/types.ts`; element types from `src/model/element.ts`.
- Produces:
  - `type BindableElement = RectangleElement | EllipseElement | DiamondElement`
  - `isBindable(element: BoardElement): element is BindableElement`
  - `findBindTarget(elements: readonly BoardElement[], point: Point, tolerance: number, exclude?: ReadonlySet<ElementId>): BindableElement | null` (topmost bindable shape whose interior plus tolerance contains the point; skips `opacity === 0`)
  - `attachmentPoint(shape: BindableElement, from: Point): Point` (point on the shape outline where a segment from `from` toward the shape center crosses it, in world coordinates; falls back to `from` when no crossing exists, for example when `from` is inside a rectangle)
  - `boundArrowUpdates(elements: readonly BoardElement[], movedIds: ReadonlySet<ElementId>): BoardChange[]` (update batch re-anchoring every arrow bound to a moved element; arrows that moved themselves are left alone, so moving an arrow keeps its bindings and the next shape move re-anchors it)

- [ ] **Step 1: Write the failing test**

`packages/engine/test/model/bindings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  attachmentPoint,
  boundArrowUpdates,
  findBindTarget,
  isBindable,
} from '../../src/model/bindings'
import { createElement } from '../../src/model/create'
import type {
  ArrowElement,
  EllipseElement,
  RectangleElement,
} from '../../src/model/element'
import type { Point } from '../../src/model/element'

const TOLERANCE = 12

describe('isBindable / findBindTarget', () => {
  it('only shapes are bindable', () => {
    expect(isBindable(createElement('rectangle', { index: 'a0' }))).toBe(true)
    expect(isBindable(createElement('ellipse', { index: 'a0' }))).toBe(true)
    expect(isBindable(createElement('diamond', { index: 'a0' }))).toBe(true)
    expect(isBindable(createElement('text', { index: 'a0' }))).toBe(false)
    expect(isBindable(createElement('draw', { index: 'a0' }))).toBe(false)
  })

  it('finds the topmost bindable shape near a point', () => {
    const back = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    const front = createElement('ellipse', {
      index: 'a1',
      x: 40,
      y: 40,
      width: 100,
      height: 100,
    })
    const text = createElement('text', {
      index: 'a2',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      text: 'not me',
    })
    const elements = [back, front, text]
    expect(findBindTarget(elements, { x: 90, y: 90 }, TOLERANCE)?.id).toBe(
      front.id,
    )
    expect(findBindTarget(elements, { x: 5, y: 5 }, TOLERANCE)?.id).toBe(
      back.id,
    )
    expect(findBindTarget(elements, { x: 300, y: 300 }, TOLERANCE)).toBeNull()
  })

  it('honors the exclusion set', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(
      findBindTarget([shape], { x: 50, y: 50 }, TOLERANCE, new Set([shape.id])),
    ).toBeNull()
  })
})

describe('attachmentPoint', () => {
  it('lands on a rectangle edge toward the source point', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }) as RectangleElement
    const point = attachmentPoint(shape, { x: 200, y: 50 })
    expect(point.x).toBeCloseTo(100)
    expect(point.y).toBeCloseTo(50)
  })

  it('lands on the ellipse outline along the direction', () => {
    const shape = createElement('ellipse', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    }) as EllipseElement
    const point = attachmentPoint(shape, { x: 50, y: 200 })
    expect(point.x).toBeCloseTo(50)
    expect(point.y).toBeCloseTo(50)
  })

  it('falls back to the source point when it is inside the shape', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }) as RectangleElement
    expect(attachmentPoint(shape, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 })
  })
})

describe('boundArrowUpdates', () => {
  function scene() {
    const left = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    const right = createElement('rectangle', {
      index: 'a1',
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    })
    const arrow = createElement('arrow', {
      index: 'a2',
      x: 100,
      y: 50,
      width: 200,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      startBinding: { elementId: left.id },
      endBinding: { elementId: right.id },
    }) as ArrowElement
    return { left, right, arrow }
  }

  it('re-anchors arrows bound to a moved shape', () => {
    const { left, right, arrow } = scene()
    const movedLeft = { ...left, y: 200 } as typeof left
    const elements = [movedLeft, right, arrow]
    const updates = boundArrowUpdates(elements, new Set([movedLeft.id]))
    expect(updates).toHaveLength(1)
    const props = (updates[0] as { props: Record<string, unknown> }).props
    const points = props.points as Point[]
    const x = props.x as number
    const y = props.y as number
    const worldStart = { x: x + (points[0] as Point).x, y: y + (points[0] as Point).y }
    const worldEnd = {
      x: x + (points[1] as Point).x,
      y: y + (points[1] as Point).y,
    }
    // Start sits on the moved shape's outline, end on the other shape's.
    expect(worldStart.x).toBeGreaterThanOrEqual(0)
    expect(worldStart.x).toBeLessThanOrEqual(100)
    expect(worldStart.y).toBeGreaterThanOrEqual(200)
    expect(worldStart.y).toBeLessThanOrEqual(300)
    expect(worldEnd.x).toBeCloseTo(300)
  })

  it('leaves unbound arrows and moved arrows alone', () => {
    const { left, right, arrow } = scene()
    const elements = [left, right, arrow]
    expect(boundArrowUpdates(elements, new Set([arrow.id]))).toEqual([])
    const free = createElement('arrow', {
      index: 'a3',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    })
    expect(
      boundArrowUpdates([left, right, free], new Set([left.id])),
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test test/model/bindings.test.ts`
Expected: FAIL, cannot resolve `../../src/model/bindings`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/model/bindings.ts`:

```ts
import {
  hitTestElementInterior,
  toLocalPoint,
  toWorldPoint,
} from '../geometry/hit'
import {
  normalizeLinearPoints,
  segmentsIntersection,
} from '../geometry/points'
import type { BoardChange } from '../store/types'
import type {
  BoardElement,
  DiamondElement,
  ElementId,
  EllipseElement,
  Point,
  RectangleElement,
} from './element'

export type BindableElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement

export function isBindable(
  element: BoardElement,
): element is BindableElement {
  return (
    element.type === 'rectangle' ||
    element.type === 'ellipse' ||
    element.type === 'diamond'
  )
}

/**
 * Topmost bindable shape whose interior, padded by `tolerance`,
 * contains the point. `elements` is sorted back to front, as
 * `BoardStore.listElements()` returns it.
 */
export function findBindTarget(
  elements: readonly BoardElement[],
  point: Point,
  tolerance: number,
  exclude?: ReadonlySet<ElementId>,
): BindableElement | null {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i] as BoardElement
    if (!isBindable(element) || element.opacity === 0) {
      continue
    }
    if (exclude?.has(element.id)) {
      continue
    }
    if (hitTestElementInterior(element, point, tolerance)) {
      return element
    }
  }
  return null
}

/**
 * Point on the shape outline where the segment from `from` toward the
 * shape center crosses it, in world coordinates. Falls back to `from`
 * when there is no crossing (the source is inside the shape).
 */
export function attachmentPoint(
  shape: BindableElement,
  from: Point,
): Point {
  const local = toLocalPoint(shape, from)
  const center = { x: shape.width / 2, y: shape.height / 2 }
  if (shape.type === 'ellipse') {
    const rx = shape.width / 2
    const ry = shape.height / 2
    if (rx <= 0 || ry <= 0) {
      return from
    }
    const dx = local.x - center.x
    const dy = local.y - center.y
    const norm = Math.hypot(dx / rx, dy / ry)
    if (norm === 0) {
      return from
    }
    return toWorldPoint(shape, {
      x: center.x + dx / norm,
      y: center.y + dy / norm,
    })
  }
  const corners: Point[] =
    shape.type === 'diamond'
      ? [
          { x: shape.width / 2, y: 0 },
          { x: shape.width, y: shape.height / 2 },
          { x: shape.width / 2, y: shape.height },
          { x: 0, y: shape.height / 2 },
        ]
      : [
          { x: 0, y: 0 },
          { x: shape.width, y: 0 },
          { x: shape.width, y: shape.height },
          { x: 0, y: shape.height },
        ]
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i] as Point
    const b = corners[(i + 1) % corners.length] as Point
    const hit = segmentsIntersection(center, local, a, b)
    if (hit) {
      return toWorldPoint(shape, hit)
    }
  }
  return from
}

/**
 * Update batch re-anchoring every arrow bound to a moved element, from
 * the current element positions (call it after the move batch has been
 * applied). Arrows that moved themselves are skipped: moving an arrow
 * keeps its bindings, and the next shape move re-anchors it.
 */
export function boundArrowUpdates(
  elements: readonly BoardElement[],
  movedIds: ReadonlySet<ElementId>,
): BoardChange[] {
  const byId = new Map(elements.map((element) => [element.id, element]))
  const changes: BoardChange[] = []
  for (const element of elements) {
    if (element.type !== 'arrow' || movedIds.has(element.id)) {
      continue
    }
    if (element.points.length < 2) {
      continue
    }
    const startShape = element.startBinding
      ? byId.get(element.startBinding.elementId)
      : undefined
    const endShape = element.endBinding
      ? byId.get(element.endBinding.elementId)
      : undefined
    const follows =
      (startShape !== undefined && movedIds.has(startShape.id)) ||
      (endShape !== undefined && movedIds.has(endShape.id))
    if (!follows) {
      continue
    }
    const world = element.points.map((point) => ({
      x: element.x + point.x,
      y: element.y + point.y,
    }))
    const tail = world[0] as Point
    const head = world[world.length - 1] as Point
    const newTail =
      startShape && isBindable(startShape)
        ? attachmentPoint(startShape, head)
        : tail
    const newHead =
      endShape && isBindable(endShape)
        ? attachmentPoint(endShape, newTail)
        : head
    world[0] = newTail
    world[world.length - 1] = newHead
    changes.push({
      kind: 'update',
      id: element.id,
      props: normalizeLinearPoints(world),
    })
  }
  return changes
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type { BindableElement } from './model/bindings'
export {
  attachmentPoint,
  boundArrowUpdates,
  findBindTarget,
  isBindable,
} from './model/bindings'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test test/model/bindings.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/model/bindings.ts packages/engine/test/model/bindings.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): bind arrows to shapes and follow their moves"
```

---

### Task 7: Undo capture boundaries in the store contract

A drag streams one store batch per pointer move so collaborators see it
live, but undo must revert the whole gesture as one step. The store
contract gains explicit capture boundaries, mirroring
`Y.UndoManager.stopCapturing` so the future Yjs store implements the
same semantics: consecutive local batches coalesce into a single undo
entry, and `stopCapturing()` closes the current entry so the next local
batch starts a new one. Undo, redo, and `clearHistory` close the entry
implicitly. This changes existing behavior (separate `applyChanges`
calls used to be separate undo entries), so two existing contract tests
gain explicit `stopCapturing()` calls between logically distinct
actions.

**Files:**

- Modify: `packages/engine/src/store/types.ts`
- Modify: `packages/engine/src/store/memory.ts`
- Modify: `packages/engine/src/store/contract.ts`

**Interfaces:**

- Consumes: the existing `BoardStore` members.
- Produces: `stopCapturing(): void` on `BoardStore`; every tool and keyboard action in later tasks calls it around each gesture or discrete action.

- [ ] **Step 1: Write the failing tests**

Add to the `describe` block in `packages/engine/src/store/contract.ts`:

```ts
    it('coalesces consecutive local batches into one undo entry', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 0 })
      store.applyChanges([{ kind: 'create', element }])
      store.applyChanges([{ kind: 'update', id: element.id, props: { x: 10 } }])
      store.applyChanges([{ kind: 'update', id: element.id, props: { x: 20 } }])
      store.undo()
      expect(store.getElement(element.id)).toBeUndefined()
      expect(store.canUndo()).toBe(false)
    })

    it('starts a new undo entry after stopCapturing', () => {
      const store = createStore()
      const element = createElement('rectangle', { index: 'a0', x: 0 })
      store.applyChanges([{ kind: 'create', element }])
      store.stopCapturing()
      store.applyChanges([{ kind: 'update', id: element.id, props: { x: 42 } }])
      store.undo()
      expect(store.getElement(element.id)?.x).toBe(0)
      store.undo()
      expect(store.getElement(element.id)).toBeUndefined()
    })

    it('does not coalesce across an undo boundary', () => {
      const store = createStore()
      const first = createElement('rectangle', { index: 'a0' })
      store.applyChanges([{ kind: 'create', element: first }])
      store.stopCapturing()
      const second = createElement('ellipse', { index: 'a1' })
      store.applyChanges([{ kind: 'create', element: second }])
      store.undo()
      const third = createElement('diamond', { index: 'a2' })
      store.applyChanges([{ kind: 'create', element: third }])
      store.undo()
      expect(store.getElement(third.id)).toBeUndefined()
      expect(store.getElement(first.id)).toBeDefined()
      expect(store.canUndo()).toBe(true)
    })

    it('does not capture remote batches', () => {
      const store = createStore()
      const local = createElement('rectangle', { index: 'a0' })
      const remote = createElement('ellipse', { index: 'a1' })
      store.applyChanges([{ kind: 'create', element: local }])
      store.applyChanges([{ kind: 'create', element: remote }], 'remote')
      store.undo()
      expect(store.getElement(local.id)).toBeUndefined()
      expect(store.getElement(remote.id)).toBeDefined()
    })
```

Then update the two existing contract tests that relied on separate
batches being separate undo entries, inserting a boundary between the
logically distinct actions:

- In `'undoes an update by restoring the prior property values'`, add `store.stopCapturing()` between the create batch and the update batch (otherwise the coalesced undo removes the element and `x` reads `undefined`).
- In `'drops undo and redo history on clearHistory'`, add `store.stopCapturing()` between the create batch and the delete batch (the test needs two entries so `canUndo()` is still true after one `undo()`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test test/store/memory.test.ts`
Expected: FAIL. The four new tests fail (`store.stopCapturing is not a function`, and the coalescing test fails because batches are not merged), and typecheck of the contract file fails until the interface gains the method.

- [ ] **Step 3: Write the implementation**

In `packages/engine/src/store/types.ts`, add to the `BoardStore`
interface, after `applyChanges`:

```ts
  /**
   * Closes the current undo capture: the next local batch starts a new
   * undo entry instead of coalescing into the current one. Consecutive
   * local batches otherwise merge into a single entry, which lets a
   * gesture stream one batch per pointer move while undo reverts the
   * whole gesture. Undo, redo, and clearHistory close the capture
   * implicitly. Mirrors Y.UndoManager.stopCapturing, which the Yjs
   * implementation delegates to.
   */
  stopCapturing(): void
```

In `packages/engine/src/store/memory.ts`, add a `capturing` flag and
merge coalesced inverses. The `applyChanges` history block becomes:

```ts
  private capturing = false

  applyChanges(changes: BoardChange[], origin: ChangeOrigin = 'local'): void {
    const inverse = this.invertBatch(changes)
    for (const change of changes) {
      this.applyOne(change)
    }
    if (origin === 'local' && inverse.length > 0) {
      const open = this.capturing ? this.undoStack.at(-1) : undefined
      if (open) {
        // The merged entry replays the newest inverses first.
        this.undoStack[this.undoStack.length - 1] = [...inverse, ...open]
      } else {
        this.undoStack.push(inverse)
        this.capturing = true
      }
      this.redoStack = []
    }
    this.emit({ kind: 'changes', changes: [...changes], origin })
  }

  stopCapturing(): void {
    this.capturing = false
  }
```

And close the capture in the three places the contract requires: add
`this.capturing = false` as the first statement of `undo()`, `redo()`,
and `clearHistory()`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS, the whole suite. The renderer and visual tests must be untouched by the contract change.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/store
git commit -m "✨ feat(engine): coalesce local batches into undo capture entries"
```

---

### Task 8: Tool infrastructure with the hand and shape tools

**Files:**

- Create: `packages/engine/src/tools/types.ts`
- Create: `packages/engine/src/tools/hand.ts`
- Create: `packages/engine/src/tools/shape.ts`
- Create: `packages/engine/test/tools/helpers.ts`
- Test: `packages/engine/test/tools/hand.test.ts`
- Test: `packages/engine/test/tools/shape.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `Camera`, `panCamera` from `src/camera.ts`; `createElement` from `src/model/create.ts`; `indexAfter` from `src/model/ordering.ts`; `distance` from `src/geometry/points.ts`; `BoardStore` from `src/store/types.ts`; `SnapGuide` from `src/geometry/snap.ts`; `Rect` from `src/geometry/bounds.ts`.
- Produces (`src/tools/types.ts`, consumed by every tool task and by the controller):

```ts
export type ToolType =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'draw'
  | 'text'
  | 'image'
  | 'eraser'

/** CSS pixels; divide by the camera zoom at the call site. */
export const HIT_TOLERANCE = 8
export const DRAG_THRESHOLD = 2

export interface PointerInput {
  /** Already projected through the camera. */
  world: Point
  /** Raw CSS pixel position, for camera pans. */
  screen: Point
  shiftKey: boolean
  altKey: boolean
}

export interface PendingImage {
  assetHash: string
  width: number
  height: number
}

export interface ToolContext {
  store: BoardStore
  getCamera(): Camera
  setCamera(camera: Camera): void
  getSelection(): ElementId[]
  setSelection(ids: ElementId[]): void
  /** Style defaults applied to newly created elements. */
  getDefaults(): ElementProps
  /** Creation tools fall back to select once their element exists. */
  setActiveTool(type: ToolType): void
  /** The host opens its DOM text editor over the element. */
  requestTextEdit(id: ElementId): void
  /** Asset staged by the host for the image tool; null when none. */
  getPendingImage(): PendingImage | null
}

/** Ephemeral per-gesture state the overlay rendering needs. */
export interface ToolOverlay {
  lasso: Rect | null
  guides: SnapGuide[]
}

export interface Tool {
  readonly type: ToolType
  onPointerDown(input: PointerInput, context: ToolContext): void
  onPointerMove(input: PointerInput, context: ToolContext): void
  onPointerUp(input: PointerInput, context: ToolContext): void
  /** Escape or tool switch mid-gesture: abandon without committing. */
  onCancel(context: ToolContext): void
  getOverlay?(): ToolOverlay
}

/** Fractional index above every current element. */
export function topIndex(store: BoardStore): string {
  return indexAfter(store.listElements().at(-1)?.index ?? null)
}
```

  - `createHandTool(): Tool` (pans the camera by the screen delta; never touches the store)
  - `createShapeTool(type: 'rectangle' | 'ellipse' | 'diamond'): Tool` (drag to create; nothing exists until the pointer travels `DRAG_THRESHOLD / zoom`; `shiftKey` constrains to a square; on release selects the shape and falls back to the select tool; a plain click creates nothing)

  Cancellation convention for every tool that streams changes: a
  gesture opens with `stopCapturing()` and is therefore exactly the
  open capture entry, so `onCancel` abandons it with one `store.undo()`
  call when the gesture wrote anything. No ghost no-op entries stay on
  the undo stack; the trade-off is that a redo right after a cancel
  restores the cancelled gesture, which is acceptable.
  - Test helper `createTestContext(): TestContext` and `pointer(x, y, modifiers?)` in `test/tools/helpers.ts`, reused by every tool test.

- [ ] **Step 1: Write the test helper and the failing tests**

`packages/engine/test/tools/helpers.ts`:

```ts
import { type Camera, createCamera } from '../../src/camera'
import type { ElementId } from '../../src/model/element'
import { InMemoryBoardStore } from '../../src/store/memory'
import type {
  PendingImage,
  PointerInput,
  ToolContext,
  ToolType,
} from '../../src/tools/types'

export interface TestContext extends ToolContext {
  store: InMemoryBoardStore
  selection: ElementId[]
  activeTool: ToolType | null
  textEditRequests: ElementId[]
  pendingImage: PendingImage | null
  camera: Camera
}

/** ToolContext over a real InMemoryBoardStore, camera at origin, zoom 1. */
export function createTestContext(): TestContext {
  const context: TestContext = {
    store: new InMemoryBoardStore(),
    selection: [],
    activeTool: null,
    textEditRequests: [],
    pendingImage: null,
    camera: createCamera(),
    getCamera: () => context.camera,
    setCamera: (camera) => {
      context.camera = camera
    },
    getSelection: () => context.selection,
    setSelection: (ids) => {
      context.selection = ids
    },
    getDefaults: () => ({}),
    setActiveTool: (type) => {
      context.activeTool = type
    },
    requestTextEdit: (id) => {
      context.textEditRequests.push(id)
    },
    getPendingImage: () => context.pendingImage,
  }
  return context
}

/** With the camera at origin and zoom 1, world and screen coincide. */
export function pointer(
  x: number,
  y: number,
  modifiers: Partial<Pick<PointerInput, 'shiftKey' | 'altKey'>> = {},
): PointerInput {
  return {
    world: { x, y },
    screen: { x, y },
    shiftKey: false,
    altKey: false,
    ...modifiers,
  }
}
```

`packages/engine/test/tools/hand.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createHandTool } from '../../src/tools/hand'
import { createTestContext, pointer } from './helpers'

describe('hand tool', () => {
  it('pans the camera with the drag and never touches the store', () => {
    const context = createTestContext()
    const events: unknown[] = []
    context.store.subscribe((event) => events.push(event))
    const tool = createHandTool()
    tool.onPointerDown(pointer(100, 100), context)
    tool.onPointerMove(pointer(130, 120), context)
    expect(context.camera.x).toBe(-30)
    expect(context.camera.y).toBe(-20)
    tool.onPointerMove(pointer(140, 120), context)
    expect(context.camera.x).toBe(-40)
    tool.onPointerUp(pointer(140, 120), context)
    tool.onPointerMove(pointer(999, 999), context)
    expect(context.camera.x).toBe(-40)
    expect(events).toEqual([])
  })

  it('ignores moves without a press', () => {
    const context = createTestContext()
    const tool = createHandTool()
    tool.onPointerMove(pointer(50, 50), context)
    expect(context.camera.x).toBe(0)
  })
})
```

`packages/engine/test/tools/shape.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createShapeTool } from '../../src/tools/shape'
import { createTestContext, pointer } from './helpers'

describe('shape tool', () => {
  it('creates nothing on a plain click', () => {
    const context = createTestContext()
    const tool = createShapeTool('rectangle')
    tool.onPointerDown(pointer(10, 10), context)
    tool.onPointerUp(pointer(10, 10), context)
    expect(context.store.listElements()).toEqual([])
    expect(context.activeTool).toBeNull()
  })

  it('drags out a rectangle, selects it, and falls back to select', () => {
    const context = createTestContext()
    const tool = createShapeTool('rectangle')
    tool.onPointerDown(pointer(10, 10), context)
    tool.onPointerMove(pointer(110, 60), context)
    const [element] = context.store.listElements()
    expect(element).toMatchObject({
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
    })
    tool.onPointerUp(pointer(110, 60), context)
    expect(context.selection).toEqual([element?.id])
    expect(context.activeTool).toBe('select')
  })

  it('normalizes a backwards drag and squares with shift', () => {
    const context = createTestContext()
    const tool = createShapeTool('ellipse')
    tool.onPointerDown(pointer(100, 100), context)
    tool.onPointerMove(pointer(40, 80, { shiftKey: true }), context)
    const [element] = context.store.listElements()
    expect(element).toMatchObject({ x: 40, y: 40, width: 60, height: 60 })
  })

  it('undoes the whole drag as one step', () => {
    const context = createTestContext()
    const tool = createShapeTool('rectangle')
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerMove(pointer(50, 50), context)
    tool.onPointerMove(pointer(80, 90), context)
    tool.onPointerUp(pointer(80, 90), context)
    context.store.undo()
    expect(context.store.listElements()).toEqual([])
  })

  it('applies the style defaults', () => {
    const context = createTestContext()
    context.getDefaults = () => ({ strokeColor: '#FF6B4A', sketchiness: 2 })
    const tool = createShapeTool('diamond')
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerMove(pointer(50, 50), context)
    const [element] = context.store.listElements()
    expect(element?.strokeColor).toBe('#FF6B4A')
    expect(element?.sketchiness).toBe(2)
  })

  it('removes the element on cancel', () => {
    const context = createTestContext()
    const tool = createShapeTool('rectangle')
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerMove(pointer(50, 50), context)
    tool.onCancel(context)
    expect(context.store.listElements()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test test/tools`
Expected: FAIL, cannot resolve the `src/tools` modules.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/tools/types.ts`: exactly the interface block quoted
in this task's **Interfaces** section, with these imports:

```ts
import type { Camera } from '../camera'
import type { Rect } from '../geometry/bounds'
import type { SnapGuide } from '../geometry/snap'
import type { ElementId, ElementProps, Point } from '../model/element'
import { indexAfter } from '../model/ordering'
import type { BoardStore } from '../store/types'
```

`packages/engine/src/tools/hand.ts`:

```ts
import { panCamera } from '../camera'
import type { Point } from '../model/element'
import type { Tool } from './types'

/** Pans the camera; the only tool that never touches the store. */
export function createHandTool(): Tool {
  let last: Point | null = null
  return {
    type: 'hand',
    onPointerDown(input) {
      last = input.screen
    },
    onPointerMove(input, context) {
      if (!last) {
        return
      }
      context.setCamera(
        panCamera(
          context.getCamera(),
          input.screen.x - last.x,
          input.screen.y - last.y,
        ),
      )
      last = input.screen
    },
    onPointerUp() {
      last = null
    },
    onCancel() {
      last = null
    },
  }
}
```

`packages/engine/src/tools/shape.ts`:

```ts
import { distance } from '../geometry/points'
import { createElement } from '../model/create'
import type { ElementId, ElementProps, Point } from '../model/element'
import type { Tool, ToolContext } from './types'
import { DRAG_THRESHOLD, topIndex } from './types'

function frameProps(origin: Point, current: Point, square: boolean): ElementProps {
  let width = Math.abs(current.x - origin.x)
  let height = Math.abs(current.y - origin.y)
  if (square) {
    width = Math.max(width, height)
    height = width
  }
  return {
    x: current.x >= origin.x ? origin.x : origin.x - width,
    y: current.y >= origin.y ? origin.y : origin.y - height,
    width,
    height,
  }
}

/**
 * Drag-to-create state machine for rectangle, ellipse, and diamond.
 * Nothing exists until the pointer travels DRAG_THRESHOLD screen
 * pixels, so a plain click creates nothing. On release the shape is
 * selected and the editor falls back to the select tool.
 */
export function createShapeTool(
  type: 'rectangle' | 'ellipse' | 'diamond',
): Tool {
  let origin: Point | null = null
  let id: ElementId | null = null

  const reset = (): void => {
    origin = null
    id = null
  }

  return {
    type,
    onPointerDown(input, context) {
      context.store.stopCapturing()
      origin = input.world
    },
    onPointerMove(input, context) {
      if (!origin) {
        return
      }
      const props = frameProps(origin, input.world, input.shiftKey)
      if (!id) {
        const threshold = DRAG_THRESHOLD / context.getCamera().zoom
        if (distance(origin, input.world) < threshold) {
          return
        }
        const element = createElement(type, {
          index: topIndex(context.store),
          ...context.getDefaults(),
          ...props,
        })
        context.store.applyChanges([{ kind: 'create', element }])
        id = element.id
        return
      }
      context.store.applyChanges([{ kind: 'update', id, props }])
    },
    onPointerUp(_input, context) {
      if (id) {
        context.setSelection([id])
        context.setActiveTool('select')
        context.store.stopCapturing()
      }
      reset()
    },
    onCancel(context: ToolContext) {
      if (id) {
        // The streamed shape is exactly the open capture entry.
        context.store.undo()
      }
      reset()
    },
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { createHandTool } from './tools/hand'
export { createShapeTool } from './tools/shape'
export type {
  PendingImage,
  PointerInput,
  Tool,
  ToolContext,
  ToolOverlay,
  ToolType,
} from './tools/types'
export { DRAG_THRESHOLD, HIT_TOLERANCE, topIndex } from './tools/types'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test test/tools`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/tools packages/engine/test/tools packages/engine/src/index.ts
git commit -m "✨ feat(engine): add the tool infrastructure with hand and shape tools"
```

---

### Task 9: Draw, linear, and eraser tools

**Files:**

- Create: `packages/engine/src/tools/draw.ts`
- Create: `packages/engine/src/tools/linear.ts`
- Create: `packages/engine/src/tools/eraser.ts`
- Test: `packages/engine/test/tools/draw.test.ts`
- Test: `packages/engine/test/tools/linear.test.ts`
- Test: `packages/engine/test/tools/eraser.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `Tool`, `ToolContext`, `DRAG_THRESHOLD`, `HIT_TOLERANCE`, `topIndex` from `src/tools/types.ts`; `createElement`; `distance`, `normalizeLinearPoints` from `src/geometry/points.ts`; `hitTestScene` from `src/geometry/hit.ts`; `attachmentPoint`, `findBindTarget` from `src/model/bindings.ts`; `deleteElements` from `src/model/operations.ts`.
- Produces:
  - `createDrawTool(): Tool` (streams a freehand stroke, one update per move, frame normalized; stays active on release so strokes chain)
  - `createLinearTool(type: 'line' | 'arrow'): Tool` (two-point drag; `shiftKey` snaps the segment direction to 15-degree steps; a degenerate drag under `DRAG_THRESHOLD / zoom` is discarded; arrows bind their endpoints to the topmost shape under them on release, snapping each bound endpoint to the shape outline via `attachmentPoint`; selects the element and falls back to the select tool)
  - `createEraserTool(): Tool` (collects hits while dragging, deletes them as one batch on release through `deleteElements`)

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/tools/draw.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DrawElement } from '../../src/model/element'
import { createDrawTool } from '../../src/tools/draw'
import { createTestContext, pointer } from './helpers'

describe('draw tool', () => {
  it('streams a stroke and normalizes its frame', () => {
    const context = createTestContext()
    const tool = createDrawTool()
    tool.onPointerDown(pointer(50, 50), context)
    tool.onPointerMove(pointer(30, 70), context)
    tool.onPointerMove(pointer(80, 90), context)
    tool.onPointerUp(pointer(80, 90), context)
    const [element] = context.store.listElements() as [DrawElement]
    expect(element.type).toBe('draw')
    expect(element).toMatchObject({ x: 30, y: 50, width: 50, height: 40 })
    expect(element.points).toEqual([
      { x: 20, y: 0 },
      { x: 0, y: 20 },
      { x: 50, y: 40 },
    ])
    // The tool stays active so strokes can chain.
    expect(context.activeTool).toBeNull()
  })

  it('undoes a whole stroke as one step and cancels cleanly', () => {
    const context = createTestContext()
    const tool = createDrawTool()
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerMove(pointer(10, 10), context)
    tool.onPointerUp(pointer(10, 10), context)
    tool.onPointerDown(pointer(20, 20), context)
    tool.onPointerMove(pointer(30, 30), context)
    tool.onCancel(context)
    expect(context.store.listElements()).toHaveLength(1)
    context.store.undo()
    expect(context.store.listElements()).toEqual([])
  })
})
```

`packages/engine/test/tools/linear.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { ArrowElement, LineElement } from '../../src/model/element'
import { createLinearTool } from '../../src/tools/linear'
import { createTestContext, pointer } from './helpers'

describe('linear tool', () => {
  it('drags out a line, selects it, and falls back to select', () => {
    const context = createTestContext()
    const tool = createLinearTool('line')
    tool.onPointerDown(pointer(10, 10), context)
    tool.onPointerMove(pointer(110, 60), context)
    tool.onPointerUp(pointer(110, 60), context)
    const [element] = context.store.listElements() as [LineElement]
    expect(element).toMatchObject({ x: 10, y: 10, width: 100, height: 50 })
    expect(element.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ])
    expect(context.selection).toEqual([element.id])
    expect(context.activeTool).toBe('select')
  })

  it('discards a degenerate drag', () => {
    const context = createTestContext()
    const tool = createLinearTool('line')
    tool.onPointerDown(pointer(10, 10), context)
    tool.onPointerMove(pointer(11, 10), context)
    tool.onPointerUp(pointer(11, 10), context)
    expect(context.store.listElements()).toEqual([])
  })

  it('snaps the direction to 15-degree steps with shift', () => {
    const context = createTestContext()
    const tool = createLinearTool('line')
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerMove(pointer(100, 4, { shiftKey: true }), context)
    tool.onPointerUp(pointer(100, 4, { shiftKey: true }), context)
    const [element] = context.store.listElements() as [LineElement]
    // 2.3 degrees snaps to 0: a horizontal segment.
    expect(element.height).toBe(0)
  })

  it('binds arrow endpoints to shapes and anchors them on the outline', () => {
    const context = createTestContext()
    const left = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    const right = createElement('rectangle', {
      index: 'a1',
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    })
    context.store.applyChanges([
      { kind: 'create', element: left },
      { kind: 'create', element: right },
    ])
    context.store.stopCapturing()
    const tool = createLinearTool('arrow')
    tool.onPointerDown(pointer(90, 50), context)
    tool.onPointerMove(pointer(310, 50), context)
    tool.onPointerUp(pointer(310, 50), context)
    const arrow = context.store
      .listElements()
      .find((element) => element.type === 'arrow') as ArrowElement
    expect(arrow.startBinding).toEqual({ elementId: left.id })
    expect(arrow.endBinding).toEqual({ elementId: right.id })
    const start = { x: arrow.x + (arrow.points[0]?.x ?? 0), y: arrow.y + (arrow.points[0]?.y ?? 0) }
    const end = {
      x: arrow.x + (arrow.points.at(-1)?.x ?? 0),
      y: arrow.y + (arrow.points.at(-1)?.y ?? 0),
    }
    expect(start.x).toBeCloseTo(100)
    expect(end.x).toBeCloseTo(300)
  })

  it('leaves endpoints unbound away from any shape', () => {
    const context = createTestContext()
    const tool = createLinearTool('arrow')
    tool.onPointerDown(pointer(10, 10), context)
    tool.onPointerMove(pointer(100, 100), context)
    tool.onPointerUp(pointer(100, 100), context)
    const [arrow] = context.store.listElements() as [ArrowElement]
    expect(arrow.startBinding).toBeNull()
    expect(arrow.endBinding).toBeNull()
  })
})
```

`packages/engine/test/tools/eraser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import { createEraserTool } from '../../src/tools/eraser'
import { createTestContext, pointer } from './helpers'

describe('eraser tool', () => {
  it('deletes everything touched by the drag as one undo step', () => {
    const context = createTestContext()
    const a = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    const b = createElement('rectangle', {
      index: 'a1',
      x: 100,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    const survivor = createElement('rectangle', {
      index: 'a2',
      x: 300,
      y: 300,
      width: 50,
      height: 50,
    })
    context.store.applyChanges([
      { kind: 'create', element: a },
      { kind: 'create', element: b },
      { kind: 'create', element: survivor },
    ])
    context.store.stopCapturing()
    const tool = createEraserTool()
    tool.onPointerDown(pointer(25, 25), context)
    tool.onPointerMove(pointer(125, 25), context)
    tool.onPointerUp(pointer(125, 25), context)
    expect(context.store.listElements().map((element) => element.id)).toEqual([
      survivor.id,
    ])
    context.store.undo()
    expect(context.store.listElements()).toHaveLength(3)
  })

  it('deletes nothing on a miss or after cancel', () => {
    const context = createTestContext()
    const a = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    context.store.applyChanges([{ kind: 'create', element: a }])
    const tool = createEraserTool()
    tool.onPointerDown(pointer(200, 200), context)
    tool.onPointerUp(pointer(200, 200), context)
    expect(context.store.listElements()).toHaveLength(1)
    tool.onPointerDown(pointer(25, 25), context)
    tool.onCancel(context)
    tool.onPointerUp(pointer(25, 25), context)
    expect(context.store.listElements()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test test/tools`
Expected: FAIL, cannot resolve the three new modules.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/tools/draw.ts`:

```ts
import { normalizeLinearPoints } from '../geometry/points'
import { createElement } from '../model/create'
import type { ElementId, Point } from '../model/element'
import type { Tool } from './types'
import { topIndex } from './types'

/**
 * Freehand strokes: one store update per pointer move so collaborators
 * watch the stroke appear. The tool stays active on release so strokes
 * can chain without re-picking it.
 */
export function createDrawTool(): Tool {
  let worldPoints: Point[] | null = null
  let id: ElementId | null = null

  const reset = (): void => {
    worldPoints = null
    id = null
  }

  return {
    type: 'draw',
    onPointerDown(input, context) {
      context.store.stopCapturing()
      worldPoints = [input.world]
      const element = createElement('draw', {
        index: topIndex(context.store),
        ...context.getDefaults(),
        ...normalizeLinearPoints(worldPoints),
      })
      context.store.applyChanges([{ kind: 'create', element }])
      id = element.id
    },
    onPointerMove(input, context) {
      if (!worldPoints || !id) {
        return
      }
      worldPoints.push(input.world)
      context.store.applyChanges([
        { kind: 'update', id, props: normalizeLinearPoints(worldPoints) },
      ])
    },
    onPointerUp(_input, context) {
      if (id) {
        context.store.stopCapturing()
      }
      reset()
    },
    onCancel(context) {
      if (id) {
        // The streamed element is exactly the open capture entry.
        context.store.undo()
      }
      reset()
    },
  }
}
```

`packages/engine/src/tools/linear.ts`:

```ts
import { distance, normalizeLinearPoints } from '../geometry/points'
import { attachmentPoint, findBindTarget } from '../model/bindings'
import { createElement } from '../model/create'
import type { ElementId, ElementProps, Point } from '../model/element'
import type { Tool } from './types'
import { DRAG_THRESHOLD, HIT_TOLERANCE, topIndex } from './types'

const DIRECTION_STEP = Math.PI / 12

/** Keeps the segment length, snaps its direction to 15-degree steps. */
function snapDirection(start: Point, end: Point): Point {
  const length = distance(start, end)
  if (length === 0) {
    return end
  }
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const snapped = Math.round(angle / DIRECTION_STEP) * DIRECTION_STEP
  return {
    x: start.x + Math.cos(snapped) * length,
    y: start.y + Math.sin(snapped) * length,
  }
}

/**
 * Two-point drag for lines and arrows. Arrows bind their endpoints to
 * the topmost shape under them on release and anchor onto its outline.
 */
export function createLinearTool(type: 'line' | 'arrow'): Tool {
  let start: Point | null = null
  let end: Point | null = null
  let id: ElementId | null = null

  const reset = (): void => {
    start = null
    end = null
    id = null
  }

  return {
    type,
    onPointerDown(input, context) {
      context.store.stopCapturing()
      start = input.world
      end = input.world
      const element = createElement(type, {
        index: topIndex(context.store),
        ...context.getDefaults(),
        ...normalizeLinearPoints([start, end]),
      })
      context.store.applyChanges([{ kind: 'create', element }])
      id = element.id
    },
    onPointerMove(input, context) {
      if (!start || !id) {
        return
      }
      end = input.shiftKey ? snapDirection(start, input.world) : input.world
      context.store.applyChanges([
        { kind: 'update', id, props: normalizeLinearPoints([start, end]) },
      ])
    },
    onPointerUp(_input, context) {
      if (!start || !end || !id) {
        reset()
        return
      }
      const zoom = context.getCamera().zoom
      if (distance(start, end) < DRAG_THRESHOLD / zoom) {
        // A degenerate drag discards the whole capture entry.
        context.store.undo()
        reset()
        return
      }
      if (type === 'arrow') {
        const elements = context.store.listElements()
        const tolerance = HIT_TOLERANCE / zoom
        const exclude = new Set([id])
        const startTarget = findBindTarget(elements, start, tolerance, exclude)
        const endTarget = findBindTarget(elements, end, tolerance, exclude)
        const anchoredStart = startTarget
          ? attachmentPoint(startTarget, end)
          : start
        const anchoredEnd = endTarget
          ? attachmentPoint(endTarget, anchoredStart)
          : end
        const props: ElementProps = {
          ...normalizeLinearPoints([anchoredStart, anchoredEnd]),
          startBinding: startTarget ? { elementId: startTarget.id } : null,
          endBinding: endTarget ? { elementId: endTarget.id } : null,
        }
        context.store.applyChanges([{ kind: 'update', id, props }])
      }
      context.setSelection([id])
      context.setActiveTool('select')
      context.store.stopCapturing()
      reset()
    },
    onCancel(context) {
      if (id) {
        // The streamed element is exactly the open capture entry.
        context.store.undo()
      }
      reset()
    },
  }
}
```

`packages/engine/src/tools/eraser.ts`:

```ts
import { hitTestScene } from '../geometry/hit'
import type { ElementId } from '../model/element'
import { deleteElements } from '../model/operations'
import type { PointerInput, Tool, ToolContext } from './types'
import { HIT_TOLERANCE } from './types'

/**
 * Collects everything touched during the drag and deletes it as one
 * batch on release, so the whole sweep undoes in one step.
 */
export function createEraserTool(): Tool {
  let hitIds: Set<ElementId> | null = null

  const collect = (input: PointerInput, context: ToolContext): void => {
    if (!hitIds) {
      return
    }
    const pending = hitIds
    const tolerance = HIT_TOLERANCE / context.getCamera().zoom
    const remaining = context.store
      .listElements()
      .filter((element) => !pending.has(element.id))
    const hit = hitTestScene(remaining, input.world, tolerance)
    if (hit) {
      pending.add(hit.id)
    }
  }

  return {
    type: 'eraser',
    onPointerDown(input, context) {
      hitIds = new Set()
      collect(input, context)
    },
    onPointerMove(input, context) {
      collect(input, context)
    },
    onPointerUp(_input, context) {
      if (hitIds && hitIds.size > 0) {
        context.store.stopCapturing()
        context.store.applyChanges(
          deleteElements(context.store.listElements(), [...hitIds]),
        )
        context.store.stopCapturing()
      }
      hitIds = null
    },
    onCancel() {
      hitIds = null
    },
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { createDrawTool } from './tools/draw'
export { createEraserTool } from './tools/eraser'
export { createLinearTool } from './tools/linear'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test test/tools`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/tools packages/engine/test/tools packages/engine/src/index.ts
git commit -m "✨ feat(engine): add the draw, line, arrow, and eraser tools"
```

---

### Task 10: Text and image placement tools

**Files:**

- Create: `packages/engine/src/tools/text.ts`
- Create: `packages/engine/src/tools/image.ts`
- Test: `packages/engine/test/tools/text.test.ts`
- Test: `packages/engine/test/tools/image.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `Tool`, `topIndex` from `src/tools/types.ts`; `createElement`.
- Produces:
  - `createTextTool(): Tool` (click places an empty text element, selects it, asks the host to open its DOM text editor through `requestTextEdit`, falls back to the select tool; the host is responsible for sizing the element and removing it when editing commits empty)
  - `createImageTool(): Tool` (click places the host-staged `PendingImage` centered on the point; a click with no staged image does nothing)

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/tools/text.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { TextElement } from '../../src/model/element'
import { createTextTool } from '../../src/tools/text'
import { createTestContext, pointer } from './helpers'

describe('text tool', () => {
  it('places an empty text element and requests host editing', () => {
    const context = createTestContext()
    context.getDefaults = () => ({ fontSize: 28 })
    const tool = createTextTool()
    tool.onPointerDown(pointer(40, 30), context)
    tool.onPointerUp(pointer(40, 30), context)
    const [element] = context.store.listElements() as [TextElement]
    expect(element).toMatchObject({
      type: 'text',
      x: 40,
      y: 30,
      text: '',
      fontSize: 28,
    })
    expect(context.selection).toEqual([element.id])
    expect(context.textEditRequests).toEqual([element.id])
    expect(context.activeTool).toBe('select')
  })

  it('creates its own undo entry', () => {
    const context = createTestContext()
    const tool = createTextTool()
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerUp(pointer(0, 0), context)
    context.store.undo()
    expect(context.store.listElements()).toEqual([])
    expect(context.store.canUndo()).toBe(false)
  })
})
```

`packages/engine/test/tools/image.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ImageElement } from '../../src/model/element'
import { createImageTool } from '../../src/tools/image'
import { createTestContext, pointer } from './helpers'

describe('image tool', () => {
  it('places the staged image centered on the click', () => {
    const context = createTestContext()
    context.pendingImage = { assetHash: 'abc123', width: 200, height: 100 }
    const tool = createImageTool()
    tool.onPointerDown(pointer(300, 300), context)
    tool.onPointerUp(pointer(300, 300), context)
    const [element] = context.store.listElements() as [ImageElement]
    expect(element).toMatchObject({
      type: 'image',
      assetHash: 'abc123',
      x: 200,
      y: 250,
      width: 200,
      height: 100,
    })
    expect(context.selection).toEqual([element.id])
    expect(context.activeTool).toBe('select')
  })

  it('does nothing without a staged image', () => {
    const context = createTestContext()
    const tool = createImageTool()
    tool.onPointerDown(pointer(300, 300), context)
    tool.onPointerUp(pointer(300, 300), context)
    expect(context.store.listElements()).toEqual([])
    expect(context.activeTool).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/engine test test/tools/text.test.ts test/tools/image.test.ts`
Expected: FAIL, cannot resolve the two new modules.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/tools/text.ts`:

```ts
import { createElement } from '../model/create'
import type { Tool } from './types'
import { topIndex } from './types'

/**
 * Places an empty text element on click and hands editing to the host:
 * the engine has no DOM access, so the host opens its text editor over
 * the element, then sizes it (or removes it when committed empty).
 */
export function createTextTool(): Tool {
  return {
    type: 'text',
    onPointerDown() {},
    onPointerMove() {},
    onPointerUp(input, context) {
      context.store.stopCapturing()
      const element = createElement('text', {
        index: topIndex(context.store),
        ...context.getDefaults(),
        x: input.world.x,
        y: input.world.y,
      })
      context.store.applyChanges([{ kind: 'create', element }])
      context.store.stopCapturing()
      context.setSelection([element.id])
      context.requestTextEdit(element.id)
      context.setActiveTool('select')
    },
    onCancel() {},
  }
}
```

`packages/engine/src/tools/image.ts`:

```ts
import { createElement } from '../model/create'
import type { Tool } from './types'
import { topIndex } from './types'

/**
 * Places the image the host staged (upload and hashing are the host's
 * job), centered on the click. Without a staged image the tool is
 * inert.
 */
export function createImageTool(): Tool {
  return {
    type: 'image',
    onPointerDown() {},
    onPointerMove() {},
    onPointerUp(input, context) {
      const pending = context.getPendingImage()
      if (!pending) {
        return
      }
      context.store.stopCapturing()
      const element = createElement('image', {
        index: topIndex(context.store),
        ...context.getDefaults(),
        assetHash: pending.assetHash,
        x: input.world.x - pending.width / 2,
        y: input.world.y - pending.height / 2,
        width: pending.width,
        height: pending.height,
      })
      context.store.applyChanges([{ kind: 'create', element }])
      context.store.stopCapturing()
      context.setSelection([element.id])
      context.setActiveTool('select')
    },
    onCancel() {},
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { createImageTool } from './tools/image'
export { createTextTool } from './tools/text'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tlwb/engine test test/tools/text.test.ts test/tools/image.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/tools packages/engine/test/tools packages/engine/src/index.ts
git commit -m "✨ feat(engine): add the text and image placement tools"
```

---

### Task 11: The select tool

**Files:**

- Create: `packages/engine/src/tools/select.ts`
- Test: `packages/engine/test/tools/select.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `hitTestScene` from `src/geometry/hit.ts`; `getElementBounds`, `Rect` from `src/geometry/bounds.ts`; `SNAP_THRESHOLD`, `SnapGuide`, `snapMovedBounds` from `src/geometry/snap.ts`; `getHandles`, `hitTestHandles`, `ResizeHandleKind`, `resizeRect`, `rotationAngle`, `scaleElement` from `src/geometry/transform.ts`; `boundArrowUpdates` from `src/model/bindings.ts`; `duplicateElements` from `src/model/operations.ts`; `elementsInRect`, `expandToGroups`, `selectionBounds` from `src/selection.ts`; `Tool`, `ToolContext`, `HIT_TOLERANCE` from `src/tools/types.ts`.
- Produces: `createSelectTool(): Tool` with, in pointer-down priority order:
  1. A handle of the current selection box: `rotate` starts a rotation session (single-element selections only; on a multi-selection the rotate handle is inert and the press falls through), any other handle starts a resize session anchored on the pressed handle (`shiftKey` locks the aspect ratio from corners).
  2. An element under the pointer: `shiftKey` toggles its whole group in the selection without dragging; otherwise the group becomes the selection (or the existing selection is kept when the element is already in it), `altKey` first duplicates the selection in place and drags the clones, and a move session starts. Moves snap through `snapMovedBounds` against every non-selected element and re-anchor bound arrows after every batch.
  3. Empty canvas: without `shiftKey` the selection clears; a lasso session starts, and while it drags the selection follows `elementsInRect` expanded to groups.

  Every mutating session opens with `stopCapturing()` and closes with it on release, so a whole gesture is one undo entry. `onCancel` restores the pre-gesture geometry by undoing that entry (the cancellation convention of Task 8). `getOverlay()` exposes the lasso rect and the active snap guides.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/tools/select.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type {
  ArrowElement,
  BoardElement,
} from '../../src/model/element'
import { createSelectTool } from '../../src/tools/select'
import type { Tool } from '../../src/tools/types'
import { createTestContext, pointer, type TestContext } from './helpers'

describe('select tool', () => {
  let context: TestContext
  let tool: Tool

  beforeEach(() => {
    context = createTestContext()
    tool = createSelectTool()
  })

  function seed(...elements: BoardElement[]): void {
    context.store.applyChanges(
      elements.map((element) => ({ kind: 'create' as const, element })),
    )
    context.store.stopCapturing()
  }

  function click(x: number, y: number): void {
    tool.onPointerDown(pointer(x, y), context)
    tool.onPointerUp(pointer(x, y), context)
  }

  it('selects the topmost element on click and clears on empty click', () => {
    const back = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    const front = createElement('ellipse', {
      index: 'a1',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      fillColor: '#D9F2E5',
    })
    seed(back, front)
    click(100, 100)
    expect(context.selection).toEqual([front.id])
    click(400, 400)
    expect(context.selection).toEqual([])
  })

  it('expands to the whole group and shift-click toggles it', () => {
    const a = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
      groupId: 'g1',
    })
    const b = createElement('rectangle', {
      index: 'a1',
      x: 100,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
      groupId: 'g1',
    })
    const loner = createElement('rectangle', {
      index: 'a2',
      x: 300,
      y: 300,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    seed(a, b, loner)
    click(25, 25)
    expect(context.selection).toEqual([a.id, b.id])
    tool.onPointerDown(pointer(325, 325, { shiftKey: true }), context)
    tool.onPointerUp(pointer(325, 325, { shiftKey: true }), context)
    expect(context.selection).toEqual([a.id, b.id, loner.id])
    tool.onPointerDown(pointer(25, 25, { shiftKey: true }), context)
    tool.onPointerUp(pointer(25, 25, { shiftKey: true }), context)
    expect(context.selection).toEqual([loner.id])
  })

  it('moves the selection and undoes the whole drag in one step', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    seed(shape)
    tool.onPointerDown(pointer(25, 25), context)
    tool.onPointerMove(pointer(300, 25), context)
    tool.onPointerMove(pointer(300, 200), context)
    tool.onPointerUp(pointer(300, 200), context)
    expect(context.store.getElement(shape.id)).toMatchObject({
      x: 275,
      y: 175,
    })
    context.store.undo()
    expect(context.store.getElement(shape.id)).toMatchObject({ x: 0, y: 0 })
  })

  it('snaps a move to a nearby edge and exposes the guide', () => {
    const moving = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    const anchor = createElement('rectangle', {
      index: 'a1',
      x: 200,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    seed(moving, anchor)
    tool.onPointerDown(pointer(25, 25), context)
    // Raw drag puts the right edge at 199; the anchor's left edge is 200.
    tool.onPointerMove(pointer(174, 25), context)
    expect(context.store.getElement(moving.id)?.x).toBe(150)
    // The drag stays on the anchor's row, so the aligned tops also
    // produce a horizontal guide.
    expect(tool.getOverlay?.().guides).toEqual([
      { orientation: 'vertical', position: 200 },
      { orientation: 'horizontal', position: 0 },
    ])
    tool.onPointerUp(pointer(174, 25), context)
  })

  it('duplicates on alt-drag and moves the clones', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    seed(shape)
    tool.onPointerDown(pointer(25, 25, { altKey: true }), context)
    tool.onPointerMove(pointer(325, 25, { altKey: true }), context)
    tool.onPointerUp(pointer(325, 25, { altKey: true }), context)
    const elements = context.store.listElements()
    expect(elements).toHaveLength(2)
    expect(context.store.getElement(shape.id)).toMatchObject({ x: 0, y: 0 })
    const clone = elements.find((element) => element.id !== shape.id)
    expect(clone).toMatchObject({ x: 300, y: 0 })
    expect(context.selection).toEqual([clone?.id])
  })

  it('lassos intersecting elements with group expansion', () => {
    const a = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      groupId: 'g1',
    })
    const b = createElement('rectangle', {
      index: 'a1',
      x: 500,
      y: 500,
      width: 50,
      height: 50,
      groupId: 'g1',
    })
    const c = createElement('rectangle', {
      index: 'a2',
      x: 100,
      y: 0,
      width: 50,
      height: 50,
    })
    seed(a, b, c)
    tool.onPointerDown(pointer(-10, -10), context)
    tool.onPointerMove(pointer(60, 60), context)
    expect(tool.getOverlay?.().lasso).toEqual({
      x: -10,
      y: -10,
      width: 70,
      height: 70,
    })
    expect(context.selection).toEqual([a.id, b.id])
    tool.onPointerUp(pointer(60, 60), context)
    expect(context.store.listElements()).toHaveLength(3)
  })

  it('resizes the selection from the se handle', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    seed(shape)
    context.selection = [shape.id]
    tool.onPointerDown(pointer(100, 100), context)
    tool.onPointerMove(pointer(200, 150), context)
    tool.onPointerUp(pointer(200, 150), context)
    expect(context.store.getElement(shape.id)).toMatchObject({
      x: 0,
      y: 0,
      width: 200,
      height: 150,
    })
    context.store.undo()
    expect(context.store.getElement(shape.id)).toMatchObject({
      width: 100,
      height: 100,
    })
  })

  it('rotates a single element from the rotate handle, snapping with shift', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    seed(shape)
    context.selection = [shape.id]
    // Rotate handle sits at (50, -24) for zoom 1.
    tool.onPointerDown(pointer(50, -24), context)
    tool.onPointerMove(pointer(150, 50, { shiftKey: true }), context)
    tool.onPointerUp(pointer(150, 50, { shiftKey: true }), context)
    expect(context.store.getElement(shape.id)?.angle).toBeCloseTo(Math.PI / 2)
  })

  it('re-anchors bound arrows while their shape moves', () => {
    const left = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    const right = createElement('rectangle', {
      index: 'a1',
      x: 300,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    const arrow = createElement('arrow', {
      index: 'a2',
      x: 100,
      y: 50,
      width: 200,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      startBinding: { elementId: left.id },
      endBinding: { elementId: right.id },
    })
    seed(left, right, arrow)
    tool.onPointerDown(pointer(50, 50), context)
    tool.onPointerMove(pointer(50, 350), context)
    tool.onPointerUp(pointer(50, 350), context)
    const moved = context.store.getElement(arrow.id) as ArrowElement
    const startY = moved.y + (moved.points[0]?.y ?? 0)
    // The start now anchors on the moved shape, 300 lower.
    expect(startY).toBeGreaterThanOrEqual(300)
  })

  it('restores the pre-gesture geometry on cancel', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    seed(shape)
    tool.onPointerDown(pointer(25, 25), context)
    tool.onPointerMove(pointer(300, 300), context)
    tool.onCancel(context)
    expect(context.store.getElement(shape.id)).toMatchObject({ x: 0, y: 0 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test test/tools/select.test.ts`
Expected: FAIL, cannot resolve `../../src/tools/select`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/tools/select.ts`:

```ts
import { getElementBounds, type Rect } from '../geometry/bounds'
import { hitTestScene } from '../geometry/hit'
import {
  SNAP_THRESHOLD,
  type SnapGuide,
  snapMovedBounds,
} from '../geometry/snap'
import {
  getHandles,
  hitTestHandles,
  type ResizeHandleKind,
  resizeRect,
  rotationAngle,
  scaleElement,
} from '../geometry/transform'
import { boundArrowUpdates } from '../model/bindings'
import type { BoardElement, ElementId, Point } from '../model/element'
import { duplicateElements } from '../model/operations'
import {
  elementsInRect,
  expandToGroups,
  selectionBounds,
} from '../selection'
import type { BoardChange, BoardStore } from '../store/types'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'
import { HIT_TOLERANCE } from './types'

type Session =
  | { kind: 'idle' }
  | {
      kind: 'moving'
      origin: Point
      start: Map<ElementId, Point>
      guides: SnapGuide[]
      /** True once the gesture applied a batch; cancel undoes it then. */
      wrote: boolean
    }
  | { kind: 'lasso'; origin: Point; rect: Rect }
  | {
      kind: 'resizing'
      handle: ResizeHandleKind
      origin: Point
      startBounds: Rect
      start: Map<ElementId, BoardElement>
      wrote: boolean
    }
  | { kind: 'rotating'; id: ElementId; center: Point; wrote: boolean }

function rectFromCorners(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/** Applies a batch, then re-anchors arrows bound to the touched ids. */
function applyWithArrows(
  store: BoardStore,
  changes: BoardChange[],
  touchedIds: ReadonlySet<ElementId>,
): void {
  store.applyChanges(changes)
  const arrows = boundArrowUpdates(store.listElements(), touchedIds)
  if (arrows.length > 0) {
    store.applyChanges(arrows)
  }
}

export function createSelectTool(): Tool {
  let session: Session = { kind: 'idle' }

  const startMove = (
    input: PointerInput,
    context: ToolContext,
    ids: readonly ElementId[],
    wrote: boolean,
  ): void => {
    const start = new Map<ElementId, Point>()
    for (const id of ids) {
      const element = context.store.getElement(id)
      if (element) {
        start.set(id, { x: element.x, y: element.y })
      }
    }
    session = { kind: 'moving', origin: input.world, start, guides: [], wrote }
  }

  return {
    type: 'select',

    onPointerDown(input, context) {
      const store = context.store
      const elements = store.listElements()
      const zoom = context.getCamera().zoom
      const selected = context.getSelection()

      if (selected.length > 0) {
        const bounds = selectionBounds(elements, selected)
        if (bounds) {
          const handles = getHandles(bounds, zoom)
          const handle = hitTestHandles(handles, input.world, zoom)
          if (handle === 'rotate' && selected.length === 1) {
            const id = selected[0] as ElementId
            const element = store.getElement(id)
            if (element) {
              store.stopCapturing()
              session = {
                kind: 'rotating',
                id,
                center: {
                  x: element.x + element.width / 2,
                  y: element.y + element.height / 2,
                },
                wrote: false,
              }
              return
            }
          }
          if (handle && handle !== 'rotate') {
            store.stopCapturing()
            const start = new Map<ElementId, BoardElement>()
            for (const id of selected) {
              const element = store.getElement(id)
              if (element) {
                start.set(id, element)
              }
            }
            session = {
              kind: 'resizing',
              handle,
              origin: input.world,
              startBounds: bounds,
              start,
              wrote: false,
            }
            return
          }
        }
      }

      const hit = hitTestScene(elements, input.world, HIT_TOLERANCE / zoom)
      if (hit) {
        const group = expandToGroups(elements, [hit.id])
        if (input.shiftKey) {
          const set = new Set(selected)
          const allIn = group.every((id) => set.has(id))
          for (const id of group) {
            if (allIn) {
              set.delete(id)
            } else {
              set.add(id)
            }
          }
          context.setSelection(
            elements
              .filter((element) => set.has(element.id))
              .map((element) => element.id),
          )
          session = { kind: 'idle' }
          return
        }
        let ids: readonly ElementId[] = selected.includes(hit.id)
          ? selected
          : group
        if (!selected.includes(hit.id)) {
          context.setSelection([...group])
        }
        store.stopCapturing()
        let wrote = false
        if (input.altKey) {
          const { changes, newIds } = duplicateElements(elements, ids, {
            x: 0,
            y: 0,
          })
          store.applyChanges(changes)
          context.setSelection(newIds)
          ids = newIds
          wrote = true
        }
        startMove(input, context, ids, wrote)
        return
      }

      if (!input.shiftKey) {
        context.setSelection([])
      }
      session = {
        kind: 'lasso',
        origin: input.world,
        rect: rectFromCorners(input.world, input.world),
      }
    },

    onPointerMove(input, context) {
      const store = context.store
      switch (session.kind) {
        case 'idle':
          return
        case 'moving': {
          const raw = {
            x: input.world.x - session.origin.x,
            y: input.world.y - session.origin.y,
          }
          const elements = store.listElements()
          const movedIds = new Set(session.start.keys())
          let movingBounds: Rect | null = null
          const others: Rect[] = []
          for (const element of elements) {
            const startPosition = session.start.get(element.id)
            if (!startPosition) {
              others.push(getElementBounds(element))
              continue
            }
            const bounds = getElementBounds({
              ...element,
              x: startPosition.x + raw.x,
              y: startPosition.y + raw.y,
            } as BoardElement)
            movingBounds = movingBounds
              ? {
                  x: Math.min(movingBounds.x, bounds.x),
                  y: Math.min(movingBounds.y, bounds.y),
                  width:
                    Math.max(
                      movingBounds.x + movingBounds.width,
                      bounds.x + bounds.width,
                    ) - Math.min(movingBounds.x, bounds.x),
                  height:
                    Math.max(
                      movingBounds.y + movingBounds.height,
                      bounds.y + bounds.height,
                    ) - Math.min(movingBounds.y, bounds.y),
                }
              : bounds
          }
          if (!movingBounds) {
            return
          }
          const threshold = SNAP_THRESHOLD / context.getCamera().zoom
          const snap = snapMovedBounds(movingBounds, others, threshold)
          const dx = raw.x + snap.dx
          const dy = raw.y + snap.dy
          const changes: BoardChange[] = [...session.start].map(
            ([id, startPosition]) => ({
              kind: 'update',
              id,
              props: { x: startPosition.x + dx, y: startPosition.y + dy },
            }),
          )
          applyWithArrows(store, changes, movedIds)
          session.guides = snap.guides
          session.wrote = true
          return
        }
        case 'lasso': {
          session.rect = rectFromCorners(session.origin, input.world)
          const elements = store.listElements()
          context.setSelection(
            expandToGroups(elements, elementsInRect(elements, session.rect)),
          )
          return
        }
        case 'resizing': {
          const delta = {
            x: input.world.x - session.origin.x,
            y: input.world.y - session.origin.y,
          }
          const to = resizeRect(
            session.startBounds,
            session.handle,
            delta,
            input.shiftKey,
          )
          if (to.width === 0 || to.height === 0) {
            return
          }
          const changes: BoardChange[] = [...session.start].map(
            ([id, element]) => ({
              kind: 'update',
              id,
              props: scaleElement(element, session.startBounds, to),
            }),
          )
          applyWithArrows(store, changes, new Set(session.start.keys()))
          session.wrote = true
          return
        }
        case 'rotating': {
          const angle = rotationAngle(
            session.center,
            input.world,
            input.shiftKey,
          )
          applyWithArrows(
            store,
            [{ kind: 'update', id: session.id, props: { angle } }],
            new Set([session.id]),
          )
          session.wrote = true
          return
        }
      }
    },

    onPointerUp(_input, context) {
      if (session.kind !== 'idle') {
        context.store.stopCapturing()
      }
      session = { kind: 'idle' }
    },

    onCancel(context) {
      if (
        (session.kind === 'moving' ||
          session.kind === 'resizing' ||
          session.kind === 'rotating') &&
        session.wrote
      ) {
        // The gesture is exactly the open capture entry; undoing it
        // restores every element and bound arrow it touched.
        context.store.undo()
      }
      session = { kind: 'idle' }
    },

    getOverlay(): ToolOverlay {
      return {
        lasso: session.kind === 'lasso' ? session.rect : null,
        guides: session.kind === 'moving' ? session.guides : [],
      }
    },
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export { createSelectTool } from './tools/select'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test test/tools/select.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/tools/select.ts packages/engine/test/tools/select.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): drive selection, moving, resizing, and lasso with the select tool"
```

---

### Task 12: Keyboard shortcuts

**Files:**

- Create: `packages/engine/src/keyboard.ts`
- Test: `packages/engine/test/keyboard.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: `ToolType` from `src/tools/types.ts`.
- Produces:
  - `interface KeyInput { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }` (the shape of `KeyboardEvent`, so the host forwards events directly)
  - `type KeyboardAction =` `{ kind: 'set-tool'; tool: ToolType }` `| { kind: 'cancel' }` `| { kind: 'delete-selection' }` `| { kind: 'duplicate-selection' }` `| { kind: 'group-selection' }` `| { kind: 'ungroup-selection' }` `| { kind: 'select-all' }` `| { kind: 'undo' }` `| { kind: 'redo' }` `| { kind: 'nudge'; dx: number; dy: number }` `| { kind: 'bring-to-front' }` `| { kind: 'send-to-back' }` `| { kind: 'bring-forward' }` `| { kind: 'send-backward' }`
  - `resolveKeyboardAction(input: KeyInput): KeyboardAction | null` (pure; `null` means "not ours, let the browser have it")

  Bindings: tools on `1`–`9`, `0`, `E` in the toolbar order fixed by the Global Constraints; `Escape` cancel; `Delete`/`Backspace` delete; arrows nudge by 1 world unit (10 with shift); mod (`meta` or `ctrl`) combos: `Z` undo, `shift+Z` redo, `A` select all, `D` duplicate, `G` group, `shift+G` ungroup, `]` bring forward, `[` send backward, `alt+]` bring to front, `alt+[` send to back.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/keyboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { type KeyInput, resolveKeyboardAction } from '../src/keyboard'

function key(partial: Partial<KeyInput> & { key: string }): KeyInput {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  }
}

describe('resolveKeyboardAction', () => {
  it('maps the numbered tool shortcuts in toolbar order', () => {
    expect(resolveKeyboardAction(key({ key: '1' }))).toEqual({
      kind: 'set-tool',
      tool: 'select',
    })
    expect(resolveKeyboardAction(key({ key: '2' }))).toEqual({
      kind: 'set-tool',
      tool: 'hand',
    })
    expect(resolveKeyboardAction(key({ key: '6' }))).toEqual({
      kind: 'set-tool',
      tool: 'arrow',
    })
    expect(resolveKeyboardAction(key({ key: '0' }))).toEqual({
      kind: 'set-tool',
      tool: 'image',
    })
    expect(resolveKeyboardAction(key({ key: 'e' }))).toEqual({
      kind: 'set-tool',
      tool: 'eraser',
    })
    expect(resolveKeyboardAction(key({ key: 'E' }))).toEqual({
      kind: 'set-tool',
      tool: 'eraser',
    })
  })

  it('maps editing keys', () => {
    expect(resolveKeyboardAction(key({ key: 'Escape' }))).toEqual({
      kind: 'cancel',
    })
    expect(resolveKeyboardAction(key({ key: 'Delete' }))).toEqual({
      kind: 'delete-selection',
    })
    expect(resolveKeyboardAction(key({ key: 'Backspace' }))).toEqual({
      kind: 'delete-selection',
    })
  })

  it('maps modifier combos on meta and on ctrl alike', () => {
    expect(resolveKeyboardAction(key({ key: 'z', metaKey: true }))).toEqual({
      kind: 'undo',
    })
    expect(
      resolveKeyboardAction(key({ key: 'z', ctrlKey: true, shiftKey: true })),
    ).toEqual({ kind: 'redo' })
    expect(resolveKeyboardAction(key({ key: 'a', metaKey: true }))).toEqual({
      kind: 'select-all',
    })
    expect(resolveKeyboardAction(key({ key: 'd', metaKey: true }))).toEqual({
      kind: 'duplicate-selection',
    })
    expect(resolveKeyboardAction(key({ key: 'g', metaKey: true }))).toEqual({
      kind: 'group-selection',
    })
    expect(
      resolveKeyboardAction(key({ key: 'g', metaKey: true, shiftKey: true })),
    ).toEqual({ kind: 'ungroup-selection' })
    expect(resolveKeyboardAction(key({ key: ']', metaKey: true }))).toEqual({
      kind: 'bring-forward',
    })
    expect(
      resolveKeyboardAction(key({ key: ']', metaKey: true, altKey: true })),
    ).toEqual({ kind: 'bring-to-front' })
    expect(resolveKeyboardAction(key({ key: '[', metaKey: true }))).toEqual({
      kind: 'send-backward',
    })
    expect(
      resolveKeyboardAction(key({ key: '[', metaKey: true, altKey: true })),
    ).toEqual({ kind: 'send-to-back' })
  })

  it('nudges with the arrows, larger with shift', () => {
    expect(resolveKeyboardAction(key({ key: 'ArrowLeft' }))).toEqual({
      kind: 'nudge',
      dx: -1,
      dy: 0,
    })
    expect(
      resolveKeyboardAction(key({ key: 'ArrowDown', shiftKey: true })),
    ).toEqual({ kind: 'nudge', dx: 0, dy: 10 })
  })

  it('leaves unknown keys to the browser', () => {
    expect(resolveKeyboardAction(key({ key: 'q' }))).toBeNull()
    expect(resolveKeyboardAction(key({ key: 'p', metaKey: true }))).toBeNull()
    expect(resolveKeyboardAction(key({ key: 'F5' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test test/keyboard.test.ts`
Expected: FAIL, cannot resolve `../src/keyboard`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/keyboard.ts`:

```ts
import type { ToolType } from './tools/types'

/** The relevant subset of KeyboardEvent, so hosts forward events as-is. */
export interface KeyInput {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export type KeyboardAction =
  | { kind: 'set-tool'; tool: ToolType }
  | { kind: 'cancel' }
  | { kind: 'delete-selection' }
  | { kind: 'duplicate-selection' }
  | { kind: 'group-selection' }
  | { kind: 'ungroup-selection' }
  | { kind: 'select-all' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'bring-to-front' }
  | { kind: 'send-to-back' }
  | { kind: 'bring-forward' }
  | { kind: 'send-backward' }

/** Toolbar order fixed by the Paper artboards. */
const TOOL_KEYS: Record<string, ToolType> = {
  '1': 'select',
  '2': 'hand',
  '3': 'rectangle',
  '4': 'ellipse',
  '5': 'diamond',
  '6': 'arrow',
  '7': 'line',
  '8': 'draw',
  '9': 'text',
  '0': 'image',
  e: 'eraser',
}

const NUDGE_STEP = 1
const NUDGE_STEP_LARGE = 10

/**
 * Pure keyboard resolution: null means "not ours, let the browser have
 * it". The host decides when to call it (not while a text input has
 * focus) and preventDefaults when an action comes back.
 */
export function resolveKeyboardAction(input: KeyInput): KeyboardAction | null {
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
  const mod = input.metaKey || input.ctrlKey
  if (mod) {
    switch (key) {
      case 'z':
        return input.shiftKey ? { kind: 'redo' } : { kind: 'undo' }
      case 'a':
        return { kind: 'select-all' }
      case 'd':
        return { kind: 'duplicate-selection' }
      case 'g':
        return input.shiftKey
          ? { kind: 'ungroup-selection' }
          : { kind: 'group-selection' }
      case ']':
        return input.altKey
          ? { kind: 'bring-to-front' }
          : { kind: 'bring-forward' }
      case '[':
        return input.altKey
          ? { kind: 'send-to-back' }
          : { kind: 'send-backward' }
      default:
        return null
    }
  }
  const step = input.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP
  switch (key) {
    case 'Escape':
      return { kind: 'cancel' }
    case 'Delete':
    case 'Backspace':
      return { kind: 'delete-selection' }
    case 'ArrowLeft':
      return { kind: 'nudge', dx: -step, dy: 0 }
    case 'ArrowRight':
      return { kind: 'nudge', dx: step, dy: 0 }
    case 'ArrowUp':
      return { kind: 'nudge', dx: 0, dy: -step }
    case 'ArrowDown':
      return { kind: 'nudge', dx: 0, dy: step }
    default: {
      const tool = TOOL_KEYS[key]
      return tool ? { kind: 'set-tool', tool } : null
    }
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type { KeyboardAction, KeyInput } from './keyboard'
export { resolveKeyboardAction } from './keyboard'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine test test/keyboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/keyboard.ts packages/engine/test/keyboard.test.ts packages/engine/src/index.ts
git commit -m "✨ feat(engine): map keyboard shortcuts to editor actions"
```

---

### Task 13: The headless interaction controller

**Files:**

- Create: `packages/engine/src/interaction/controller.ts`
- Test: `packages/engine/test/interaction/controller.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**

- Consumes: everything this plan built: the eleven tool factories, `resolveKeyboardAction`, the operation builders, `boundArrowUpdates`, `selectionBounds`, `getHandles`, plus `Camera` and `BoardStore`.
- Produces:

```ts
export interface InteractionSnapshot {
  activeTool: ToolType
  selectedIds: ElementId[]
  selectionBounds: Rect | null
  /** Present only for the select tool with a non-empty selection. */
  handles: Handle[]
  lasso: Rect | null
  guides: SnapGuide[]
}

export interface InteractionControllerOptions {
  store: BoardStore
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** Initial style defaults for created elements. */
  defaults?: ElementProps
  onTextEditRequest?(id: ElementId): void
  getPendingImage?(): PendingImage | null
}

export interface InteractionController {
  getActiveTool(): ToolType
  setActiveTool(type: ToolType): void
  getSelectedIds(): ElementId[]
  setSelectedIds(ids: ElementId[]): void
  /** Merged into the creation defaults (contextual panel writes here). */
  setDefaults(patch: ElementProps): void
  pointerDown(input: PointerInput): void
  pointerMove(input: PointerInput): void
  pointerUp(input: PointerInput): void
  /** True when the key was consumed; the host preventDefaults then. */
  handleKey(input: KeyInput): boolean
  getSnapshot(): InteractionSnapshot
  /** Fires on any change of tool, selection, or gesture state. */
  subscribe(listener: () => void): () => void
  destroy(): void
}

export function createInteractionController(
  options: InteractionControllerOptions,
): InteractionController
```

  Behavior: owns the selection and the active tool; routes pointer input to the active tool; executes keyboard actions (discrete actions wrapped in `stopCapturing()` pairs; nudges deliberately not separated so held arrows coalesce into one undo entry, with bound arrows re-anchored); switching tools cancels any gesture in flight; `Escape` cancels the gesture and clears the selection; prunes the selection when elements disappear for any reason (undo, remote batch, eraser); duplicates offset by 10 world units.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/interaction/controller.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { type Camera, createCamera } from '../../src/camera'
import {
  createInteractionController,
  type InteractionController,
} from '../../src/interaction/controller'
import { createElement } from '../../src/model/create'
import { InMemoryBoardStore } from '../../src/store/memory'
import type { KeyInput } from '../../src/keyboard'
import type { PointerInput } from '../../src/tools/types'

function setup(): {
  store: InMemoryBoardStore
  controller: InteractionController
} {
  const store = new InMemoryBoardStore()
  let camera: Camera = createCamera()
  const controller = createInteractionController({
    store,
    getCamera: () => camera,
    setCamera: (next) => {
      camera = next
    },
  })
  return { store, controller }
}

function down(controller: InteractionController, x: number, y: number): void {
  controller.pointerDown(input(x, y))
}

function input(x: number, y: number): PointerInput {
  return {
    world: { x, y },
    screen: { x, y },
    shiftKey: false,
    altKey: false,
  }
}

function key(partial: Partial<KeyInput> & { key: string }): KeyInput {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  }
}

describe('interaction controller', () => {
  it('draws a rectangle end to end and falls back to select', () => {
    const { store, controller } = setup()
    expect(controller.handleKey(key({ key: '3' }))).toBe(true)
    expect(controller.getActiveTool()).toBe('rectangle')
    down(controller, 10, 10)
    controller.pointerMove(input(110, 60))
    controller.pointerUp(input(110, 60))
    const [element] = store.listElements()
    expect(element).toMatchObject({ type: 'rectangle', width: 100, height: 50 })
    expect(controller.getActiveTool()).toBe('select')
    expect(controller.getSelectedIds()).toEqual([element?.id])
  })

  it('reports handles and bounds in the snapshot for the select tool', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    store.applyChanges([{ kind: 'create', element: shape }])
    controller.setSelectedIds([shape.id])
    const snapshot = controller.getSnapshot()
    expect(snapshot.activeTool).toBe('select')
    expect(snapshot.selectionBounds).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(snapshot.handles).toHaveLength(9)
    expect(snapshot.lasso).toBeNull()
  })

  it('executes delete, duplicate, and undo from the keyboard', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    store.applyChanges([{ kind: 'create', element: shape }])
    store.stopCapturing()
    controller.setSelectedIds([shape.id])
    expect(controller.handleKey(key({ key: 'd', metaKey: true }))).toBe(true)
    expect(store.listElements()).toHaveLength(2)
    const cloneId = controller.getSelectedIds()[0]
    expect(cloneId).not.toBe(shape.id)
    expect(store.getElement(cloneId ?? '')).toMatchObject({ x: 10, y: 10 })
    expect(controller.handleKey(key({ key: 'Delete' }))).toBe(true)
    expect(store.listElements()).toHaveLength(1)
    expect(controller.getSelectedIds()).toEqual([])
    expect(controller.handleKey(key({ key: 'z', metaKey: true }))).toBe(true)
    expect(store.listElements()).toHaveLength(2)
  })

  it('nudges the selection and coalesces held arrows into one undo entry', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    store.applyChanges([{ kind: 'create', element: shape }])
    store.stopCapturing()
    controller.setSelectedIds([shape.id])
    controller.handleKey(key({ key: 'ArrowRight' }))
    controller.handleKey(key({ key: 'ArrowRight' }))
    controller.handleKey(key({ key: 'ArrowDown', shiftKey: true }))
    expect(store.getElement(shape.id)).toMatchObject({ x: 2, y: 10 })
    store.undo()
    expect(store.getElement(shape.id)).toMatchObject({ x: 0, y: 0 })
  })

  it('prunes the selection when elements disappear remotely', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', { index: 'a0' })
    store.applyChanges([{ kind: 'create', element: shape }])
    controller.setSelectedIds([shape.id])
    store.applyChanges([{ kind: 'delete', id: shape.id }], 'remote')
    expect(controller.getSelectedIds()).toEqual([])
  })

  it('cancels the gesture and clears the selection on Escape', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    store.applyChanges([{ kind: 'create', element: shape }])
    store.stopCapturing()
    down(controller, 25, 25)
    controller.pointerMove(input(300, 300))
    expect(controller.handleKey(key({ key: 'Escape' }))).toBe(true)
    expect(store.getElement(shape.id)).toMatchObject({ x: 0, y: 0 })
    expect(controller.getSelectedIds()).toEqual([])
  })

  it('applies setDefaults to newly created elements', () => {
    const { store, controller } = setup()
    controller.setDefaults({ strokeColor: '#FF6B4A' })
    controller.handleKey(key({ key: '3' }))
    down(controller, 0, 0)
    controller.pointerMove(input(50, 50))
    controller.pointerUp(input(50, 50))
    expect(store.listElements()[0]?.strokeColor).toBe('#FF6B4A')
  })

  it('notifies subscribers and stops after destroy', () => {
    const { store, controller } = setup()
    let calls = 0
    const unsubscribe = controller.subscribe(() => {
      calls += 1
    })
    controller.handleKey(key({ key: '2' }))
    expect(calls).toBeGreaterThan(0)
    unsubscribe()
    const before = calls
    controller.handleKey(key({ key: '1' }))
    expect(calls).toBe(before)
    controller.destroy()
    const shape = createElement('rectangle', { index: 'a0' })
    store.applyChanges([{ kind: 'create', element: shape }])
    expect(controller.getSelectedIds()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine test test/interaction/controller.test.ts`
Expected: FAIL, cannot resolve `../../src/interaction/controller`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/interaction/controller.ts`:

```ts
import type { Camera } from '../camera'
import type { Rect } from '../geometry/bounds'
import type { SnapGuide } from '../geometry/snap'
import { getHandles, type Handle } from '../geometry/transform'
import {
  type KeyboardAction,
  type KeyInput,
  resolveKeyboardAction,
} from '../keyboard'
import { boundArrowUpdates } from '../model/bindings'
import type { ElementId, ElementProps } from '../model/element'
import {
  bringForward,
  bringToFront,
  deleteElements,
  duplicateElements,
  groupElements,
  sendBackward,
  sendToBack,
  ungroupElements,
} from '../model/operations'
import { selectionBounds } from '../selection'
import type { BoardChange, BoardStore } from '../store/types'
import { createDrawTool } from '../tools/draw'
import { createEraserTool } from '../tools/eraser'
import { createHandTool } from '../tools/hand'
import { createImageTool } from '../tools/image'
import { createLinearTool } from '../tools/linear'
import { createSelectTool } from '../tools/select'
import { createShapeTool } from '../tools/shape'
import { createTextTool } from '../tools/text'
import type {
  PendingImage,
  PointerInput,
  Tool,
  ToolContext,
  ToolType,
} from '../tools/types'

export interface InteractionSnapshot {
  activeTool: ToolType
  selectedIds: ElementId[]
  selectionBounds: Rect | null
  /** Present only for the select tool with a non-empty selection. */
  handles: Handle[]
  lasso: Rect | null
  guides: SnapGuide[]
}

export interface InteractionControllerOptions {
  store: BoardStore
  getCamera(): Camera
  setCamera(camera: Camera): void
  /** Initial style defaults for created elements. */
  defaults?: ElementProps
  onTextEditRequest?(id: ElementId): void
  getPendingImage?(): PendingImage | null
}

export interface InteractionController {
  getActiveTool(): ToolType
  setActiveTool(type: ToolType): void
  getSelectedIds(): ElementId[]
  setSelectedIds(ids: ElementId[]): void
  /** Merged into the creation defaults (contextual panel writes here). */
  setDefaults(patch: ElementProps): void
  pointerDown(input: PointerInput): void
  pointerMove(input: PointerInput): void
  pointerUp(input: PointerInput): void
  /** True when the key was consumed; the host preventDefaults then. */
  handleKey(input: KeyInput): boolean
  getSnapshot(): InteractionSnapshot
  /** Fires on any change of tool, selection, or gesture state. */
  subscribe(listener: () => void): () => void
  destroy(): void
}

const DUPLICATE_OFFSET = 10

/**
 * The headless editor: owns the active tool and the selection, routes
 * already-projected pointer input and keyboard input, and exposes the
 * state the overlay rendering needs. The next plan's createEditor binds
 * DOM events onto it.
 */
export function createInteractionController(
  options: InteractionControllerOptions,
): InteractionController {
  const { store } = options
  let selection: ElementId[] = []
  let activeToolType: ToolType = 'select'
  let defaults: ElementProps = { ...options.defaults }
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  const context: ToolContext = {
    store,
    getCamera: () => options.getCamera(),
    setCamera: (camera) => options.setCamera(camera),
    getSelection: () => selection,
    setSelection: (ids) => {
      selection = ids
      notify()
    },
    getDefaults: () => defaults,
    setActiveTool: (type) => setActiveTool(type),
    requestTextEdit: (id) => options.onTextEditRequest?.(id),
    getPendingImage: () => options.getPendingImage?.() ?? null,
  }

  const tools: Record<ToolType, Tool> = {
    select: createSelectTool(),
    hand: createHandTool(),
    rectangle: createShapeTool('rectangle'),
    ellipse: createShapeTool('ellipse'),
    diamond: createShapeTool('diamond'),
    arrow: createLinearTool('arrow'),
    line: createLinearTool('line'),
    draw: createDrawTool(),
    text: createTextTool(),
    image: createImageTool(),
    eraser: createEraserTool(),
  }

  function setActiveTool(type: ToolType): void {
    if (type === activeToolType) {
      return
    }
    tools[activeToolType].onCancel(context)
    activeToolType = type
    notify()
  }

  // Selection ids must never point at missing elements, whatever
  // removed them: undo, a remote batch, or the eraser.
  const unsubscribe = store.subscribe((event) => {
    if (event.kind !== 'changes') {
      return
    }
    const deleted = new Set<ElementId>()
    for (const change of event.changes) {
      if (change.kind === 'delete') {
        deleted.add(change.id)
      }
    }
    if (deleted.size === 0) {
      return
    }
    const pruned = selection.filter((id) => !deleted.has(id))
    if (pruned.length !== selection.length) {
      selection = pruned
      notify()
    }
  })

  /** One discrete action = one undo entry. */
  function applyDiscrete(changes: BoardChange[]): void {
    if (changes.length === 0) {
      return
    }
    store.stopCapturing()
    store.applyChanges(changes)
    store.stopCapturing()
  }

  function execute(action: KeyboardAction): void {
    const elements = store.listElements()
    switch (action.kind) {
      case 'set-tool':
        setActiveTool(action.tool)
        return
      case 'cancel':
        tools[activeToolType].onCancel(context)
        context.setSelection([])
        return
      case 'undo':
        store.undo()
        return
      case 'redo':
        store.redo()
        return
      case 'select-all':
        context.setSelection(elements.map((element) => element.id))
        return
      case 'delete-selection':
        applyDiscrete(deleteElements(elements, selection))
        return
      case 'duplicate-selection': {
        if (selection.length === 0) {
          return
        }
        store.stopCapturing()
        const { changes, newIds } = duplicateElements(elements, selection, {
          x: DUPLICATE_OFFSET,
          y: DUPLICATE_OFFSET,
        })
        store.applyChanges(changes)
        store.stopCapturing()
        context.setSelection(newIds)
        return
      }
      case 'group-selection':
        applyDiscrete(groupElements(elements, selection))
        return
      case 'ungroup-selection':
        applyDiscrete(ungroupElements(elements, selection))
        return
      case 'bring-to-front':
        applyDiscrete(bringToFront(elements, selection))
        return
      case 'send-to-back':
        applyDiscrete(sendToBack(elements, selection))
        return
      case 'bring-forward':
        applyDiscrete(bringForward(elements, selection))
        return
      case 'send-backward':
        applyDiscrete(sendBackward(elements, selection))
        return
      case 'nudge': {
        if (selection.length === 0) {
          return
        }
        // Deliberately no capture boundary: the previous gesture closed
        // its entry, so held arrow keys coalesce into a single undo.
        const wanted = new Set(selection)
        const changes: BoardChange[] = elements
          .filter((element) => wanted.has(element.id))
          .map((element) => ({
            kind: 'update',
            id: element.id,
            props: { x: element.x + action.dx, y: element.y + action.dy },
          }))
        store.applyChanges(changes)
        const arrows = boundArrowUpdates(store.listElements(), wanted)
        if (arrows.length > 0) {
          store.applyChanges(arrows)
        }
        return
      }
    }
  }

  return {
    getActiveTool: () => activeToolType,
    setActiveTool,
    getSelectedIds: () => selection,
    setSelectedIds: (ids) => context.setSelection(ids),
    setDefaults: (patch) => {
      defaults = { ...defaults, ...patch }
    },
    pointerDown: (input) => {
      tools[activeToolType].onPointerDown(input, context)
      notify()
    },
    pointerMove: (input) => {
      tools[activeToolType].onPointerMove(input, context)
      notify()
    },
    pointerUp: (input) => {
      tools[activeToolType].onPointerUp(input, context)
      notify()
    },
    handleKey: (input) => {
      const action = resolveKeyboardAction(input)
      if (!action) {
        return false
      }
      execute(action)
      notify()
      return true
    },
    getSnapshot: () => {
      const elements = store.listElements()
      const bounds = selectionBounds(elements, selection)
      const overlay = tools[activeToolType].getOverlay?.() ?? {
        lasso: null,
        guides: [],
      }
      return {
        activeTool: activeToolType,
        selectedIds: [...selection],
        selectionBounds: bounds,
        handles:
          activeToolType === 'select' && bounds
            ? getHandles(bounds, options.getCamera().zoom)
            : [],
        lasso: overlay.lasso,
        guides: overlay.guides,
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    destroy: () => {
      tools[activeToolType].onCancel(context)
      unsubscribe()
      listeners.clear()
    },
  }
}
```

Add to `packages/engine/src/index.ts`:

```ts
export type {
  InteractionController,
  InteractionControllerOptions,
  InteractionSnapshot,
} from './interaction/controller'
export { createInteractionController } from './interaction/controller'
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `pnpm --filter @tlwb/engine test`
Expected: PASS, everything including the visual suite.

- [ ] **Step 5: Verify style and types, then commit**

```bash
pnpm check:write && pnpm typecheck
git add packages/engine/src/interaction packages/engine/test/interaction packages/engine/src/index.ts
git commit -m "✨ feat(engine): route interactions through a headless controller"
```

---

## Verification

After the last task, from the repository root:

- `pnpm check` passes (formatting, lint, import order).
- `pnpm typecheck` passes.
- `pnpm test` passes, including the visual suite untouched by this plan.
- `packages/engine` still depends only on `fractional-indexing`, `zod`, `roughjs`, `perfect-freehand` at runtime: `git diff main -- packages/engine/package.json` shows no dependency change.

## Out of Scope

Deferred to the next plans of the series: the `createEditor` public API
binding DOM events to the interaction controller, overlay painting
(selection box, handles, lasso, snap guides, remote cursors), in-canvas
text editing (the host owns the DOM editor; this plan only requests it),
PNG and SVG export, image upload and asset storage, multi-element
rotation, mirroring elements when a resize flips past zero, `store-yjs`
(whose `Y.UndoManager` must honor the capture-boundary contract added
here), the React client, and the collaboration server.

