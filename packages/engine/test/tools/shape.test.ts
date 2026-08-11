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

  it('survives a controller whose setActiveTool re-enters onCancel', () => {
    const context = createTestContext()
    const tool = createShapeTool('rectangle')
    // The real interaction controller calls onCancel on the outgoing
    // tool from inside setActiveTool. Reproduce that re-entrancy here so
    // the gesture-state-before-handoff ordering in onPointerUp is
    // pinned by a test, not just by inspection.
    context.setActiveTool = (type) => {
      context.activeTool = type
      tool.onCancel(context)
    }
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerMove(pointer(50, 50), context)
    tool.onPointerUp(pointer(50, 50), context)
    const [element] = context.store.listElements()
    expect(element).toBeDefined()
    expect(context.selection).toEqual([element?.id])
  })
})
