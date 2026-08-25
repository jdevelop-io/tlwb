import { describe, expect, it } from 'vitest'
import * as engine from '../src/index'

describe('package entry point', () => {
  it('exposes the editor layer', () => {
    expect(typeof engine.createEditor).toBe('function')
    expect(typeof engine.resolveEnvironment).toBe('function')
    expect(typeof engine.bindInput).toBe('function')
    expect(typeof engine.cursorFor).toBe('function')
    expect(typeof engine.renderOverlay).toBe('function')
    expect(typeof engine.exportSceneSvg).toBe('function')
    expect(typeof engine.exportScenePng).toBe('function')
    expect(typeof engine.measureText).toBe('function')
    expect(typeof engine.sanitizePeers).toBe('function')
  })
})
