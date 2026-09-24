import { type Page, test } from '@playwright/test'

/**
 * Screen-by-screen captures for a manual side-by-side comparison against
 * the Paper artboards. This spec only produces PNGs under
 * `test-results/visual/`; it makes no `expect(page).toHaveScreenshot()`
 * assertions and has no committed baselines to compare against, so a
 * green run means the captures were taken, nothing about whether they
 * match the design.
 */
test.use({ viewport: { width: 1440, height: 900 } })

function boardIdFrom(url: string): string {
  const match = /\/b\/([A-Za-z0-9_-]+)$/.exec(new URL(url).pathname)
  const id = match?.[1]
  if (!id) {
    throw new Error(`not a board URL: ${url}`)
  }
  return id
}

async function drawRectangle(page: Page, x = 400, y = 300): Promise<void> {
  await page.keyboard.press('3')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 120, y + 80, { steps: 5 })
  await page.mouse.up()
}

test('captures every screen for the Paper review gate', async ({ page }) => {
  // Matching what the Paper landing artboard shows.
  await page.goto('/')
  await page.locator('.preview').waitFor()
  await page.screenshot({
    path: 'test-results/visual/landing.png',
    fullPage: true,
  })

  await page.goto('/b/new')
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await drawRectangle(page)
  await page.getByRole('button', { name: 'Share' }).click()
  await page.getByRole('button', { name: 'Create link' }).click()
  boardIdFrom(page.url())
  await page
    .locator('.share-dialog[open]')
    .getByRole('button', { name: 'Close' })
    .click()
  await page.screenshot({ path: 'test-results/visual/board.png' })

  await page.getByRole('button', { name: 'Share' }).click()
  await page.locator('.share-dialog[open]').waitFor()
  await page.screenshot({ path: 'test-results/visual/board-share.png' })
})
