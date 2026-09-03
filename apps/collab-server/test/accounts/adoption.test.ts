import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config'
import { findBoard } from '../../src/db/boards'
import { connectDatabase, type Database } from '../../src/db/client'
import { boards, session, user } from '../../src/db/schema'
import { createApp } from '../../src/http'
import { generateKey, hashKey } from '../../src/keys'
import { createRooms } from '../../src/rooms'
import { sessionCookie } from '../session-cookie'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

const AUTH_SECRET = 'test-secret-at-least-32-characters!!'

let database: Database

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function app(overrides: Record<string, string> = {}) {
  const config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    AUTH_SECRET,
    GITHUB_CLIENT_ID: 'gid',
    GITHUB_CLIENT_SECRET: 'gsec',
    FREE_BOARD_CAP: '2',
    ...overrides,
  })
  return createApp({
    db: database.db,
    config,
    rooms: createRooms({ db: database.db, config }),
  })
}

async function createUser(plan: 'free' | 'pro' = 'free'): Promise<string> {
  const id = randomUUID()
  await database.db.insert(user).values({
    id,
    name: 'Test User',
    email: `${id}@example.com`,
    plan,
  })
  return id
}

async function cookieFor(userId: string): Promise<string> {
  const token = randomUUID()
  await database.db.insert(session).values({
    id: randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return sessionCookie(token, AUTH_SECRET)
}

/** A board inserted directly, already owned, with a known clear edit key. */
async function ownedBoard(ownerId: string): Promise<string> {
  const boardId = randomUUID()
  await database.db.insert(boards).values({
    id: boardId,
    editKeyHash: hashKey(generateKey()),
    viewKeyHash: hashKey(generateKey()),
    ownerId,
  })
  return boardId
}

interface Issued {
  boardId: string
  editKey: string
  viewKey: string
}

async function issueAnonymousBoard(a: ReturnType<typeof app>): Promise<Issued> {
  const response = await a.request('http://server/boards', { method: 'POST' })
  return (await response.json()) as Issued
}

function adopt(
  a: ReturnType<typeof app>,
  cookie: string | null,
  entries: { boardId: string; editKey: string }[],
) {
  return a.request('http://server/boards/adopt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ boards: entries }),
  })
}

describe('POST /boards/adopt', () => {
  it('adopts an unowned board when the edit key matches', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)
    const board = await issueAnonymousBoard(a)

    const response = await adopt(a, cookie, [
      { boardId: board.boardId, editKey: board.editKey },
    ])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      adopted: [board.boardId],
      skipped: [],
    })
    const stored = await findBoard(database.db, board.boardId)
    expect(stored?.ownerId).toBe(userA)
  })

  it('skips a board whose key is wrong or already owned', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)

    const board = await issueAnonymousBoard(a)
    const wrongKey = await adopt(a, cookie, [
      { boardId: board.boardId, editKey: board.viewKey },
    ])
    expect(wrongKey.status).toBe(200)
    expect(await wrongKey.json()).toEqual({
      adopted: [],
      skipped: [board.boardId],
    })
    expect((await findBoard(database.db, board.boardId))?.ownerId).toBeNull()

    const userB = await createUser()
    const othersBoard = await issueAnonymousBoard(a)
    const cookieB = await cookieFor(userB)
    await adopt(a, cookieB, [
      { boardId: othersBoard.boardId, editKey: othersBoard.editKey },
    ])
    const alreadyOwned = await adopt(a, cookie, [
      { boardId: othersBoard.boardId, editKey: othersBoard.editKey },
    ])
    expect(alreadyOwned.status).toBe(200)
    expect(await alreadyOwned.json()).toEqual({
      adopted: [],
      skipped: [othersBoard.boardId],
    })
    expect((await findBoard(database.db, othersBoard.boardId))?.ownerId).toBe(
      userB,
    )
  })

  it('is idempotent for the current owner', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)
    const board = await issueAnonymousBoard(a)

    await adopt(a, cookie, [{ boardId: board.boardId, editKey: board.editKey }])
    const second = await adopt(a, cookie, [
      { boardId: board.boardId, editKey: board.editKey },
    ])

    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({
      adopted: [board.boardId],
      skipped: [],
    })
  })

  it('stops adopting at the free cap', async () => {
    const a = app({ FREE_BOARD_CAP: '2' })
    const userA = await createUser()
    const cookie = await cookieFor(userA)
    await ownedBoard(userA)
    await ownedBoard(userA)
    const board = await issueAnonymousBoard(a)

    const response = await adopt(a, cookie, [
      { boardId: board.boardId, editKey: board.editKey },
    ])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      adopted: [],
      skipped: [board.boardId],
    })
    expect((await findBoard(database.db, board.boardId))?.ownerId).toBeNull()
  })

  it('requires a session', async () => {
    const a = app()
    const response = await adopt(a, null, [])
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'sign in required' })
  })

  it('rejects an invalid body', async () => {
    const a = app()
    const userA = await createUser()
    const cookie = await cookieFor(userA)

    const response = await a.request('http://server/boards/adopt', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ boards: [{ boardId: 'x', editKey: '' }] }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid body' })
  })

  it('adopts boards up to the cap in one call, then skips the rest', async () => {
    const a = app({ FREE_BOARD_CAP: '2' })
    const userA = await createUser()
    const cookie = await cookieFor(userA)
    await ownedBoard(userA)
    const first = await issueAnonymousBoard(a)
    const second = await issueAnonymousBoard(a)
    const third = await issueAnonymousBoard(a)

    const response = await adopt(a, cookie, [
      { boardId: first.boardId, editKey: first.editKey },
      { boardId: second.boardId, editKey: second.editKey },
      { boardId: third.boardId, editKey: third.editKey },
    ])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      adopted: [first.boardId],
      skipped: [second.boardId, third.boardId],
    })
    expect((await findBoard(database.db, first.boardId))?.ownerId).toBe(userA)
    expect((await findBoard(database.db, second.boardId))?.ownerId).toBeNull()
  })
})

