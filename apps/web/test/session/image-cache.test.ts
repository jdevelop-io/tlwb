import { createAssetStore } from '@tlwb/store-yjs'
import { describe, expect, it, vi } from 'vitest'
import {
  blobToDataUrl,
  createImageCache,
} from '../../src/board/session/image-cache'

const decode = async (blob: Blob) => ({
  source: { blob } as unknown as CanvasImageSource,
  width: 10,
  height: 20,
})

function png(byte: number) {
  return new Blob([new Uint8Array([byte])], { type: 'image/png' })
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The real content hash of `blob`, without keeping a store around for it. */
async function hashOf(blob: Blob) {
  const scratch = createAssetStore('cache-hash-scratch')
  const hash = await scratch.put(blob)
  await scratch.delete()
  return hash
}

describe('image cache', () => {
  it('stages a blob: stores, uploads, decodes, and answers synchronously after', async () => {
    const assets = createAssetStore('cache-stage')
    const upload = vi.fn(async () => undefined)
    const onLoaded = vi.fn()
    const cache = createImageCache({
      assets,
      fetchRemote: async () => null,
      upload,
      decode,
      onLoaded,
    })
    const pending = await cache.stage(png(1))
    expect(pending.width).toBe(10)
    expect(pending.height).toBe(20)
    expect(upload).toHaveBeenCalledWith(pending.assetHash, expect.any(Blob))
    expect(cache.resolve(pending.assetHash)).not.toBeNull()
    expect(cache.resolveUrl(pending.assetHash)).toMatch(
      /^data:image\/png;base64,/,
    )
    expect(await assets.get(pending.assetHash)).toBeDefined()
    cache.destroy()
    await assets.delete()
  })

  it('rejects when the upload fails', async () => {
    const assets = createAssetStore('cache-upload-fails')
    const cache = createImageCache({
      assets,
      fetchRemote: async () => null,
      upload: async () => {
        throw new Error('415')
      },
      decode,
      onLoaded: () => undefined,
    })
    await expect(cache.stage(png(2))).rejects.toThrow('415')
    cache.destroy()
    await assets.delete()
  })

  it('loads a miss from the local store, then from the server, and notifies', async () => {
    const assets = createAssetStore('cache-miss')
    const localHash = await assets.put(png(3))
    const remoteBlob = png(4)
    const remoteHash = await hashOf(remoteBlob)
    const remote = vi.fn(async () => remoteBlob)
    const onLoaded = vi.fn()
    const cache = createImageCache({
      assets,
      fetchRemote: remote,
      upload: null,
      decode,
      onLoaded,
    })
    expect(cache.resolve(localHash)).toBeNull()
    await settled()
    await settled()
    expect(cache.resolve(localHash)).not.toBeNull()
    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(remote).not.toHaveBeenCalled()

    expect(cache.resolve(remoteHash)).toBeNull()
    await settled()
    await settled()
    expect(remote).toHaveBeenCalledWith(remoteHash)
    expect(cache.resolve(remoteHash)).not.toBeNull()
    expect(await assets.get(remoteHash)).toBeDefined()
    cache.destroy()
    await assets.delete()
  })

  it('leaves the hash unresolved when the server answers content that does not hash to it', async () => {
    const assets = createAssetStore('cache-hash-mismatch')
    const remote = vi.fn(async () => png(9))
    const cache = createImageCache({
      assets,
      fetchRemote: remote,
      upload: null,
      decode,
      onLoaded: () => undefined,
    })
    expect(cache.resolve('not-the-real-hash')).toBeNull()
    await settled()
    await settled()
    expect(remote).toHaveBeenCalledWith('not-the-real-hash')
    expect(cache.resolve('not-the-real-hash')).toBeNull()
    cache.destroy()
    await assets.delete()
  })

  it('never starts a second load while one for the same hash is in flight', async () => {
    const assets = createAssetStore('cache-concurrent')
    const remote = vi.fn(async () => png(5))
    const cache = createImageCache({
      assets,
      fetchRemote: remote,
      upload: null,
      decode,
      onLoaded: () => undefined,
    })
    expect(cache.resolve('concurrent')).toBeNull()
    expect(cache.resolve('concurrent')).toBeNull()
    await settled()
    await settled()
    expect(remote).toHaveBeenCalledTimes(1)
    cache.destroy()
    await assets.delete()
  })

  it('retries a failed load, so a failure never poisons a hash permanently', async () => {
    const blob = png(6)
    const hash = await hashOf(blob)
    const assets = createAssetStore('cache-retry')
    const remote = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(blob)
    const cache = createImageCache({
      assets,
      fetchRemote: remote,
      upload: null,
      decode,
      onLoaded: () => undefined,
    })
    expect(cache.resolve(hash)).toBeNull()
    await settled()
    await settled()
    expect(remote).toHaveBeenCalledTimes(1)

    expect(cache.resolve(hash)).toBeNull()
    await settled()
    await settled()
    expect(remote).toHaveBeenCalledTimes(2)
    expect(cache.resolve(hash)).not.toBeNull()
    cache.destroy()
    await assets.delete()
  })

  it('destroy stops an in-flight load from repopulating the cache', async () => {
    const assets = createAssetStore('cache-destroy-race')
    const hash = await assets.put(png(7))
    const onLoaded = vi.fn()
    const cache = createImageCache({
      assets,
      fetchRemote: async () => null,
      upload: null,
      decode,
      onLoaded,
    })
    expect(cache.resolve(hash)).toBeNull()
    cache.destroy()
    await settled()
    await settled()
    expect(cache.resolve(hash)).toBeNull()
    expect(onLoaded).not.toHaveBeenCalled()
    await assets.delete()
  })

  it('encodes a blob as a data url', async () => {
    expect(await blobToDataUrl(png(255))).toBe('data:image/png;base64,/w==')
  })
})
