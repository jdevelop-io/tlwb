const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function relativeTime(iso: string, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(iso))
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  const days = Math.floor(elapsed / DAY)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks === 1) return 'last week'
  if (days < 30) return `${weeks} weeks ago`
  const months = Math.floor(days / 30)
  if (months === 1) return 'last month'
  if (days < 365) return `${months} months ago`
  const years = Math.floor(days / 365)
  return years === 1 ? 'last year' : `${years} years ago`
}
