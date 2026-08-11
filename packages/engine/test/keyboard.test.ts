import { describe, expect, it } from 'vitest'
import {
  type KeyboardAction,
  type KeyInput,
  resolveKeyboardAction,
} from '../src/keyboard'
import type { ToolType } from '../src/tools/types'

function key(partial: Partial<KeyInput> & { key: string }): KeyInput {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  }
}

describe('resolveKeyboardAction', () => {
  it('maps the numbered tool shortcuts in toolbar order', () => {
    expect(resolveKeyboardAction(key({ key: '1' }))).toEqual({
      kind: 'set-tool',
      tool: 'select',
    })
    expect(resolveKeyboardAction(key({ key: '2' }))).toEqual({
      kind: 'set-tool',
      tool: 'hand',
    })
    expect(resolveKeyboardAction(key({ key: '6' }))).toEqual({
      kind: 'set-tool',
      tool: 'arrow',
    })
    expect(resolveKeyboardAction(key({ key: '0' }))).toEqual({
      kind: 'set-tool',
      tool: 'image',
    })
    expect(resolveKeyboardAction(key({ key: 'e' }))).toEqual({
      kind: 'set-tool',
      tool: 'eraser',
    })
    expect(resolveKeyboardAction(key({ key: 'E' }))).toEqual({
      kind: 'set-tool',
      tool: 'eraser',
    })
  })

  it('maps editing keys', () => {
    expect(resolveKeyboardAction(key({ key: 'Escape' }))).toEqual({
      kind: 'cancel',
    })
    expect(resolveKeyboardAction(key({ key: 'Delete' }))).toEqual({
      kind: 'delete-selection',
    })
    expect(resolveKeyboardAction(key({ key: 'Backspace' }))).toEqual({
      kind: 'delete-selection',
    })
  })

  it('maps modifier combos on meta and on ctrl alike', () => {
    expect(resolveKeyboardAction(key({ key: 'z', metaKey: true }))).toEqual({
      kind: 'undo',
    })
    expect(
      resolveKeyboardAction(key({ key: 'z', ctrlKey: true, shiftKey: true })),
    ).toEqual({ kind: 'redo' })
    expect(resolveKeyboardAction(key({ key: 'a', metaKey: true }))).toEqual({
      kind: 'select-all',
    })
    expect(resolveKeyboardAction(key({ key: 'd', metaKey: true }))).toEqual({
      kind: 'duplicate-selection',
    })
    expect(resolveKeyboardAction(key({ key: 'g', metaKey: true }))).toEqual({
      kind: 'group-selection',
    })
    expect(
      resolveKeyboardAction(key({ key: 'g', metaKey: true, shiftKey: true })),
    ).toEqual({ kind: 'ungroup-selection' })
    expect(resolveKeyboardAction(key({ key: ']', metaKey: true }))).toEqual({
      kind: 'bring-forward',
    })
    expect(
      resolveKeyboardAction(key({ key: ']', metaKey: true, altKey: true })),
    ).toEqual({ kind: 'bring-to-front' })
    expect(resolveKeyboardAction(key({ key: '[', metaKey: true }))).toEqual({
      kind: 'send-backward',
    })
    expect(
      resolveKeyboardAction(key({ key: '[', metaKey: true, altKey: true })),
    ).toEqual({ kind: 'send-to-back' })
  })

  it('nudges with the arrows, larger with shift', () => {
    expect(resolveKeyboardAction(key({ key: 'ArrowLeft' }))).toEqual({
      kind: 'nudge',
      dx: -1,
      dy: 0,
    })
    expect(
      resolveKeyboardAction(key({ key: 'ArrowDown', shiftKey: true })),
    ).toEqual({ kind: 'nudge', dx: 0, dy: 10 })
  })

  it.each<[string, ToolType]>([
    ['1', 'select'],
    ['2', 'hand'],
    ['3', 'rectangle'],
    ['4', 'ellipse'],
    ['5', 'diamond'],
    ['6', 'arrow'],
    ['7', 'line'],
    ['8', 'draw'],
    ['9', 'text'],
    ['0', 'image'],
    ['e', 'eraser'],
  ])(
    'maps %s to the %s tool, pinning the full toolbar order',
    (pressedKey, tool) => {
      expect(resolveKeyboardAction(key({ key: pressedKey }))).toEqual({
        kind: 'set-tool',
        tool,
      })
    },
  )

  it.each<[string, boolean, boolean, KeyboardAction]>([
    ['a', false, false, { kind: 'select-all' }],
    ['d', false, false, { kind: 'duplicate-selection' }],
    ['g', false, false, { kind: 'group-selection' }],
    ['g', true, false, { kind: 'ungroup-selection' }],
    [']', false, false, { kind: 'bring-forward' }],
    [']', false, true, { kind: 'bring-to-front' }],
    ['[', false, false, { kind: 'send-backward' }],
    ['[', false, true, { kind: 'send-to-back' }],
  ])(
    'maps ctrl+%s (shift=%s, alt=%s) the same as its meta twin',
    (pressedKey, shiftKey, altKey, action) => {
      expect(
        resolveKeyboardAction(
          key({ key: pressedKey, ctrlKey: true, shiftKey, altKey }),
        ),
      ).toEqual(action)
    },
  )

  it.each<[string, boolean, KeyboardAction]>([
    ['ArrowRight', false, { kind: 'nudge', dx: 1, dy: 0 }],
    ['ArrowRight', true, { kind: 'nudge', dx: 10, dy: 0 }],
    ['ArrowUp', false, { kind: 'nudge', dx: 0, dy: -1 }],
    ['ArrowUp', true, { kind: 'nudge', dx: 0, dy: -10 }],
  ])('nudges with %s (shift=%s)', (pressedKey, shiftKey, action) => {
    expect(resolveKeyboardAction(key({ key: pressedKey, shiftKey }))).toEqual(
      action,
    )
  })

  it('leaves unknown keys to the browser', () => {
    expect(resolveKeyboardAction(key({ key: 'q' }))).toBeNull()
    expect(resolveKeyboardAction(key({ key: 'p', metaKey: true }))).toBeNull()
    expect(resolveKeyboardAction(key({ key: 'F5' }))).toBeNull()
  })
})
