import { generateKeyBetween } from 'fractional-indexing'

export function firstIndex(): string {
  return generateKeyBetween(null, null)
}

export function indexAfter(index: string | null): string {
  return generateKeyBetween(index, null)
}

export function indexBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b)
}

export function sortByIndex<T extends { index: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) =>
    a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
  )
}
