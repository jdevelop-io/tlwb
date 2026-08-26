export interface RecentBoard {
  id: string
  name: string
  updatedAt: number
}

export const RECENTS_CAP = 50
const KEY = 'tlwb:recents'

function isRecent(value: unknown): value is RecentBoard {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'updatedAt' in value &&
    typeof value.updatedAt === 'number'
  )
}

export function listRecents(storage: Storage = localStorage): RecentBoard[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) && parsed.every(isRecent) ? parsed : []
  } catch {
    return []
  }
}

export function touchRecent(
  entry: RecentBoard,
  storage: Storage = localStorage,
): void {
  const others = listRecents(storage).filter((item) => item.id !== entry.id)
  const next = [entry, ...others]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENTS_CAP)
  storage.setItem(KEY, JSON.stringify(next))
}

export function removeRecent(
  id: string,
  storage: Storage = localStorage,
): void {
  storage.setItem(
    KEY,
    JSON.stringify(listRecents(storage).filter((item) => item.id !== id)),
  )
}
