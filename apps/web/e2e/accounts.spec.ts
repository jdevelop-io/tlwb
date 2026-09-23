import { expect, type Page, test } from '@playwright/test'
import { addSessionCookie, seedSession } from './session-helper'

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

function boardIdFrom(url: string): string {
  const match = /\/b\/([A-Za-z0-9_-]+)$/.exec(new URL(url).pathname)
  const id = match?.[1]
  if (!id) {
    throw new Error(`not a board URL: ${url}`)
  }
  return id
}

test('adopt, dashboard, cap', async ({
  page,
  context,
  browser,
  baseURL,
  viewport,
}) => {
  // 1. Anonymously: create a board and draw on it, with no session
  // cookie anywhere yet -- the board is created ownerless.
  await page.goto('/')
  await page.getByRole('link', { name: 'Draw now' }).click()
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await drawRectangle(page)
  await expect.poll(() => elementCount(page)).toBe(1)

  // Share it: this hosts the board on the server (still ownerless) and
  // leaves both an edit and a view key in this browser's localStorage.
  await page.getByRole('button', { name: 'Share' }).click()
  await page.getByRole('button', { name: 'Create link' }).click()
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/)
  const boardId1 = boardIdFrom(page.url())
  // Scoped to the open dialog: the editor's own help/shortcuts dialog
  // (mounted, closed) shares the "Close" accessible name with this one,
  // which is a pre-existing collision unrelated to the dashboard rework
  // below -- a bare getByRole('button', { name: 'Close' }) is a
  // strict-mode violation here.
  await page
    .locator('.share-dialog[open]')
    .getByRole('button', { name: 'Close' })
    .click()

  // 2. Seed a session only now, so the board above really was created
  // anonymously rather than picking up an owner at creation time.
  const seeded = await seedSession()
  await addSessionCookie(context, seeded.token)

  // First assertion of the suite: pin the cookie format before
  // anything downstream relies on it. Better Auth answers a wrong
  // signature by reading as signed out, not by erroring, so a broken
  // cookie would otherwise surface only as a confusing dashboard
  // redirect to /login several steps from now.
  const sessionCheck = await page.request.get('/api/auth/get-session')
  expect(sessionCheck.status()).toBe(200)
  const sessionBody = (await sessionCheck.json()) as {
    user: { email: string }
  }
  expect(sessionBody.user.email).toBe(seeded.user.email)

  // 3. Reload /dashboard: it adopts the browser's boards on load, then
  // the shared board's card should show up, identified by name.
  await page.goto('/dashboard')
  const card1 = page.locator('.board-card', {
    has: page.locator(`a[href="/b/${boardId1}"]`),
  })
  await expect(card1).toBeVisible()
  await expect(card1.locator('.card-name')).toContainText('Untitled')
  await expect(page.locator('.board-card')).toHaveCount(1)
  // The board count now lives in the sidebar's plan line, not a
  // dedicated gauge element.
  await expect(page.locator('.account-plan')).toHaveText('Free · 1/2 boards')

  // 4. New board -> lands on /b/<id>; back on /dashboard the gauge and
  // grid both reflect the real count against the real cap.
  // Below the cap, the primary "New board" button in the header and the
  // grid's ghost card both carry that accessible name, so the click is
  // scoped to the header to avoid a strict-mode ambiguity.
  await page
    .locator('.main-header')
    .getByRole('button', { name: 'New board' })
    .click()
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/)
  const boardId2 = boardIdFrom(page.url())
  expect(boardId2).not.toBe(boardId1)

  await page.goto('/dashboard')
  await expect(page.locator('.board-card')).toHaveCount(2)
  await expect(page.locator('.account-plan')).toHaveText('Free · 2/2 boards')

  // 5. New board again -> the cap is enforced server-side: the create
  // request is refused, the cap message appears, and no third card is
  // added to the grid. At the cap, the grid's ghost card switches to the
  // disabled "Board limit reached" state, so the header button is the
  // only "New board" left and needs no extra scoping.
  await page.getByRole('button', { name: 'New board' }).click()
  await expect(page.locator('.quota-banner')).toContainText(
    'You have reached your board limit.',
  )
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.locator('.board-card')).toHaveCount(2)

  // 6. Open the first board from its card, in a browser context that
  // never held this board's keys in localStorage: only the account
  // session can grant edit here, so this proves ownership -- not a
  // leftover local key -- is what makes it editable.
  // A raw newContext() call still inherits baseURL and viewport from
  // the project config (Playwright wires that in for any context created
  // during a test, not just the context/page fixtures), but passing them
  // explicitly here means this test does not depend on that.
  const ownerContext = await browser.newContext({ baseURL, viewport })
  try {
    await addSessionCookie(ownerContext, seeded.token)
    const ownerPage = await ownerContext.newPage()
    await ownerPage.goto('/dashboard')
    await ownerPage.locator(`a[href="/b/${boardId1}"]`).first().click()
    await expect(ownerPage).toHaveURL(`http://localhost:5173/b/${boardId1}`)
    expect(new URL(ownerPage.url()).hash).toBe('')

    await ownerPage.getByRole('radio', { name: 'Select (1)' }).waitFor()
    // The rectangle drawn before sharing round-tripped through the
    // server: this context has no local copy of it at all.
    await expect.poll(() => elementCount(ownerPage)).toBe(1)
    await drawRectangle(ownerPage, 700, 500)
    await expect.poll(() => elementCount(ownerPage)).toBe(2)
  } finally {
    await ownerContext.close()
  }
})
