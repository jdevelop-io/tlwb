import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Canvas, createCanvas, loadImage } from '@napi-rs/canvas'
import pixelmatch from 'pixelmatch'
import { describe, expect, it } from 'vitest'
import { createCamera } from '../../src/camera'
import type { BoardElement } from '../../src/model/element'
import { renderScene } from '../../src/render/scene'
import { freehandScene, shapesScene, textScene } from './scenes'

const WIDTH = 720
const HEIGHT = 560
const THRESHOLD = 0.12
const MAX_MISMATCH_RATIO = 0.002
const update = process.env.UPDATE_BASELINES === '1'

const pathTo = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url))

function renderToCanvas(elements: BoardElement[]): Canvas {
  const canvas = createCanvas(WIDTH, HEIGHT)
  renderScene(canvas as unknown as HTMLCanvasElement, {
    elements,
    camera: createCamera(),
    viewport: { width: WIDTH, height: HEIGHT },
    fonts: { hand: 'Caveat', ui: 'Caveat' },
  })
  return canvas
}

async function expectMatchesBaseline(
  name: string,
  canvas: Canvas,
): Promise<void> {
  const baselinePath = pathTo(`__baselines__/${name}.png`)
  if (update) {
    mkdirSync(pathTo('__baselines__'), { recursive: true })
    writeFileSync(baselinePath, canvas.toBuffer('image/png'))
    return
  }
  if (!existsSync(baselinePath)) {
    throw new Error(
      `Missing baseline ${name}.png. Run` +
        ' `pnpm --filter @tlwb/engine test:visual:update`,' +
        ' review the PNG, and commit it.',
    )
  }
  const actual = canvas.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT)
  const baselineCanvas = createCanvas(WIDTH, HEIGHT)
  const baselineCtx = baselineCanvas.getContext('2d')
  baselineCtx.drawImage(await loadImage(baselinePath), 0, 0)
  const expected = baselineCtx.getImageData(0, 0, WIDTH, HEIGHT)
  const diffCanvas = createCanvas(WIDTH, HEIGHT)
  const diffCtx = diffCanvas.getContext('2d')
  const diffImage = diffCtx.createImageData(WIDTH, HEIGHT)
  const mismatched = pixelmatch(
    actual.data,
    expected.data,
    diffImage.data,
    WIDTH,
    HEIGHT,
    { threshold: THRESHOLD },
  )
  const ratio = mismatched / (WIDTH * HEIGHT)
  if (ratio > MAX_MISMATCH_RATIO) {
    mkdirSync(pathTo('__diffs__'), { recursive: true })
    diffCtx.putImageData(diffImage, 0, 0)
    writeFileSync(
      pathTo(`__diffs__/${name}.png`),
      diffCanvas.toBuffer('image/png'),
    )
  }
  expect(ratio).toBeLessThanOrEqual(MAX_MISMATCH_RATIO)
}

describe('visual regression', () => {
  it('matches the shapes baseline', async () => {
    await expectMatchesBaseline('shapes', renderToCanvas(shapesScene()))
  })

  it('matches the freehand baseline', async () => {
    await expectMatchesBaseline('freehand', renderToCanvas(freehandScene()))
  })

  it('matches the text baseline', async () => {
    await expectMatchesBaseline('text', renderToCanvas(textScene()))
  })
})
