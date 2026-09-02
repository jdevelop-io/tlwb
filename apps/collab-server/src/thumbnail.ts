import { createCanvas, loadImage } from '@napi-rs/canvas'
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
  if (exceedsPixelBudget(elements, 1, config.mcpMaxImagePixels)) {
    return null
  }
  if (!takeRenderBudget()) {
    throw new ThumbnailBudgetExceededError()
  }
  const full = await renderPng(elements, {
    scale: 1,
    maxPixels: config.mcpMaxImagePixels,
    resolveImage: await loadImages(db, boardId, elements),
  })
  if (!full) {
    return null
  }
  const image = await loadImage(Buffer.from(full))
  const height = Math.max(
    1,
    Math.round((image.height / image.width) * THUMB_WIDTH),
  )
  const canvas = createCanvas(THUMB_WIDTH, height)
  canvas.getContext('2d').drawImage(image, 0, 0, THUMB_WIDTH, height)
  const png = canvas.toBuffer('image/png')
  await writeThumbnail(db, boardId, png, read.latestSeq)
  return png
}
