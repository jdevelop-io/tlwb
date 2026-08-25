import { describe, expect, it } from 'vitest'
import { exportSceneSvg } from '../../src/export/svg'
import { createElement } from '../../src/model/create'
import { freehandScene, shapesScene, textScene } from '../visual/scenes'

const FONTS = { hand: 'Caveat', ui: 'Inter' }

describe('exportSceneSvg', () => {
  it('matches the shapes snapshot', async () => {
    await expect(
      exportSceneSvg(shapesScene(), { fonts: FONTS }),
    ).toMatchFileSnapshot('./__snapshots__/shapes.svg')
  })

  it('matches the freehand snapshot', async () => {
    await expect(
      exportSceneSvg(freehandScene(), { fonts: FONTS }),
    ).toMatchFileSnapshot('./__snapshots__/freehand.svg')
  })

  it('matches the text snapshot', async () => {
    await expect(
      exportSceneSvg(textScene(), { fonts: FONTS }),
    ).toMatchFileSnapshot('./__snapshots__/text.svg')
  })

  it('frames the export on the element bounds plus the margin', () => {
    const svg = exportSceneSvg([
      createElement('rectangle', {
        id: 'r',
        index: 'a0',
        seed: 1,
        x: 100,
        y: 50,
        width: 200,
        height: 100,
      }),
    ])
    expect(svg).toContain('viewBox="84 34 232 132"')
    expect(svg).toContain('width="232" height="132"')
    expect(svg).toContain(
      '<rect x="84" y="34" width="232" height="132" fill="#FFFFFF"/>',
    )
  })

  it('exports an empty board as a one by one background', () => {
    expect(exportSceneSvg([], { background: '#ABCDEF' })).toContain(
      '<rect x="0" y="0" width="1" height="1" fill="#ABCDEF"/>',
    )
  })

  it('exports only the requested ids', () => {
    const svg = exportSceneSvg(shapesScene().slice(0, 2), {
      ids: ['rect-2'],
    })
    expect(svg).toContain('#C0392B')
    expect((svg.match(/<g /g) ?? []).length).toBe(1)
  })

  it('escapes text content and dashes dashed strokes', () => {
    const svg = exportSceneSvg(
      [
        createElement('text', {
          id: 't',
          index: 'a0',
          width: 100,
          height: 25,
          text: 'a < b & "c"',
          fontSize: 20,
        }),
        createElement('line', {
          id: 'l',
          index: 'a1',
          seed: 3,
          width: 100,
          height: 0,
          strokeStyle: 'dashed',
          strokeWidth: 2,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
        }),
      ],
      { fonts: FONTS },
    )
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;')
    expect(svg).toContain('font-family="Caveat"')
    expect(svg).toContain('stroke-dasharray="8 8"')
  })

  it('rotates around the element center and carries the opacity', () => {
    const svg = exportSceneSvg([
      createElement('rectangle', {
        id: 'r',
        index: 'a0',
        seed: 1,
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        angle: Math.PI / 2,
        opacity: 0.5,
      }),
    ])
    expect(svg).toContain(
      '<g transform="translate(50 25) rotate(90) translate(-50 -25)" opacity="0.5">',
    )
  })

  it('embeds images through the url resolver and omits unresolved ones', () => {
    const image = createElement('image', {
      id: 'i',
      index: 'a0',
      width: 40,
      height: 30,
      assetHash: 'abc',
    })
    expect(exportSceneSvg([image])).not.toContain('<image')
    expect(
      exportSceneSvg([image], {
        resolveImageUrl: (hash) => `data:image/png;base64,${hash}`,
      }),
    ).toContain(
      '<image href="data:image/png;base64,abc" width="40" height="30" preserveAspectRatio="none"/>',
    )
  })
})
