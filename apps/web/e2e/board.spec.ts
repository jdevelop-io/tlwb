import { expect, type Locator, type Page, test } from '@playwright/test'

/**
 * toBeVisible only checks CSS visibility, display, and a non-empty box.
 * All three still hold while an ancestor clips the element to nothing,
 * or while another panel of the chrome paints on top of it. Ask the
 * browser what it actually paints at the element's own position
 * instead, at both ends as well as the middle so a partial cover counts
 * too.
 */
async function expectPainted(target: Locator, what: string): Promise<void> {
  const covered = await target.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return [0.05, 0.5, 0.95]
      .map((fraction) => Math.round(rect.left + rect.width * fraction))
      .filter((x) => {
        const hit = document.elementFromPoint(x, rect.top + rect.height / 2)
        return hit !== el && !(hit !== null && el.contains(hit))
      })
  })
  expect(covered, `${what} should be painted at its own position`).toEqual([])
}

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
  role: 'Can edit' | 'Can view',
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
  const link = await shareLink(page, 'Can view')

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
    await expectPainted(page.getByRole('button', { name }), name)
  }

  await page.getByRole('button', { name: 'Export PNG' }).click()
  await expect(page.getByRole('button', { name: 'More' })).toBeVisible()
})

test('the panels of the chrome never paint over one another', async ({
  page,
}) => {
  await page.goto('/b/new')
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  // Drawing leaves the shape selected, which is what raises the context
  // panel.
  await drawRectangle(page)
  await expect(
    page.getByRole('button', { name: 'Bring to front' }),
  ).toBeVisible()

  // Every panel is absolutely positioned over the same canvas at the
  // same z-index, so which one wins where is a function of the
  // viewport: run this at each of them.
  const panels: Array<[string, string]> = [
    ['.top-bar', 'the top bar'],
    ['.toolbar', 'the toolbar'],
    ['.context-panel', 'the context panel'],
    ['.zoom-controls', 'the zoom controls'],
    ['.presence-stack', 'the presence stack'],
  ]
  for (const [selector, what] of panels) {
    await expectPainted(page.locator(selector), what)
  }
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
