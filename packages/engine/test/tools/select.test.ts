import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { ArrowElement, BoardElement } from '../../src/model/element'
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

  it('does not undo prior history when a session is canceled before any write', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    seed(shape)
    // A completed move: one closed undo entry.
    tool.onPointerDown(pointer(50, 50), context)
    tool.onPointerMove(pointer(250, 50), context)
    tool.onPointerUp(pointer(250, 50), context)
    expect(context.store.getElement(shape.id)).toMatchObject({ x: 200 })

    // Press the se handle but cancel before moving it: the session never
    // applied a batch, so canceling it must not reach past its own
    // (never-opened) entry into the move above.
    tool.onPointerDown(pointer(300, 100), context)
    tool.onCancel(context)
    expect(context.store.getElement(shape.id)).toMatchObject({
      x: 200,
      width: 100,
    })

    context.store.undo()
    expect(context.store.getElement(shape.id)).toMatchObject({ x: 0 })
  })

  it('leaves the rotate handle inert on a multi-selection and falls through to empty canvas', () => {
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
    seed(a, b)
    context.selection = [a.id, b.id]
    // Selection bounds span x:0-150, y:0-50; the rotate handle for that
    // box sits at its horizontal midpoint, 24 world units above it, with
    // nothing else there to hit.
    tool.onPointerDown(pointer(75, -24), context)
    tool.onPointerUp(pointer(75, -24), context)
    expect(context.selection).toEqual([])
    expect(context.store.getElement(a.id)).toMatchObject({ angle: 0 })
    expect(context.store.getElement(b.id)).toMatchObject({ angle: 0 })
  })

  it('duplicates in place on an alt-click with no drag, as one undo entry', () => {
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
    tool.onPointerUp(pointer(25, 25, { altKey: true }), context)
    const elements = context.store.listElements()
    expect(elements).toHaveLength(2)
    const clone = elements.find((element) => element.id !== shape.id)
    expect(clone).toMatchObject({ x: 0, y: 0 })
    context.store.undo()
    expect(context.store.listElements()).toHaveLength(1)
  })

  it('does not let a moving selection snap to its own trailing bound arrow', () => {
    const dragged = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    // The tail touches `dragged`'s right edge; the head is a free,
    // unbound point, so only the tail follows as `dragged` moves.
    const arrow = createElement('arrow', {
      index: 'a1',
      x: 100,
      y: 50,
      width: 150,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 150, y: 0 },
      ],
      startBinding: { elementId: dragged.id },
      endBinding: null,
    })
    seed(dragged, arrow)
    tool.onPointerDown(pointer(50, 50), context)
    // A slow, ten-frame drag with small per-frame increments: if the
    // snap targets were rebuilt from live state each frame, the arrow
    // re-anchored onto `dragged` by the previous frame's batch would
    // read back as a target sitting almost exactly where `dragged`
    // already is, snapping the selection to itself and dragging it
    // behind the pointer in small increments instead of tracking it
    // exactly.
    let x = 50
    for (let i = 0; i < 10; i += 1) {
      x += 4
      tool.onPointerMove(pointer(x, 50), context)
    }
    tool.onPointerUp(pointer(x, 50), context)
    // Raw pointer travel is 40; the frozen pre-gesture snap targets do
    // not include the arrow's drifting position, so nothing captures
    // the drag short of that.
    expect(context.store.getElement(dragged.id)).toMatchObject({ x: 40 })
  })

  it('does not write an empty undo entry for a sub-threshold click', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    seed(shape)
    context.store.clearHistory()
    tool.onPointerDown(pointer(25, 25), context)
    // One world unit, under DRAG_THRESHOLD (2 CSS pixels at zoom 1).
    tool.onPointerMove(pointer(26, 25), context)
    tool.onPointerUp(pointer(26, 25), context)
    expect(context.store.getElement(shape.id)).toMatchObject({ x: 0, y: 0 })
    expect(context.store.canUndo()).toBe(false)
  })

  it('does not write an empty undo entry for a sub-threshold resize handle press', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    seed(shape)
    context.store.clearHistory()
    context.selection = [shape.id]
    // Press the se handle and twitch under DRAG_THRESHOLD. Without the
    // guard this writes a batch whose props barely differ from the
    // stored ones, and since the inverse batch is built from the written
    // keys rather than from their values, it opens a full undo entry the
    // user cannot see the effect of.
    tool.onPointerDown(pointer(100, 100), context)
    tool.onPointerMove(pointer(101, 100), context)
    tool.onPointerUp(pointer(101, 100), context)
    expect(context.store.getElement(shape.id)).toMatchObject({
      width: 100,
      height: 100,
    })
    expect(context.store.canUndo()).toBe(false)
  })

  it('does not write an empty undo entry for a sub-threshold rotate handle press', () => {
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    seed(shape)
    context.store.clearHistory()
    context.selection = [shape.id]
    // Rotate handle sits at (50, -24) for zoom 1.
    tool.onPointerDown(pointer(50, -24), context)
    tool.onPointerMove(pointer(51, -24), context)
    tool.onPointerUp(pointer(51, -24), context)
    expect(context.store.getElement(shape.id)).toMatchObject({ angle: 0 })
    expect(context.store.canUndo()).toBe(false)
  })

  it('resizes a horizontal line via a corner handle with no vertical delta', () => {
    const line = createElement('line', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    })
    seed(line)
    context.selection = [line.id]
    // A flat line's selection box has zero height, so at each endpoint
    // its corner and side handles coincide; the corner handle wins the
    // hit test (corners are listed first in `getHandles`). Dragging it
    // with no vertical delta only changes width, so height stays
    // exactly 0 throughout: the degenerate-rect guard must not treat
    // that as a rejected resize.
    tool.onPointerDown(pointer(100, 0), context)
    tool.onPointerMove(pointer(150, 0), context)
    tool.onPointerUp(pointer(150, 0), context)
    expect(context.store.getElement(line.id)).toMatchObject({
      x: 0,
      y: 0,
      width: 150,
      height: 0,
    })
  })
})
