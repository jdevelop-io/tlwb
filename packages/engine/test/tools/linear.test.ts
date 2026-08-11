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
    const start = {
      x: arrow.x + (arrow.points[0]?.x ?? 0),
      y: arrow.y + (arrow.points[0]?.y ?? 0),
    }
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

  it('survives a controller whose setActiveTool re-enters onCancel', () => {
    const context = createTestContext()
    const tool = createLinearTool('line')
    // The real interaction controller calls onCancel on the outgoing
    // tool from inside setActiveTool. Reproduce that re-entrancy here so
    // the gesture-state-before-handoff ordering in onPointerUp is pinned
    // by a test, not just by inspection. An assertion on the selection
    // alone would not discriminate: both orderings call setSelection
    // first. Asserting on what the store still holds is what does.
    context.setActiveTool = (type) => {
      context.activeTool = type
      tool.onCancel(context)
    }
    tool.onPointerDown(pointer(10, 10), context)
    tool.onPointerMove(pointer(110, 60), context)
    tool.onPointerUp(pointer(110, 60), context)
    const [element] = context.store.listElements() as [LineElement]
    expect(element).toBeDefined()
    expect(context.selection).toEqual([element.id])
  })
})
