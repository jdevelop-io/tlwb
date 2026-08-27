import { expect, type Page, test } from '@playwright/test'

async function elementCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          tlwb: { session: { store: { listElements(): unknown[] } } }
        }
      ).tlwb.session.store.listElements().length,
  )
}

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
