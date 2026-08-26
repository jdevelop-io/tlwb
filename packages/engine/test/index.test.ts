import { describe, expect, it } from 'vitest'
import * as engine from '../src/index'

/**
 * A host that binds its own DOM instead of calling createEditor gets the
 * headless controller, the two painters, and the pieces it cannot write
 * itself. The editor's own helpers stay private: they only work inside
 * the surrounding logic of createEditor, so publishing them would pin
 * that logic as API.
 */
const PUBLISHED = [
  'createEditor',
  'createInteractionController',
  'createRenderer',
  'renderScene',
  'renderOverlay',
  'resolveEnvironment',
  'cursorFor',
  'createFrameScheduler',
  'measureText',
  'sanitizePeers',
  'exportSceneSvg',
  'exportScenePng',
  'exportBounds',
  'selectExportElements',
  'EXPORT_MARGIN',
]

const WITHHELD = [
  'bindInput',
  'resolveDoubleClick',
  'commitTextChanges',
  'createLabel',
  'defaultRequestFrame',
]

describe('package entry point', () => {
  it('exposes the editor layer', () => {
    expect(PUBLISHED.filter((name) => !(name in engine))).toEqual([])
  })

  it('withholds the editor internals a host cannot use on its own', () => {
    expect(WITHHELD.filter((name) => name in engine)).toEqual([])
  })
})
