import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'

describe('createElement', () => {
  it('creates a rectangle with base defaults', () => {
    const element = createElement('rectangle', { index: 'a0' })
    expect(element.type).toBe('rectangle')
    expect(element.x).toBe(0)
    expect(element.y).toBe(0)
    expect(element.strokeColor).toBe('#1A1A1A')
    expect(element.fillColor).toBeNull()
    expect(element.strokeWidth).toBe(2)
    expect(element.strokeStyle).toBe('solid')
    expect(element.sketchiness).toBe(1)
    expect(element.opacity).toBe(1)
    expect(element.angle).toBe(0)
    expect(element.groupId).toBeNull()
    expect(element.index).toBe('a0')
    expect(typeof element.seed).toBe('number')
    expect(element.id).not.toHaveLength(0)
  })

  it('applies overrides on top of defaults', () => {
    const element = createElement('rectangle', {
      index: 'a0',
      x: 10,
      y: 20,
      width: 120,
      height: 80,
    })
    expect(element.x).toBe(10)
    expect(element.width).toBe(120)
  })

  it('creates a text element with handwriting defaults', () => {
    const element = createElement('text', { index: 'a0', text: 'hello' })
    if (element.type !== 'text') throw new Error('expected a text element')
    expect(element.text).toBe('hello')
    expect(element.fontSize).toBe(20)
    expect(element.fontFamily).toBe('hand')
    expect(element.textAlign).toBe('left')
    expect(element.containerId).toBeNull()
  })

  it('creates an arrow with empty points and no bindings', () => {
    const element = createElement('arrow', { index: 'a0' })
    if (element.type !== 'arrow') throw new Error('expected an arrow element')
    expect(element.points).toEqual([])
    expect(element.startBinding).toBeNull()
    expect(element.endBinding).toBeNull()
  })

  it('gives each element a unique id', () => {
    const a = createElement('rectangle', { index: 'a0' })
    const b = createElement('rectangle', { index: 'a1' })
    expect(a.id).not.toBe(b.id)
  })
})