describe('POST /boards with an account', () => {
  it('caps creation for a signed-in free user', async () => {
    const a = app({ FREE_BOARD_CAP: '2' })
    const userA = await createUser()
    const cookie = await cookieFor(userA)
    await ownedBoard(userA)
    await ownedBoard(userA)

    const capped = await a.request('http://server/boards', {
      method: 'POST',
      headers: { cookie },
    })
    expect(capped.status).toBe(403)
    expect(await capped.json()).toEqual({ error: 'board limit reached' })

    const anon = await a.request('http://server/boards', { method: 'POST' })
    expect(anon.status).toBe(201)
  })

  it('a pro user is uncapped', async () => {
    const a = app({ FREE_BOARD_CAP: '2' })
    const userA = await createUser('pro')
    const cookie = await cookieFor(userA)
    await ownedBoard(userA)
    await ownedBoard(userA)
    await ownedBoard(userA)

    const response = await a.request('http://server/boards', {
      method: 'POST',
      headers: { cookie },
    })
    expect(response.status).toBe(201)
    const { boardId } = await response.json()
    expect((await findBoard(database.db, boardId))?.ownerId).toBe(userA)
  })
})

describe('without accounts configured', () => {
  it('leaves POST /boards uncapped and POST /boards/adopt refused', async () => {
    const config = loadConfig({ DATABASE_URL: url, CORS_ORIGIN: 'http://a' })
    const noAuth = createApp({
      db: database.db,
      config,
      rooms: createRooms({ db: database.db, config }),
    })

    const created = await noAuth.request('http://server/boards', {
      method: 'POST',
    })
    expect(created.status).toBe(201)

    const adopted = await adopt(noAuth, null, [])
    expect(adopted.status).toBe(401)
  })
})
