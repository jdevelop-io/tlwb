import { exportBounds } from '@tlwb/engine'
import { readBoardStore } from './board-read'
import type { Config } from './config'
import { readThumbnail, writeThumbnail } from './db/boards'
import type { Db } from './db/client'
import { exceedsPixelBudget, loadImages, renderPng } from './mcp/render'

export const THUMB_WIDTH = 400

/** Thrown when a render is needed but the caller declined the render budget. */
export class ThumbnailBudgetExceededError extends Error {
  constructor() {
    super('render budget exceeded')
    this.name = 'ThumbnailBudgetExceededError'
  }
}

/**
 * The board as a small PNG, cached in the boards row and re-rendered
 * only when the persisted document has moved past the cached sequence.
 * Null when the board is unknown, empty, or too large to render.
 *
 * `takeRenderBudget` is consulted only once a render is about to run:
 * a cache hit, an empty board, or one over the pixel budget never
 * touches it, so listing cached thumbnails costs the caller nothing.
 */
export async function boardThumbnail(
  db: Db,
  config: Config,
  boardId: string,
  takeRenderBudget: () => boolean = () => true,
): Promise<Buffer | null> {
  const read = await readBoardStore(db, boardId)
  if (!read) {
    return null
  }
  const cached = await readThumbnail(db, boardId)
  if (cached.thumbnail && cached.thumbnailSeq === read.latestSeq) {
    return cached.thumbnail
  }
  const elements = read.store.listElements()
  if (elements.length === 0) {
    return null
  }
  // Targets a render close to THUMB_WIDTH wide directly, rather than
  // rendering at the board's full resolution and shrinking afterward:
  // rasterizing is synchronous native work that blocks the event loop
  // for every live session, so its cost must track the thumbnail's
  // output size, not the board's extent.
  const scale = THUMB_WIDTH / exportBounds(elements).width
  if (exceedsPixelBudget(elements, scale, config.mcpMaxImagePixels)) {
    return null
  }
  if (!takeRenderBudget()) {
    throw new ThumbnailBudgetExceededError()
  }
  const rendered = await renderPng(elements, {
    scale,
    maxPixels: config.mcpMaxImagePixels,
    resolveImage: await loadImages(db, boardId, elements),
  })
  if (!rendered) {
    return null
  }
  const png = Buffer.from(rendered)
  await writeThumbnail(db, boardId, png, read.latestSeq)
  return png
}
