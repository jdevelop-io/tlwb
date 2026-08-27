import { expect, type Page, test } from '@playwright/test'

async function drawRectangle(page: Page, x = 400, y = 300): Promise<void> {
  await page.keyboard.press('3')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 120, y + 80, { steps: 5 })
  await page.mouse.up()
}

async function shareLink(
  page: Page,
  role: 'Can edit' | 'View only',
): Promise<string> {
  await page.getByRole('button', { name: 'Share' }).click()
  await page.getByRole('button', { name: 'Create link' }).click()
  await page.getByRole('radio', { name: role }).check()
  const link = await page
    .getByRole('textbox', { name: 'Share link' })
    .inputValue()
  await page.getByRole('button', { name: 'Close' }).click()
  return link
}

test('a local board survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Draw now' }).click()
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{21}$/)
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await drawRectangle(page)
  await expect.poll(() => elementCount(page)).toBe(1)
  await page.reload()
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await expect.poll(() => elementCount(page)).toBe(1)
})

test('an edit link collaborates live in both directions', async ({
  browser,
  page,
}) => {
  await page.goto('/b/new')
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await drawRectangle(page)
  const link = await shareLink(page, 'Can edit')
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/)

  const other = await browser.newContext()
  const guest = await other.newPage()
  await guest.goto(link)
  await guest.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await expect.poll(() => elementCount(guest)).toBe(1)
  await expect(
    guest
      .getByRole('button', { name: /Otter|Fox|Heron|Panda|Lynx|Koala/ })
      .nth(1),
  ).toBeVisible()

  await drawRectangle(guest, 700, 400)
  await expect.poll(() => elementCount(page)).toBe(2)
  await other.close()
})

test('a view link shows the board and refuses to draw', async ({
  browser,
  page,
}) => {
  await page.goto('/b/new')
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  const link = await shareLink(page, 'View only')

  const other = await browser.newContext()
  const viewer = await other.newPage()
  await viewer.goto(link)
  // The banner is a live region with no accessible name of its own (an
  // `<output>` does not get one from its content), so match it by role
  // and text instead of by name.
  await expect(
    viewer.getByRole('status').filter({ hasText: 'View only' }),
  ).toBeVisible()
  await expect(viewer.getByRole('radio', { name: 'Select (1)' })).toHaveCount(0)

  await drawRectangle(page)
  await expect.poll(() => elementCount(viewer)).toBe(1)
  await drawRectangle(viewer, 700, 400)
  await expect.poll(() => elementCount(viewer)).toBe(1)
  await other.close()
})

test("the overflow menu paints its items outside the presence stack's clipping", async ({
  page,
}) => {
  await page.goto('/b/new')
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await page.getByRole('button', { name: 'More' }).click()

  const items = [
    'Export PNG',
    'Export SVG',
    'Duplicate',
    'Remove from this browser',
  ]
  for (const name of items) {
    const button = page.getByRole('button', { name })
    // toBeVisible only checks CSS visibility/display and a non-empty
    // box; an ancestor's overflow can clip a box to nothing while both
    // of those still hold. Ask the browser what is actually painted at
    // the button's own screen position instead: if a scrolling
    // ancestor clips it, that point hits something else (or nothing).
    const isPaintedHere = await button.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      return hit === el || (hit !== null && el.contains(hit))
    })
    expect(isPaintedHere, `${name} should be painted at its own position`).toBe(
      true,
    )
  }

  await page.getByRole('button', { name: 'Export PNG' }).click()
  await expect(page.getByRole('button', { name: 'More' })).toBeVisible()
})

test('the share dialog opens as a modal and closes on Escape', async ({
  page,
}) => {
  await page.goto('/b/new')
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await page.getByRole('button', { name: 'Share' }).click()

  // The help dialog shares the class, so match on what this one says.
  const dialog = page
    .locator('dialog.share-dialog')
    .filter({ hasText: 'Share this board' })
  await expect(dialog).toBeVisible()
  // `:modal` matches only a dialog opened through showModal(), which is
  // what gives it the backdrop, the focus trap, and the dismissal
  // below. A dialog opened by its `open` attribute matches none of it.
  expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
