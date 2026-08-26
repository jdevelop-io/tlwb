import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export type Role = 'edit' | 'view'

export interface KeyHashes {
  editKeyHash: Uint8Array
  viewKeyHash: Uint8Array
}

/** 32 random bytes, base64url: the only time the clear key exists. */
export function generateKey(): string {
  return randomBytes(32).toString('base64url')
}

export function hashKey(key: string): Buffer {
  return createHash('sha256').update(key).digest()
}

function matches(presented: Buffer, stored: Uint8Array): boolean {
  return (
    presented.length === stored.length && timingSafeEqual(presented, stored)
  )
}

/** The role a token grants, or null when it matches neither key. */
export function resolveRole(token: string, hashes: KeyHashes): Role | null {
  if (token.length === 0) {
    return null
  }
  const presented = hashKey(token)
  if (matches(presented, hashes.editKeyHash)) {
    return 'edit'
  }
  if (matches(presented, hashes.viewKeyHash)) {
    return 'view'
  }
  return null
}
