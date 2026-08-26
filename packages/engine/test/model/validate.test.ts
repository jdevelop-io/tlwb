import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { ElementType } from '../../src/model/element'
import { validateElement } from '../../src/model/validate'

const types: ElementType[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'draw',
  'text',
  'image',
]

describe('validateElement', () => {
  it('accepts every element the factory produces', () => {
    for (const type of types) {
      expect(validateElement(createElement(type, { index: 'a0' }))).toBe(true)
    }
  })

  it('accepts variant properties with content', () => {
    expect(
      validateElement(
        createElement('arrow', {
          index: 'a0',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 5 },
          ],
          startBinding: { elementId: 'r1' },
          endBinding: null,
        }),
      ),
    ).toBe(true)
    expect(
      validateElement(
        createElement('text', {
          index: 'a0',
          text: 'hello',
          fontSize: 24,
          fontFamily: 'ui',
          textAlign: 'center',
          containerId: 'r1',
        }),
      ),
    ).toBe(true)
  })

  it('rejects a mistyped, missing, or non-finite property', () => {
    const good = createElement('rectangle', { index: 'a0' })
    expect(validateElement({ ...good, x: 'oops' })).toBe(false)
    expect(validateElement({ ...good, x: Number.NaN })).toBe(false)
    expect(validateElement({ ...good, strokeStyle: 'dotted' })).toBe(false)
    const { index: _index, ...missingIndex } = good
    expect(validateElement(missingIndex)).toBe(false)
  })

  it('rejects an unknown type, a variant missing its properties, and non-objects', () => {
    const good = createElement('rectangle', { index: 'a0' })
    expect(validateElement({ ...good, type: 'star' })).toBe(false)
    expect(validateElement({ ...good, type: 'line' })).toBe(false)
    expect(validateElement({ ...good, type: 'text' })).toBe(false)
    expect(validateElement(null)).toBe(false)
    expect(validateElement('rectangle')).toBe(false)
    expect(validateElement(undefined)).toBe(false)
  })

  it('accepts an asset hash only in the shape the asset route serves', () => {
    const image = createElement('image', { index: 'a0' })
    // The hash becomes a URL path segment in every collaborator's
    // browser, so the model must not admit what the route refuses.
    expect(validateElement(image)).toBe(true) // empty until the upload lands
    expect(validateElement({ ...image, assetHash: 'a'.repeat(64) })).toBe(true)
    expect(validateElement({ ...image, assetHash: 'A'.repeat(64) })).toBe(false)
    expect(validateElement({ ...image, assetHash: '../../boards' })).toBe(false)
    expect(validateElement({ ...image, assetHash: 'abc123' })).toBe(false)
  })

  it('rejects a non-finite point inside a stroke', () => {
    const line = createElement('line', {
      index: 'a0',
      points: [{ x: 0, y: Number.POSITIVE_INFINITY }],
    })
    expect(validateElement(line)).toBe(false)
  })
})
