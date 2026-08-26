import type { Editor, EditorState } from '@tlwb/engine'
import { vi } from 'vitest'

export function fakeEditor(overrides: Partial<EditorState> = {}) {
  let state: EditorState = {
    activeTool: 'select',
    selectedIds: [],
    camera: { x: 0, y: 0, zoom: 1 },
    gesture: 'idle',
    readOnly: false,
    canUndo: false,
    canRedo: false,
    ...overrides,
  }
  const listeners = new Set<() => void>()
  const editor = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setActiveTool: vi.fn((tool) => {
      state = { ...state, activeTool: tool }
      for (const l of listeners) l()
    }),
    setSelectedIds: vi.fn(),
    setDefaults: vi.fn(),
    setReadOnly: vi.fn(),
    execute: vi.fn(),
    updateSelection: vi.fn(),
    commitText: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setCamera: vi.fn(),
    zoomTo: vi.fn(),
    zoomToFit: vi.fn(),
    worldToScreen: vi.fn((p) => p),
    screenToWorld: vi.fn((p) => p),
    getElementScreenRect: vi.fn(() => null),
    setPresence: vi.fn(),
    exportPng: vi.fn(),
    exportSvg: vi.fn(() => '<svg/>'),
    destroy: vi.fn(),
  } as unknown as Editor
  return editor
}
