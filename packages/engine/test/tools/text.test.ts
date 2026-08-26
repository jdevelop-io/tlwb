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

  it('closes its own undo entry when the host declines the capture', () => {
    const context = createTestContext()
    const tool = createTextTool()
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerUp(pointer(0, 0), context)
    const id = context.store.listElements()[0]?.id ?? ''
    context.store.applyChanges([{ kind: 'update', id, props: { x: 10 } }])
    // The later write opened its own entry, so it undoes on its own.
    context.store.undo()
    expect(context.store.getElement(id)).toMatchObject({ x: 0 })
    context.store.undo()
    expect(context.store.listElements()).toEqual([])
    expect(context.store.canUndo()).toBe(false)
  })

  it('leaves its undo entry open when the host takes the capture', () => {
    const context = createTestContext()
    context.requestTextEdit = (requested) => {
      context.textEditRequests.push(requested)
      return true
    }
    const tool = createTextTool()
    tool.onPointerDown(pointer(0, 0), context)
    tool.onPointerUp(pointer(0, 0), context)
    const id = context.store.listElements()[0]?.id ?? ''
    // What the host's first commitText does: it joins the creation.
    context.store.applyChanges([{ kind: 'update', id, props: { x: 10 } }])
    context.store.undo()
    expect(context.store.listElements()).toEqual([])
  })

  it('has nothing left to lose from a controller whose setActiveTool re-enters onCancel', () => {
    const context = createTestContext()
    const tool = createTextTool()
    // This tool keeps no gesture state across calls (onPointerDown is a
    // no-op) and its onCancel is unconditionally empty, so this test
    // cannot currently fail: the assertions below hold whether onCancel
    // runs or not. It exists as a tripwire for the day this tool grows
    // closure state that onCancel acts on (the way shape.ts's `id`
    // does) - at that point a misordered handoff would start deleting
    // the element this gesture just created, and this test would start
    // catching it.
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
