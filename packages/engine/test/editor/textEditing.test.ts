import { describe, expect, it } from 'vitest'
import {
  commitTextChanges,
  createLabel,
  resolveDoubleClick,
} from '../../src/editor/textEditing'
import { createElement } from '../../src/model/create'
import type { TextSpec } from '../../src/render/text'

/** Ten units per character, one line of 25: predictable frames. */
const measure = (spec: TextSpec) => {
  const lines = spec.text.split('\n')
  return {
    width: Math.max(...lines.map((line) => line.length)) * 10,
    height: lines.length * 25,
  }
}

const shape = createElement('rectangle', {
  id: 'shape',
  index: 'a0',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
})
const label = createElement('text', {
  id: 'label',
  index: 'a1',
  x: 90,
  y: 37.5,
  width: 20,
  height: 25,
  text: 'ab',
  containerId: 'shape',
})
const loose = createElement('text', {
  id: 'loose',
  index: 'a2',
  x: 400,
  y: 400,
  width: 50,
  height: 25,
  text: 'hello',
})
const line = createElement('line', {
  id: 'line',
  index: 'a3',
  x: 600,
  y: 0,
  width: 100,
  height: 0,
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
})

describe('resolveDoubleClick', () => {
  it('edits a text element under the point', () => {
    expect(
      resolveDoubleClick([shape, label, loose, line], { x: 420, y: 410 }, 4),
    ).toEqual({ kind: 'edit', id: 'loose' })
  })

  it('labels a shape without one, and edits the label it has', () => {
    expect(resolveDoubleClick([shape], { x: 20, y: 20 }, 4)).toEqual({
      kind: 'label',
      containerId: 'shape',
    })
    expect(resolveDoubleClick([shape, label], { x: 20, y: 20 }, 4)).toEqual({
      kind: 'edit',
      id: 'label',
    })
  })

  it('creates a text on empty canvas and nothing on other elements', () => {
    expect(resolveDoubleClick([shape, line], { x: 300, y: 300 }, 4)).toEqual({
      kind: 'create',
    })
    expect(resolveDoubleClick([shape, line], { x: 650, y: 0 }, 4)).toEqual({
      kind: 'none',
    })
  })
})

describe('commitTextChanges', () => {
  it('writes the text and the measured size', () => {
    expect(commitTextChanges([loose], 'loose', 'hi\nthere', measure)).toEqual([
      {
        kind: 'update',
        id: 'loose',
        props: { text: 'hi\nthere', width: 50, height: 50 },
      },
    ])
  })

  it('recenters a label in its container', () => {
    expect(commitTextChanges([shape, label], 'label', 'abcd', measure)).toEqual(
      [
        {
          kind: 'update',
          id: 'label',
          props: {
            text: 'abcd',
            width: 40,
            height: 25,
            x: 80,
            y: 37.5,
            angle: 0,
          },
        },
      ],
    )
  })

  it('deletes an element committed empty and ignores unknown ids', () => {
    expect(commitTextChanges([loose], 'loose', '  \n ', measure)).toEqual([
      { kind: 'delete', id: 'loose' },
    ])
    expect(commitTextChanges([shape], 'shape', 'x', measure)).toEqual([])
    expect(commitTextChanges([], 'missing', 'x', measure)).toEqual([])
  })
})

describe('createLabel', () => {
  it('centers an empty, center-aligned text in the container', () => {
    const created = createLabel(
      shape,
      'a9',
      { strokeColor: '#123456', fontSize: 30 },
      measure,
    )
    expect(created).toMatchObject({
      type: 'text',
      index: 'a9',
      text: '',
      containerId: 'shape',
      textAlign: 'center',
      fontSize: 30,
      strokeColor: '#123456',
      width: 0,
      height: 25,
      x: 100,
      y: 37.5,
      angle: 0,
    })
  })
})
