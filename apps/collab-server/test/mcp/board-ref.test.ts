import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBoard } from '../../src/db/boards'
import { connectDatabase } from '../../src/db/client'
import { generateKey, hashKey } from '../../src/keys'
import {
  BOARD_URL_HELP,
  parseBoardRef,
  resolveBoardRole,
} from '../../src/mcp/board-ref'
import { ToolError } from '../../src/mcp/tool-error'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

describe('parseBoardRef', () => {
  it('reads the board id and the key from an edit or a view link', () => {
    expect(
      parseBoardRef('https://tlwb.example/b/abcdefgh12345678#edit=k1'),
    ).toEqual({ boardId: 'abcdefgh12345678', key: 'k1' })
    expect(parseBoardRef('http://localhost:8080/b/abcdefgh#view=k2')).toEqual({
      boardId: 'abcdefgh',
      key: 'k2',
    })
  })

  it('accepts any host', () => {
    expect(
      parseBoardRef('https://boards.acme.internal/b/abcdefgh#edit=k').boardId,
    ).toBe('abcdefgh')
  })

  // What `create_board` returns when `PUBLIC_URL` is unset and
  // `CORS_ORIGIN` is `*`: no host to build a full URL from.
  it('accepts a host-less reference', () => {
    expect(parseBoardRef('/b/abcdefgh12345678#edit=k1')).toEqual({
      boardId: 'abcdefgh12345678',
      key: 'k1',
    })
  })

  it.each([
    'not a url',
    'https://tlwb.example/b/abcdefgh',
    'https://tlwb.example/b/abcdefgh#k=key',
    'https://tlwb.example/b/abcdefgh?edit=key',
    'https://tlwb.example/b/abcdefgh?x=1#edit=key',
    'https://tlwb.example/boards/abcdefgh#edit=key',
    'https://tlwb.example/b/short#edit=key',
  ])('refuses %s with the help text', (input) => {
    expect(() => parseBoardRef(input)).toThrow(new ToolError(BOARD_URL_HELP))
  })
})

describe('resolveBoardRole', () => {
  it('resolves edit and view keys against the stored hashes', async () => {
    const boardId = `ref${Date.now()}`
    const editKey = generateKey()
    const viewKey = generateKey()
    await createBoard(database.db, boardId, {
      editKeyHash: hashKey(editKey),
      viewKeyHash: hashKey(viewKey),
    })
    await expect(
      resolveBoardRole(database.db, { boardId, key: editKey }),
    ).resolves.toBe('edit')
    await expect(
      resolveBoardRole(database.db, { boardId, key: viewKey }),
    ).resolves.toBe('view')
  })

  it('names the board in the not-found and the wrong-key errors', async () => {
    await expect(
      resolveBoardRole(database.db, { boardId: 'missing1', key: 'k' }),
    ).rejects.toThrow(new ToolError('board missing1 not found'))
    const boardId = `wrong${Date.now()}`
    await createBoard(database.db, boardId, {
      editKeyHash: hashKey(generateKey()),
      viewKeyHash: hashKey(generateKey()),
    })
    await expect(
      resolveBoardRole(database.db, { boardId, key: 'nope' }),
    ).rejects.toThrow(new ToolError(`key does not match board ${boardId}`))
  })
})
