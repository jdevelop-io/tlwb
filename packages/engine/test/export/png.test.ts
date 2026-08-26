import { type Canvas, createCanvas, loadImage } from '@napi-rs/canvas'
import pixelmatch from 'pixelmatch'
import { describe, expect, it } from 'vitest'
import { exportBounds } from '../../src/export/bounds'
import { exportScenePng } from '../../src/export/png'
import { createElement } from '../../src/model/create'
import { renderScene } from '../../src/render/scene'
import { shapesScene } from '../visual/scenes'

const FONTS = { hand: 'Caveat', ui: 'Caveat' }

/** A napi canvas with the browser's `toBlob`, which napi lacks. */
function canvasFactory(): () => HTMLCanvasElement {
  return () => {
    const canvas = createCanvas(1, 1)
    return Object.assign(canvas, {
      toBlob(callback: (blob: Blob | null) => void, type?: string) {
        callback(
          new Blob([new Uint8Array(canvas.toBuffer('image/png'))], { type }),
        )
      },
    }) as unknown as HTMLCanvasElement
  }
}

async function decode(blob: Blob): Promise<Canvas> {
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
  const canvas = createCanvas(image.width, image.height)
  canvas.getContext('2d').drawImage(image, 0, 0)
  return canvas
}

describe('exportScenePng', () => {
  it('returns a PNG blob framed on the element bounds plus the margin', async () => {
    const blob = await exportScenePng(
      [
        createElement('rectangle', {
          id: 'r',
          index: 'a0',
          seed: 1,
          x: 100,
          y: 50,
          width: 200,
          height: 100,
        }),
      ],
      { fonts: FONTS },
      canvasFactory(),
    )
    expect(blob.type).toBe('image/png')
    const canvas = await decode(blob)
    expect(canvas.width).toBe(232)
    expect(canvas.height).toBe(132)
  })

  it('scales the backing store by the scale option', async () => {
    const blob = await exportScenePng(
      shapesScene(),
      { fonts: FONTS, scale: 2 },
      canvasFactory(),
    )
    const canvas = await decode(blob)
    const bounds = exportBounds(shapesScene())
    expect(canvas.width).toBe(Math.ceil(bounds.width) * 2)
    expect(canvas.height).toBe(Math.ceil(bounds.height) * 2)
  })

  it('exports an empty board as a one by one background pixel', async () => {
    const blob = await exportScenePng(
      [],
      { background: '#FF0000' },
      canvasFactory(),
    )
    const canvas = await decode(blob)
    expect(canvas.width).toBe(1)
    expect(
      Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data),
    ).toEqual([255, 0, 0, 255])
  })

  it('produces the same pixels as the scene renderer on the same frame', async () => {
    const elements = shapesScene()
    const bounds = exportBounds(elements)
    const width = Math.ceil(bounds.width)
    const height = Math.ceil(bounds.height)
    const reference = createCanvas(width, height)
    renderScene(reference as unknown as HTMLCanvasElement, {
      elements,
      camera: { x: bounds.x, y: bounds.y, zoom: 1 },
      viewport: { width, height },
      fonts: FONTS,
    })
    const exported = await decode(
      await exportScenePng(elements, { fonts: FONTS }, canvasFactory()),
    )
    const mismatched = pixelmatch(
      exported.getContext('2d').getImageData(0, 0, width, height).data,
      reference.getContext('2d').getImageData(0, 0, width, height).data,
      undefined,
      width,
      height,
      { threshold: 0 },
    )
    expect(mismatched).toBe(0)
  })
})
