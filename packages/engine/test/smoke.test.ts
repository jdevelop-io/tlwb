import { describe, expect, it } from 'vitest'
import { ENGINE_NAME } from '../src/index'

describe('engine package', () => {
  it('is wired into the workspace', () => {
    expect(ENGINE_NAME).toBe('@tlwb/engine')
  })
})
