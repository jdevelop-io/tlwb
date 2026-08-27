export interface StoredKeys {
  editKey?: string
  viewKey?: string
}

export type BoardRole = 'local' | 'edit' | 'view'

const KEYS_PREFIX = 'tlwb:keys:'
const ALIAS_PREFIX = 'tlwb:alias:'

export function readKeys(
  boardId: string,
  storage: Storage = localStorage,
): StoredKeys | null {
  const raw = storage.getItem(KEYS_PREFIX + boardId)
  if (!raw) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const keys: StoredKeys = {}
    if ('editKey' in parsed && typeof parsed.editKey === 'string') {
      keys.editKey = parsed.editKey
    }
    if ('viewKey' in parsed && typeof parsed.viewKey === 'string') {
      keys.viewKey = parsed.viewKey
    }
    return keys
  } catch {
    return null
  }
}

export function writeKeys(
  boardId: string,
  keys: StoredKeys,
  storage: Storage = localStorage,
): void {
  storage.setItem(KEYS_PREFIX + boardId, JSON.stringify(keys))
}

export function clearKeys(
  boardId: string,
  storage: Storage = localStorage,
): void {
  storage.removeItem(KEYS_PREFIX + boardId)
}

export function roleOf(keys: StoredKeys | null): BoardRole {
  if (keys?.editKey) {
    return 'edit'
  }
  if (keys?.viewKey) {
    return 'view'
  }
  return 'local'
}

export function tokenOf(keys: StoredKeys): string | null {
  return keys.editKey ?? keys.viewKey ?? null
}

/** `#edit=<key>` or `#view=<key>`; anything else is not ours. */
export function keysFromFragment(hash: string): StoredKeys | null {
  const match = /^#(edit|view)=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!match) {
    return null
  }
  return match[1] === 'edit' ? { editKey: match[2] } : { viewKey: match[2] }
}

export function shareLink(
  origin: string,
  boardId: string,
  keys: StoredKeys,
  role: 'edit' | 'view',
): string | null {
  const key = role === 'edit' ? keys.editKey : keys.viewKey
  return key ? `${origin}/b/${boardId}#${role}=${key}` : null
}

export function readAlias(
  boardId: string,
  storage: Storage = localStorage,
): string | null {
  return storage.getItem(ALIAS_PREFIX + boardId)
}

export function writeAlias(
  oldId: string,
  newId: string,
  storage: Storage = localStorage,
): void {
  storage.setItem(ALIAS_PREFIX + oldId, newId)
}

export function clearAliasesTo(
  boardId: string,
  storage: Storage = localStorage,
): void {
  const doomed: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key?.startsWith(ALIAS_PREFIX) && storage.getItem(key) === boardId) {
      doomed.push(key)
    }
  }
  for (const key of doomed) {
    storage.removeItem(key)
  }
}
