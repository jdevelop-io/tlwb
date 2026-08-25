import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import { mountEditor } from './harness'

const box = (id: string, index: string, x: number) =>
  createElement('rectangle', {
    id,
    index,
    seed: 1,
    x,
    y: 0,
    width: 100,
    height: 50,
  })

describe('editor export', () => {
  it('exports the board as SVG, whole or by ids', () => {
    const { editor, store } = mountEditor({
      resolveImageUrl: (hash) => `https://cdn.example/${hash}`,
    })
    store.applyChanges([
      { kind: 'create', element: box('a', 'a0', 0) },
      { kind: 'create', element: box('b', 'a1', 500) },
      {
        kind: 'create',
        element: createElement('image', {
          id: 'i',
          index: 'a2',
          x: 0,
          y: 200,
          width: 40,
          height: 30,
          assetHash: 'abc',
        }),
      },
    ])
    const whole = editor.exportSvg()
    expect(whole).toContain('viewBox="-16 -16 632 262"')
    expect(whole).toContain('href="https://cdn.example/abc"')
    const part = editor.exportSvg({ ids: ['b'], background: '#EEEEEE' })
    expect(part).toContain('viewBox="484 -16 132 82"')
    expect(part).toContain('fill="#EEEEEE"')
    expect(part).not.toContain('<image')
  })

  it('exports the board as a PNG blob at the requested scale', async () => {
    const { editor, store } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 'a0', 0) }])
    const blob = await editor.exportPng({ scale: 2 })
    expect(blob.type).toBe('image/png')
    const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
    expect(image.width).toBe(264)
    expect(image.height).toBe(164)
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([
      255, 255, 255, 255,
    ])
  })

  it('keeps exporting SVG and PNG after destroy, since export only reads the store', async () => {
    const { editor, store } = mountEditor()
    store.applyChanges([{ kind: 'create', element: box('a', 'a0', 0) }])
    editor.destroy()
    expect(editor.exportSvg()).toContain('viewBox="-16 -16 132 82"')
    const blob = await editor.exportPng()
    expect(blob.type).toBe('image/png')
  })

  it('falls back to the editor-configured background for both exports', async () => {
    const { editor, store } = mountEditor({ background: '#EEEEEE' })
    store.applyChanges([{ kind: 'create', element: box('a', 'a0', 0) }])
    expect(editor.exportSvg()).toContain('fill="#EEEEEE"')
    const blob = await editor.exportPng()
    const image = await loadImage(Buffer.from(await blob.arrayBuffer()))
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([
      238, 238, 238, 255,
    ])
  })
})
