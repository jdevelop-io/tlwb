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

  it('creates its own undo entry', () => {
    const context = createTestContext()
    context.pendingImage = { assetHash: 'abc123', width: 200, height: 100 }
    const tool = createImageTool()
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerUp(pointer(0, 0), context)
    context.store.undo()
    expect(context.store.listElements()).toEqual([])
    expect(context.store.canUndo()).toBe(false)
  })

  it('survives a controller whose setActiveTool re-enters onCancel', () => {
    const context = createTestContext()
    context.pendingImage = { assetHash: 'abc123', width: 200, height: 100 }
    const tool = createImageTool()
    // The real interaction controller calls onCancel on the outgoing
    // tool from inside setActiveTool. Reproduce that re-entrancy here so
    // that, if the tool ever grows gesture state, a handoff ordering bug
    // would be caught here rather than only by inspection.
    context.setActiveTool = (type) => {
      context.activeTool = type
      tool.onCancel(context)
    }
    tool.onPointerDown(pointer(300, 300), context)
    tool.onPointerUp(pointer(300, 300), context)
    const elements = context.store.listElements()
    expect(elements).toHaveLength(1)
    expect(context.selection).toEqual([elements[0]?.id])
  })
})
