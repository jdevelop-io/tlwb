import { describe, expect, it } from 'vitest'
import { type Camera, createCamera } from '../../src/camera'
import {
  createInteractionController,
  type InteractionController,
} from '../../src/interaction/controller'
import type { KeyInput } from '../../src/keyboard'
import { createElement } from '../../src/model/create'
import { InMemoryBoardStore } from '../../src/store/memory'
import type { PointerInput } from '../../src/tools/types'

function setup(): {
  store: InMemoryBoardStore
  controller: InteractionController
} {
  const store = new InMemoryBoardStore()
  let camera: Camera = createCamera()
  const controller = createInteractionController({
    store,
    getCamera: () => camera,
    setCamera: (next) => {
      camera = next
    },
  })
  return { store, controller }
}

function down(controller: InteractionController, x: number, y: number): void {
  controller.pointerDown(input(x, y))
}

function input(x: number, y: number): PointerInput {
  return {
    world: { x, y },
    screen: { x, y },
    shiftKey: false,
    altKey: false,
  }
}

function key(partial: Partial<KeyInput> & { key: string }): KeyInput {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  }
}

describe('interaction controller', () => {
  it('draws a rectangle end to end and falls back to select', () => {
    const { store, controller } = setup()
    expect(controller.handleKey(key({ key: '3' }))).toBe(true)
    expect(controller.getActiveTool()).toBe('rectangle')
    down(controller, 10, 10)
    controller.pointerMove(input(110, 60))
    controller.pointerUp(input(110, 60))
    const [element] = store.listElements()
    expect(element).toMatchObject({ type: 'rectangle', width: 100, height: 50 })
    expect(controller.getActiveTool()).toBe('select')
    expect(controller.getSelectedIds()).toEqual([element?.id])
  })

  it('draws an arrow end to end through the linear tool and falls back to select', () => {
    // Same end-to-end shape as the rectangle case above, but through the
    // linear tool: the real controller's setActiveTool re-enters onCancel
    // on the still-active 'arrow' tool from inside its own onPointerUp,
    // exactly the reentrancy tasks 8 and 9 fixed. Driving it through the
    // real controller (rather than the hand-rolled fake context the tool
    // suites use) pins that the fix survives the actual wiring.
    const { store, controller } = setup()
    expect(controller.handleKey(key({ key: '6' }))).toBe(true)
    expect(controller.getActiveTool()).toBe('arrow')
    down(controller, 0, 0)
    controller.pointerMove(input(100, 50))
    controller.pointerUp(input(100, 50))
    const [element] = store.listElements()
    expect(element).toMatchObject({ type: 'arrow' })
    expect(controller.getActiveTool()).toBe('select')
    expect(controller.getSelectedIds()).toEqual([element?.id])
  })

  it('reports handles and bounds in the snapshot for the select tool', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: '#FFD8CF',
    })
    store.applyChanges([{ kind: 'create', element: shape }])
    controller.setSelectedIds([shape.id])
    const snapshot = controller.getSnapshot()
    expect(snapshot.activeTool).toBe('select')
    expect(snapshot.selectionBounds).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(snapshot.handles).toHaveLength(9)
    expect(snapshot.lasso).toBeNull()
  })

  it('returns the same snapshot object when nothing changed since the last call', () => {
    // A host repaints by diffing snapshots. If getSnapshot() allocated a
    // fresh object every call, reference-equality diffing could never
    // short-circuit, defeating that use case.
    const { store, controller } = setup()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
    })
    store.applyChanges([{ kind: 'create', element: shape }])
    controller.setSelectedIds([shape.id])
    const first = controller.getSnapshot()
    const second = controller.getSnapshot()
    expect(second).toBe(first)
    controller.setSelectedIds([])
    const third = controller.getSnapshot()
    expect(third).not.toBe(first)
    const fourth = controller.getSnapshot()
    expect(fourth).toBe(third)
  })

  it('executes delete, duplicate, and undo from the keyboard', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    store.applyChanges([{ kind: 'create', element: shape }])
    store.stopCapturing()
    controller.setSelectedIds([shape.id])
    expect(controller.handleKey(key({ key: 'd', metaKey: true }))).toBe(true)
    expect(store.listElements()).toHaveLength(2)
    const cloneId = controller.getSelectedIds()[0]
    expect(cloneId).not.toBe(shape.id)
    expect(store.getElement(cloneId ?? '')).toMatchObject({ x: 10, y: 10 })
    expect(controller.handleKey(key({ key: 'Delete' }))).toBe(true)
    expect(store.listElements()).toHaveLength(1)
    expect(controller.getSelectedIds()).toEqual([])
    expect(controller.handleKey(key({ key: 'z', metaKey: true }))).toBe(true)
    expect(store.listElements()).toHaveLength(2)
  })

  it('nudges the selection and coalesces held arrows into one undo entry', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    store.applyChanges([{ kind: 'create', element: shape }])
    store.stopCapturing()
    controller.setSelectedIds([shape.id])
    controller.handleKey(key({ key: 'ArrowRight' }))
    controller.handleKey(key({ key: 'ArrowRight' }))
    controller.handleKey(key({ key: 'ArrowDown', shiftKey: true }))
    expect(store.getElement(shape.id)).toMatchObject({ x: 2, y: 10 })
    store.undo()
    expect(store.getElement(shape.id)).toMatchObject({ x: 0, y: 0 })
  })

  it('prunes the selection when elements disappear remotely', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', { index: 'a0' })
    store.applyChanges([{ kind: 'create', element: shape }])
    controller.setSelectedIds([shape.id])
    store.applyChanges([{ kind: 'delete', id: shape.id }], 'remote')
    expect(controller.getSelectedIds()).toEqual([])
  })

  it('cancels the gesture and clears the selection on Escape', () => {
    const { store, controller } = setup()
    const shape = createElement('rectangle', {
      index: 'a0',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: '#FFD8CF',
    })
    store.applyChanges([{ kind: 'create', element: shape }])
    store.stopCapturing()
    down(controller, 25, 25)
    controller.pointerMove(input(300, 300))
    expect(controller.handleKey(key({ key: 'Escape' }))).toBe(true)
    expect(store.getElement(shape.id)).toMatchObject({ x: 0, y: 0 })
    expect(controller.getSelectedIds()).toEqual([])
  })

  it('applies setDefaults to newly created elements', () => {
    const { store, controller } = setup()
    controller.setDefaults({ strokeColor: '#FF6B4A' })
    controller.handleKey(key({ key: '3' }))
    down(controller, 0, 0)
    controller.pointerMove(input(50, 50))
    controller.pointerUp(input(50, 50))
    expect(store.listElements()[0]?.strokeColor).toBe('#FF6B4A')
  })

  it('notifies subscribers and stops after destroy', () => {
    const { store, controller } = setup()
    let calls = 0
    const unsubscribe = controller.subscribe(() => {
      calls += 1
    })
    controller.handleKey(key({ key: '2' }))
    expect(calls).toBeGreaterThan(0)
    unsubscribe()
    const before = calls
    controller.handleKey(key({ key: '1' }))
    expect(calls).toBe(before)

    // Ruling (overrides the brief): the brief's original assertion here
    // could not fail, since it never populates the selection before
    // destroying, so pruning has nothing to prune either way. Populate
    // the selection first, then destroy, then delete the element through
    // a remote batch: only a controller that actually unsubscribed from
    // the store on destroy() will fail to prune it.
    const shape = createElement('rectangle', { index: 'a0' })
    store.applyChanges([{ kind: 'create', element: shape }])
    controller.setSelectedIds([shape.id])
    controller.destroy()
    store.applyChanges([{ kind: 'delete', id: shape.id }], 'remote')
    // The controller no longer listens, so it no longer prunes.
    expect(controller.getSelectedIds()).toEqual([shape.id])
  })
})
