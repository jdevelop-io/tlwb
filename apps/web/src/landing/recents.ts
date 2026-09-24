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

const target = document.getElementById('resume')
if (target) {
  renderResume(target, listRecents())
}
