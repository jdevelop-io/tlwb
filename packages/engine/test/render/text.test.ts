import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { TextElement } from '../../src/model/element'
import {
  DEFAULT_FONTS,
  fontString,
  textAnchorX,
  textLines,
} from '../../src/render/text'

function text(overrides = {}): TextElement {
  return createElement('text', {
    id: 'text-1',
    index: 'a0',
    width: 200,
    height: 50,
    text: 'hello',
    fontSize: 20,
    ...overrides,
  }) as TextElement
}

describe('fontString', () => {
  it('uses the handwriting family by default', () => {
    expect(fontString(text(), DEFAULT_FONTS)).toBe('20px Caveat, cursive')
  })

  it('uses the ui family when the element asks for it', () => {
    expect(fontString(text({ fontFamily: 'ui' }), DEFAULT_FONTS)).toBe(
      '20px system-ui, sans-serif',
    )
  })
})

describe('textLines', () => {
  it('splits on newlines without wrapping', () => {
    expect(textLines(text({ text: 'one\ntwo\n' }))).toEqual(['one', 'two', ''])
  })
})

describe('textAnchorX', () => {
  it('anchors left, center, and right inside the frame', () => {
    expect(textAnchorX(text({ textAlign: 'left' }))).toBe(0)
    expect(textAnchorX(text({ textAlign: 'center' }))).toBe(100)
    expect(textAnchorX(text({ textAlign: 'right' }))).toBe(200)
  })
})
