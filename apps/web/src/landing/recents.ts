import { fetchSession, type Me } from '../auth/client'
import { listRecents, type RecentBoard } from '../board/session/recents'

export function renderResume(
  container: HTMLElement,
  recents: RecentBoard[],
): void {
  container.replaceChildren()
  if (recents.length === 0) {
    return
  }
  const heading = document.createElement('h2')
  heading.textContent = 'Resume'
  const list = document.createElement('ul')
  for (const board of recents.slice(0, 5)) {
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.className = 'pill'
    link.href = `/b/${board.id}`
    link.textContent = board.name || 'Untitled'
    item.append(link)
    list.append(item)
  }
  container.append(heading, list)
}

/** Signed out (or no accounts on this deployment): links to sign in. */
export function renderSession(
  container: HTMLAnchorElement,
  me: Me | null,
): void {
  if (me) {
    container.href = '/dashboard'
    container.textContent = 'Dashboard'
  } else {
    container.href = '/login'
    container.textContent = 'Sign in'
  }
}

const target = document.getElementById('resume')
if (target) {
  renderResume(target, listRecents())
}

const sessionTarget = document.getElementById('session-link')
if (sessionTarget instanceof HTMLAnchorElement) {
  // A throttled check leaves the static "Sign in" markup standing
  // rather than risk asserting a wrong state either way; the editor
  // itself is the place that cannot afford to guess wrong (see
  // `board/main.tsx`).
  void fetchSession()
    .then((me) => renderSession(sessionTarget, me))
    .catch(() => undefined)
}
