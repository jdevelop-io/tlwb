import { describe, expect, it } from 'vitest'
import { createAssetStore } from '../src/assets'

describe('createAssetStore', () => {
  it('stores a blob under its content hash and returns it', async () => {
    const assets = createAssetStore('assets-roundtrip')
    const blob = new Blob(['hello'], { type: 'text/plain' })
    const hash = await assets.put(blob)
    expect(hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
    const stored = await assets.get(hash)
    expect(stored?.type).toBe('text/plain')
    expect(await stored?.text()).toBe('hello')
    await assets.destroy()
  })

  it('returns undefined for an unknown hash', async () => {
    const assets = createAssetStore('assets-unknown')
    expect(await assets.get('missing')).toBeUndefined()
    await assets.destroy()
  })

  it('gives the same hash to the same content', async () => {
    const assets = createAssetStore('assets-dedupe')
    const first = await assets.put(new Blob(['same'], { type: 'image/png' }))
    const second = await assets.put(new Blob(['same'], { type: 'image/png' }))
    expect(second).toBe(first)
    await assets.destroy()
  })

  it('delete removes the blobs of the board', async () => {
    const assets = createAssetStore('assets-delete')
    const hash = await assets.put(new Blob([new Uint8Array([1, 2, 3])]))
    await assets.delete()
    const reopened = createAssetStore('assets-delete')
    expect(await reopened.get(hash)).toBeUndefined()
    await reopened.delete()
  })
})
