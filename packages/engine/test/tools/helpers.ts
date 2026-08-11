import { type Camera, createCamera } from '../../src/camera'
import type { ElementId } from '../../src/model/element'
import { InMemoryBoardStore } from '../../src/store/memory'
import type {
  PendingImage,
  PointerInput,
  ToolContext,
  ToolType,
} from '../../src/tools/types'

export interface TestContext extends ToolContext {
  store: InMemoryBoardStore
  selection: ElementId[]
  activeTool: ToolType | null
  textEditRequests: ElementId[]
  pendingImage: PendingImage | null
  camera: Camera
}

/** ToolContext over a real InMemoryBoardStore, camera at origin, zoom 1. */
export function createTestContext(): TestContext {
  const context: TestContext = {
    store: new InMemoryBoardStore(),
    selection: [],
    activeTool: null,
    textEditRequests: [],
    pendingImage: null,
    camera: createCamera(),
    getCamera: () => context.camera,
    setCamera: (camera) => {
      context.camera = camera
    },
    getSelection: () => context.selection,
    setSelection: (ids) => {
      context.selection = ids
    },
    getDefaults: () => ({}),
    // Stub: records the requested tool but, unlike the real interaction
    // controller, never calls onCancel back on the outgoing tool. A test
    // that needs that callback loop must drive it explicitly.
    setActiveTool: (type) => {
      context.activeTool = type
    },
    requestTextEdit: (id) => {
      context.textEditRequests.push(id)
    },
    getPendingImage: () => context.pendingImage,
  }
  return context
}

/** With the camera at origin and zoom 1, world and screen coincide. */
export function pointer(
  x: number,
  y: number,
  modifiers: Partial<Pick<PointerInput, 'shiftKey' | 'altKey'>> = {},
): PointerInput {
  return {
    world: { x, y },
    screen: { x, y },
    shiftKey: false,
    altKey: false,
    ...modifiers,
  }
}
