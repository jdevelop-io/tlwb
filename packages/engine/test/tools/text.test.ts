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

  it('survives a controller whose setActiveTool re-enters onCancel', () => {
    const context = createTestContext()
    const tool = createTextTool()
    // The real interaction controller calls onCancel on the outgoing
    // tool from inside setActiveTool. Reproduce that re-entrancy here so
    // that, if the tool ever grows gesture state, a handoff ordering bug
    // would be caught here rather than only by inspection.
    context.setActiveTool = (type) => {
      context.activeTool = type
      tool.onCancel(context)
    }
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerUp(pointer(0, 0), context)
    const elements = context.store.listElements()
    expect(elements).toHaveLength(1)
    expect(context.selection).toEqual([elements[0]?.id])
  })
})
