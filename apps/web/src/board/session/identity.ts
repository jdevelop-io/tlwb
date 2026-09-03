import type { Me } from '../../auth/client'
import { STROKE_COLORS } from './palette'

export interface Identity {
  name: string
  color: string
}

const KEY = 'tlwb:identity'
const ADJECTIVES = ['Curious', 'Quiet', 'Brave', 'Sunny', 'Clever', 'Gentle']
const ANIMALS = ['Otter', 'Fox', 'Heron', 'Panda', 'Lynx', 'Koala']
const MARKERS = STROKE_COLORS.slice(1)

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T
}

export function loadIdentity(
  storage: Storage = localStorage,
  random: () => number = Math.random,
): Identity {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? 'null')
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'name' in parsed &&
      typeof parsed.name === 'string' &&
      'color' in parsed &&
      typeof parsed.color === 'string'
    ) {
      return { name: parsed.name, color: parsed.color }
    }
  } catch {
    // A corrupt entry is replaced below.
  }
  const identity = {
    name: `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`,
    color: pick(MARKERS, random),
  }
  saveIdentity(identity, storage)
  return identity
}

export function saveIdentity(
  identity: Identity,
  storage: Storage = localStorage,
): void {
  storage.setItem(KEY, JSON.stringify(identity))
}

/**
 * Presence identity for the seam between the browser identity and the
 * account: signed in, the account name replaces the local one but the
 * chosen marker color stays; signed out (or no accounts on this
 * deployment), the local identity is unchanged.
 */
export function identityFor(identity: Identity, me: Me | null): Identity {
  return me ? { name: me.name, color: identity.color } : identity
}
