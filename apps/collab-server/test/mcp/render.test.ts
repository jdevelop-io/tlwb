import { loadImage } from '@napi-rs/canvas'
import { createElement, EXPORT_MARGIN } from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import { renderPng } from '../../src/mcp/render'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

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
