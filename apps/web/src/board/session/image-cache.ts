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
  now?: () => number
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

/**
 * How long a hash that failed to resolve is left alone. The renderer
 * asks for every image on every frame, so without this an asset the
 * server does not have would mean an IndexedDB read and an HTTP GET per
 * animation frame, forever. Long enough to cost nothing, short enough
 * that an asset arriving late (a peer still uploading it, a network
 * blip) still shows up on its own.
 */
const RETRY_AFTER_MS = 10_000

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
  const now = deps.now ?? Date.now
  let upload = deps.upload
  let fetchRemote = deps.fetchRemote
  let assets = deps.assets
  const entries = new Map<string, Entry>()
  const loading = new Set<string>()
  /** Hash to the time its last load ended with nothing cached. */
  const misses = new Map<string, number>()
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
      // Content-addressed: only trust bytes whose own hash is the one we
      // asked for. A mismatch (server bug, truncated response, a
      // compromised server) leaves the hash unresolved instead of
      // poisoning the local cache under a false address.
      const stored = await assets.put(remote)
      if (stored !== hash) {
        return
      }
      blob = remote
    }
    await remember(hash, blob)
    if (destroyed) {
      // Teardown landed while this load was in flight: undo the write,
      // the renderer that requested it is gone.
      entries.delete(hash)
      return
    }
    deps.onLoaded()
  }

  return {
    resolve(hash) {
      const entry = entries.get(hash)
      if (entry) {
        return entry.source
      }
      const missedAt = misses.get(hash)
      if (
        loading.has(hash) ||
        (missedAt !== undefined && now() - missedAt < RETRY_AFTER_MS)
      ) {
        return null
      }
      loading.add(hash)
      load(hash)
        .catch(() => undefined)
        .finally(() => {
          loading.delete(hash)
          // One place decides, whatever the reason nothing was cached:
          // absent locally and remotely, a hash mismatch, or a throw.
          if (entries.has(hash)) {
            misses.delete(hash)
          } else {
            misses.set(hash, now())
          }
        })
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
      // A different source can hold what the previous one did not.
      misses.clear()
    },
    setAssets(next) {
      assets = next
      misses.clear()
    },
    destroy() {
      destroyed = true
      entries.clear()
      misses.clear()
    },
  }
}
