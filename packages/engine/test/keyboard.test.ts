import { describe, expect, it } from 'vitest'
import { type KeyInput, resolveKeyboardAction } from '../src/keyboard'

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

  it('leaves unknown keys to the browser', () => {
    expect(resolveKeyboardAction(key({ key: 'q' }))).toBeNull()
    expect(resolveKeyboardAction(key({ key: 'p', metaKey: true }))).toBeNull()
    expect(resolveKeyboardAction(key({ key: 'F5' }))).toBeNull()
  })
})
