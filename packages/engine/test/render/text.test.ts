import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { TextElement } from '../../src/model/element'
import {
  DEFAULT_FONTS,
  fontString,
  LINE_HEIGHT,
  measureText,
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

const FONTS = { hand: 'Caveat', ui: 'Caveat' }
const ctx = createCanvas(1, 1).getContext(
  '2d',
) as unknown as CanvasRenderingContext2D

describe('measureText', () => {
  it('measures the widest line and counts lines into the height', () => {
    const one = measureText(
      { text: 'hi', fontSize: 20, fontFamily: 'hand' },
      FONTS,
      ctx,
    )
    const two = measureText(
      { text: 'hi\nhello there', fontSize: 20, fontFamily: 'hand' },
      FONTS,
      ctx,
    )
    expect(one.width).toBeGreaterThan(0)
    expect(one.height).toBe(20 * LINE_HEIGHT)
    expect(two.width).toBeGreaterThan(one.width)
    expect(two.height).toBe(2 * 20 * LINE_HEIGHT)
  })

  it('gives an empty text a zero width and one line of height', () => {
    expect(
      measureText({ text: '', fontSize: 16, fontFamily: 'ui' }, FONTS, ctx),
    ).toEqual({ width: 0, height: 16 * LINE_HEIGHT })
  })

  it('scales with the font size', () => {
    const small = measureText(
      { text: 'scale', fontSize: 10, fontFamily: 'hand' },
      FONTS,
      ctx,
    )
    const large = measureText(
      { text: 'scale', fontSize: 40, fontFamily: 'hand' },
      FONTS,
      ctx,
    )
    expect(large.width).toBeCloseTo(small.width * 4, 0)
  })
})
