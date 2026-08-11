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
