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
    const hash = await assets.put(png(3))
    const remote = vi.fn(async () => png(4))
    const onLoaded = vi.fn()
    const cache = createImageCache({
      assets,
      fetchRemote: remote,
      upload: null,
      decode,
      onLoaded,
    })
    expect(cache.resolve(hash)).toBeNull()
    await settled()
    await settled()
    expect(cache.resolve(hash)).not.toBeNull()
    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(remote).not.toHaveBeenCalled()

    expect(cache.resolve('missing')).toBeNull()
    await settled()
    await settled()
    expect(remote).toHaveBeenCalledWith('missing')
    expect(cache.resolve('missing')).not.toBeNull()
    expect(await assets.get('missing')).toBeDefined()
    cache.destroy()
    await assets.delete()
  })

  it('encodes a blob as a data url', async () => {
    expect(await blobToDataUrl(png(255))).toBe('data:image/png;base64,/w==')
  })
})
