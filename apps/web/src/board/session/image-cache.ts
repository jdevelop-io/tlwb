import type { PendingImage } from '@tlwb/engine'
import type { AssetStore } from '@tlwb/store-yjs'

export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
}

export interface ImageCacheDeps {
  assets: AssetStore
  /** The server copy; null when the board is local or the asset is unknown. */
  fetchRemote: (hash: string) => Promise<Blob | null>
  /** Null on a local board: nothing to upload to. */
  upload: ((hash: string, blob: Blob) => Promise<void>) | null
  decode?: (blob: Blob) => Promise<DecodedImage>
  /** The renderer has no idea an image finished loading; the host repaints. */
  onLoaded: () => void
}

export interface ImageCache {
  resolve(hash: string): CanvasImageSource | null
  resolveUrl(hash: string): string | null
  stage(blob: Blob): Promise<PendingImage>
  setUpload(upload: ImageCacheDeps['upload']): void
  setFetchRemote(fetchRemote: ImageCacheDeps['fetchRemote']): void
  setAssets(assets: AssetStore): void
  destroy(): void
}

interface Entry {
  source: CanvasImageSource
  dataUrl: string
}

async function decodeWithBitmap(blob: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(blob)
  return { source: bitmap, width: bitmap.width, height: bitmap.height }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

export function createImageCache(deps: ImageCacheDeps): ImageCache {
  const decode = deps.decode ?? decodeWithBitmap
  let upload = deps.upload
  let fetchRemote = deps.fetchRemote
  let assets = deps.assets
  const entries = new Map<string, Entry>()
  const loading = new Set<string>()
  let destroyed = false

  async function remember(hash: string, blob: Blob): Promise<DecodedImage> {
    const decoded = await decode(blob)
    entries.set(hash, {
      source: decoded.source,
      dataUrl: await blobToDataUrl(blob),
    })
    return decoded
  }

  async function load(hash: string): Promise<void> {
    let blob = await assets.get(hash)
    if (!blob) {
      const remote = await fetchRemote(hash)
      if (!remote) {
        return
      }
      await assets.put(remote, hash)
      blob = remote
    }
    await remember(hash, blob)
    if (!destroyed) {
      deps.onLoaded()
    }
  }

  return {
    resolve(hash) {
      const entry = entries.get(hash)
      if (entry) {
        return entry.source
      }
      if (!loading.has(hash)) {
        loading.add(hash)
        load(hash)
          .catch(() => undefined)
          .finally(() => loading.delete(hash))
      }
      return null
    },
    resolveUrl(hash) {
      return entries.get(hash)?.dataUrl ?? null
    },
    async stage(blob) {
      const hash = await assets.put(blob)
      if (upload) {
        await upload(hash, blob)
      }
      const decoded = await remember(hash, blob)
      return { assetHash: hash, width: decoded.width, height: decoded.height }
    },
    setUpload(next) {
      upload = next
    },
    setFetchRemote(next) {
      fetchRemote = next
    },
    setAssets(next) {
      assets = next
    },
    destroy() {
      destroyed = true
      entries.clear()
    },
  }
}
