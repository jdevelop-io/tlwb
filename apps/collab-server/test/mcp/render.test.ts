import { createHash } from 'node:crypto'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createElement, EXPORT_MARGIN } from '@tlwb/engine'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { putAsset } from '../../src/db/assets'
import { createBoard } from '../../src/db/boards'
import { connectDatabase } from '../../src/db/client'
import { generateKey, hashKey } from '../../src/keys'
import {
  exceedsPixelBudget,
  loadImages,
  registerFont,
  renderPng,
} from '../../src/mcp/render'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

describe('registerFont', () => {
  it('throws rather than silently falling back to a substitute font', () => {
    // A real, resolvable file that is not a font: `registerFromPath`
    // returns null for it instead of throwing on its own.
    expect(() =>
      registerFont('@fontsource/inter/package.json', 'Bogus'),
    ).toThrow(/failed to register font/)
  })
})

describe('exceedsPixelBudget', () => {
  it('agrees with renderPng about the ceiling', async () => {
    const scene = [
      createElement('rectangle', {
        index: 'a0',
        id: 'r',
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
      }),
    ]
    expect(exceedsPixelBudget(scene, 1, 100)).toBe(true)
    await expect(
      renderPng(scene, { scale: 1, maxPixels: 100 }),
    ).resolves.toBeNull()
    expect(exceedsPixelBudget(scene, 1, 100_000_000)).toBe(false)
  })
})

const scene = [
  createElement('rectangle', {
    index: 'a0',
    id: 'r',
    seed: 1,
    x: 10,
    y: 10,
    width: 200,
    height: 100,
  }),
  createElement('text', {
    index: 'a1',
    id: 't',
    seed: 1,
    x: 20,
    y: 20,
    width: 100,
    height: 30,
    text: 'Hello',
    fontFamily: 'ui',
  }),
]

describe('renderPng', () => {
  it('renders a PNG framed on the bounds plus the margin, scaled', async () => {
    const png = await renderPng(scene, { scale: 2, maxPixels: 10_000_000 })
    expect(png).not.toBeNull()
    expect([...(png as Uint8Array).slice(0, 4)]).toEqual(PNG_SIGNATURE)
    const image = await loadImage(Buffer.from(png as Uint8Array))
    expect(image.width).toBe((200 + 2 * EXPORT_MARGIN) * 2)
    expect(image.height).toBe((100 + 2 * EXPORT_MARGIN) * 2)
  })

  it('renders an empty board as one background pixel', async () => {
    const png = await renderPng([], { scale: 1, maxPixels: 10 })
    const image = await loadImage(Buffer.from(png as Uint8Array))
    expect(image.width).toBe(1)
    expect(image.height).toBe(1)
  })

  it('returns null over the pixel bound', async () => {
    await expect(
      renderPng(scene, { scale: 1, maxPixels: 100 }),
    ).resolves.toBeNull()
  })
})

describe('renderPng with images', () => {
  const url = process.env.DATABASE_URL as string
  let database: Awaited<ReturnType<typeof connectDatabase>>

  beforeAll(async () => {
    database = await connectDatabase(url)
  })

  afterAll(async () => {
    await database.close()
  })

  async function board(): Promise<string> {
    const boardId = `img${Date.now()}${Math.floor(Math.random() * 1000)}`
    await createBoard(database.db, boardId, {
      editKeyHash: hashKey(generateKey()),
      viewKeyHash: hashKey(generateKey()),
    })
    return boardId
  }

  /** A real, tiny, solid PNG, the same shape an uploaded asset would be. */
  function redSquare(): { bytes: Buffer; hash: string } {
    const canvas = createCanvas(4, 4)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 4, 4)
    const bytes = Buffer.from(canvas.toBuffer('image/png'))
    return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }
  }

  /** Decodes a rendered PNG and reads back one pixel's RGBA. */
  async function pixelAt(
    png: Uint8Array,
    x: number,
    y: number,
  ): Promise<[number, number, number, number]> {
    const image = await loadImage(Buffer.from(png))
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const data = ctx.getImageData(x, y, 1, 1).data
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
  }

  it('draws a stored asset through loadImages', async () => {
    const boardId = await board()
    const { bytes, hash } = redSquare()
    await putAsset(database.db, { boardId, hash, mime: 'image/png', bytes })
    const elements = [
      createElement('image', {
        index: 'a0',
        id: 'i',
        x: 0,
        y: 0,
        width: 4,
        height: 4,
        assetHash: hash,
      }),
    ]
    const resolveImage = await loadImages(database.db, boardId, elements)
    const png = await renderPng(elements, {
      scale: 1,
      maxPixels: 10_000_000,
      resolveImage,
    })
    expect(png).not.toBeNull()
    const pixel = await pixelAt(
      png as Uint8Array,
      EXPORT_MARGIN + 2,
      EXPORT_MARGIN + 2,
    )
    expect(pixel).toEqual([255, 0, 0, 255])
  })

  it('renders a broken-image placeholder when the asset is missing', async () => {
    const boardId = await board()
    const elements = [
      createElement('image', {
        index: 'a0',
        id: 'i',
        x: 0,
        y: 0,
        width: 4,
        height: 4,
        assetHash: 'no-such-asset',
      }),
    ]
    const resolveImage = await loadImages(database.db, boardId, elements)
    const png = await renderPng(elements, {
      scale: 1,
      maxPixels: 10_000_000,
      resolveImage,
    })
    expect(png).not.toBeNull()
    const [r, g, b] = await pixelAt(
      png as Uint8Array,
      EXPORT_MARGIN + 2,
      EXPORT_MARGIN + 2,
    )
    expect([r, g, b]).toEqual([0xf7, 0xf7, 0xf5])
  })
})
