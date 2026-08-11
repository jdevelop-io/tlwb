import type { ToolType } from './tools/types'

/** The relevant subset of KeyboardEvent, so hosts forward events as-is. */
export interface KeyInput {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export type KeyboardAction =
  | { kind: 'set-tool'; tool: ToolType }
  | { kind: 'cancel' }
  | { kind: 'delete-selection' }
  | { kind: 'duplicate-selection' }
  | { kind: 'group-selection' }
  | { kind: 'ungroup-selection' }
  | { kind: 'select-all' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'bring-to-front' }
  | { kind: 'send-to-back' }
  | { kind: 'bring-forward' }
  | { kind: 'send-backward' }

/** Toolbar order fixed by the Paper artboards. */
const TOOL_KEYS: Record<string, ToolType> = {
  '1': 'select',
  '2': 'hand',
  '3': 'rectangle',
  '4': 'ellipse',
  '5': 'diamond',
  '6': 'arrow',
  '7': 'line',
  '8': 'draw',
  '9': 'text',
  '0': 'image',
  e: 'eraser',
}

const NUDGE_STEP = 1
const NUDGE_STEP_LARGE = 10

/**
 * Pure keyboard resolution: null means "not ours, let the browser have
 * it". The host decides when to call it (not while a text input has
 * focus) and preventDefaults when an action comes back.
 */
export function resolveKeyboardAction(input: KeyInput): KeyboardAction | null {
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
  const mod = input.metaKey || input.ctrlKey
  if (mod) {
    switch (key) {
      case 'z':
        return input.shiftKey ? { kind: 'redo' } : { kind: 'undo' }
      case 'a':
        return { kind: 'select-all' }
      case 'd':
        return { kind: 'duplicate-selection' }
      case 'g':
        return input.shiftKey
          ? { kind: 'ungroup-selection' }
          : { kind: 'group-selection' }
      case ']':
        return input.altKey
          ? { kind: 'bring-to-front' }
          : { kind: 'bring-forward' }
      case '[':
        return input.altKey
          ? { kind: 'send-to-back' }
          : { kind: 'send-backward' }
      default:
        return null
    }
  }
  const step = input.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP
  switch (key) {
    case 'Escape':
      return { kind: 'cancel' }
    case 'Delete':
    case 'Backspace':
      return { kind: 'delete-selection' }
    case 'ArrowLeft':
      return { kind: 'nudge', dx: -step, dy: 0 }
    case 'ArrowRight':
      return { kind: 'nudge', dx: step, dy: 0 }
    case 'ArrowUp':
      return { kind: 'nudge', dx: 0, dy: -step }
    case 'ArrowDown':
      return { kind: 'nudge', dx: 0, dy: step }
    default: {
      const tool = TOOL_KEYS[key]
      return tool ? { kind: 'set-tool', tool } : null
    }
  }
}
