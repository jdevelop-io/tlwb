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

  it('creates a dot on a plain click', () => {
    // Decision, not an oversight: the shape and linear tools discard a
    // gesture that never crosses the drag threshold, the draw tool does
    // not. A click leaves a one-point, zero-size element, which is a dot.
    const context = createTestContext()
    const tool = createDrawTool()
    tool.onPointerDown(pointer(40, 40), context)
    tool.onPointerUp(pointer(40, 40), context)
    const [element] = context.store.listElements() as [DrawElement]
    expect(element).toMatchObject({ x: 40, y: 40, width: 0, height: 0 })
    expect(element.points).toEqual([{ x: 0, y: 0 }])
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
