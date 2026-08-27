import { randomBytes } from 'node:crypto'
import { createBoard } from './db/boards'
import type { Db } from './db/client'
import { generateKey, hashKey } from './keys'

export interface IssuedBoard {
  boardId: string
  editKey: string
  viewKey: string
}

/**
 * A new hosted board: a server-issued id (16 random bytes, base64url,
 * 22 characters) and two keys shown once and stored hashed. Null on the
 * one-in-2^128 id collision, which is not worth a retry loop.
 */
export async function issueBoard(db: Db): Promise<IssuedBoard | null> {
  const boardId = randomBytes(16).toString('base64url')
  const editKey = generateKey()
  const viewKey = generateKey()
  const outcome = await createBoard(db, boardId, {
    editKeyHash: hashKey(editKey),
    viewKeyHash: hashKey(viewKey),
  })
  return outcome === 'exists' ? null : { boardId, editKey, viewKey }
}
