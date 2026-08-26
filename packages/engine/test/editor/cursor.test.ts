import { describe, expect, it } from 'vitest'
import { type CursorContext, cursorFor } from '../../src/editor/cursor'

const base: CursorContext = {
  tool: 'select',
  gesture: 'idle',
  panning: false,
  panReady: false,
  pressed: false,
  handle: null,
  overSelected: false,
  angle: 0,
}

describe('cursorFor', () => {
  it('shows a hand while panning, whatever the tool', () => {
    expect(cursorFor({ ...base, tool: 'rectangle', panning: true })).toBe(
      'grabbing',
    )
    expect(cursorFor({ ...base, panReady: true })).toBe('grab')
    expect(cursorFor({ ...base, tool: 'hand' })).toBe('grab')
    expect(cursorFor({ ...base, tool: 'hand', pressed: true })).toBe('grabbing')
  })

  it('uses a crosshair for every creation tool', () => {
    for (const tool of [
      'rectangle',
      'ellipse',
      'diamond',
      'arrow',
      'line',
      'draw',
      'text',
      'image',
      'eraser',
    ] as const) {
      expect(cursorFor({ ...base, tool })).toBe('crosshair')
    }
  })

  it('maps resize handles to directional cursors, rotated with the selection', () => {
    expect(cursorFor({ ...base, handle: 'n' })).toBe('ns-resize')
    expect(cursorFor({ ...base, handle: 'e' })).toBe('ew-resize')
    expect(cursorFor({ ...base, handle: 'ne' })).toBe('nesw-resize')
    expect(cursorFor({ ...base, handle: 'se' })).toBe('nwse-resize')
    expect(cursorFor({ ...base, handle: 'n', angle: Math.PI / 2 })).toBe(
      'ew-resize',
    )
    expect(cursorFor({ ...base, handle: 'sw', angle: -Math.PI / 4 })).toBe(
      'ns-resize',
    )
    expect(cursorFor({ ...base, handle: 'rotate' })).toBe('grab')
  })

  it('shows move over a selected element or during a move, default otherwise', () => {
    expect(cursorFor({ ...base, overSelected: true })).toBe('move')
    expect(cursorFor({ ...base, gesture: 'moving' })).toBe('move')
    expect(cursorFor(base)).toBe('default')
  })
})
