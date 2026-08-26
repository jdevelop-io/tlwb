import {
  createElement,
  exportSnapshot,
  importSnapshot,
  parseSnapshot,
} from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createYjsBoardStore } from '../src/store'

describe('JSON projection through the Yjs store', () => {
  it('exports, parses, and re-imports the same board', () => {
    const source = createYjsBoardStore(new Y.Doc())
    source.setMeta({ name: 'payments', createdAt: 1_700_000_000_000 })
    source.applyChanges([
      { kind: 'create', element: createElement('rectangle', { index: 'a0' }) },
      {
        kind: 'create',
        element: createElement('text', { index: 'a1', text: 'hello' }),
      },
    ])

    const json = JSON.parse(JSON.stringify(exportSnapshot(source)))
    const snapshot = parseSnapshot(json)

    const target = createYjsBoardStore(new Y.Doc())
    target.applyChanges([
      { kind: 'create', element: createElement('ellipse', { index: 'a0' }) },
    ])
    importSnapshot(target, snapshot)

    expect(exportSnapshot(target)).toEqual(exportSnapshot(source))
    expect(target.canUndo()).toBe(false)
  })
})
