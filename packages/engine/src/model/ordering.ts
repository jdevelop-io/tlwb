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

/**
 * Sorts back to front by fractional index, breaking ties on id. Two
 * peers inserting at the same place generate the same key, so without
 * the tiebreak their z-order would depend on local iteration order and
 * diverge on the same document.
 */
export function sortByIndex<T extends { index: string; id: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) =>
    a.index < b.index
      ? -1
      : a.index > b.index
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  )
}
