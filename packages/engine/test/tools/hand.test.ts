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
