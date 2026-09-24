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

  it('reports the elements the drag has touched until it ends', () => {
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
    expect(tool.getOverlay?.().erasing).toEqual([])
    tool.onPointerDown(pointer(25, 25), context)
    expect(tool.getOverlay?.().erasing).toEqual([a.id])
    tool.onCancel(context)
    expect(tool.getOverlay?.().erasing).toEqual([])
    tool.onPointerDown(pointer(25, 25), context)
    tool.onPointerUp(pointer(25, 25), context)
    expect(tool.getOverlay?.().erasing).toEqual([])
  })
})
