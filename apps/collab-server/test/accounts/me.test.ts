import { randomUUID } from 'node:crypto'
import { createBoardDoc, createYjsBoardStore } from '@tlwb/store-yjs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { loadConfig } from '../../src/config'
import { compactBoard, findBoard, markShared } from '../../src/db/boards'
import { connectDatabase, type Database } from '../../src/db/client'
import {
  assets,
  boards,
  boardUpdates,
  session,
  user,
} from '../../src/db/schema'
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
    FREE_BOARD_CAP: '10',
    ...overrides,
  })
  return createApp({
    db: database.db,
    config,
    rooms: createRooms({ db: database.db, config }),
  })
}

async function createUser(
  name: string,
  email: string,
  plan: 'free' | 'pro' = 'free',
): Promise<string> {
  const id = randomUUID()
  await database.db.insert(user).values({ id, name, email, plan })
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

/** Sets a board's persisted name directly, without a live room. */
async function nameBoard(boardId: string, name: string): Promise<void> {
  const doc = createBoardDoc()
  createYjsBoardStore(doc).setMeta({ name })
  await compactBoard(database.db, boardId, Y.encodeStateAsUpdate(doc), 1)
  doc.destroy()
}

describe('GET /me', () => {
  it('answers 401 signed out and the profile signed in', async () => {
    const a = app()
    expect((await a.request('http://server/me')).status).toBe(401)

    const email = `ada-${randomUUID()}@example.com`
    const userA = await createUser('Ada', email)
    const cookie = await cookieFor(userA)
    const response = await a.request('http://server/me', {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      user: { name: 'Ada', email, image: null, plan: 'free' },
      billing: false,
    })
  })
})

describe('GET /me/boards', () => {
  it('lists owned boards with their names, most recently updated first', async () => {
    const a = app()
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)

    const created = await a.request('http://server/boards', {
      method: 'POST',
      headers: { cookie },
    })
    const untitled = (await created.json()) as Issued

    const named = await ownedBoard(userA)
    await nameBoard(named, 'Roadmap')

    const response = await a.request('http://server/me/boards', {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      boards: { id: string; name: string }[]
      cap: number | null
    }
    expect(body.cap).toBe(10)
    expect(body.boards.map((b) => ({ id: b.id, name: b.name }))).toEqual([
      { id: named, name: 'Roadmap' },
      { id: untitled.boardId, name: 'Untitled' },
    ])
  })

  it('reports cap null for a pro user', async () => {
    const a = app()
    const userA = await createUser(
      'Pro',
      `pro-${randomUUID()}@example.com`,
      'pro',
    )
    const cookie = await cookieFor(userA)

    const response = await a.request('http://server/me/boards', {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    expect((await response.json()).cap).toBeNull()
  })

  it('flags shared and agent-touched boards, and leaves untouched ones false', async () => {
    const a = app()
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)

    const untouched = await ownedBoard(userA)
    const shared = await ownedBoard(userA)
    await markShared(database.db, shared)
    const withAgent = await ownedBoard(userA)
    await database.db
      .update(boards)
      .set({ agentAt: new Date() })
      .where(eq(boards.id, withAgent))

    const response = await a.request('http://server/me/boards', {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      boards: { id: string; shared: boolean; agent: boolean }[]
    }
    const byId = new Map(body.boards.map((b) => [b.id, b]))
    expect(byId.get(untouched)).toMatchObject({ shared: false, agent: false })
    expect(byId.get(shared)).toMatchObject({ shared: true, agent: false })
    expect(byId.get(withAgent)).toMatchObject({ shared: false, agent: true })
  })

  it('does not list anonymous or foreign boards', async () => {
    const a = app()
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const userB = await createUser('Bob', `bob-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)

    const first = await ownedBoard(userA)
    const second = await ownedBoard(userA)
    await ownedBoard(userB)
    await issueAnonymousBoard(a)

    const response = await a.request('http://server/me/boards', {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { boards: { id: string }[] }
    expect(new Set(body.boards.map((b) => b.id))).toEqual(
      new Set([first, second]),
    )
  })

  it('requires a session', async () => {
    const a = app()
    const response = await a.request('http://server/me/boards')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'sign in required' })
  })
})

describe('DELETE /boards/:boardId', () => {
  it('purges an owned board, its updates and its assets', async () => {
    const a = app()
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)
    const boardId = await ownedBoard(userA)
    await database.db
      .insert(boardUpdates)
      .values({ boardId, update: Buffer.from([1, 2, 3]) })
    await database.db.insert(assets).values({
      boardId,
      hash: 'a'.repeat(64),
      mime: 'image/png',
      bytes: Buffer.from([1]),
    })

    const response = await a.request(`http://server/boards/${boardId}`, {
      method: 'DELETE',
      headers: { cookie },
    })

    expect(response.status).toBe(204)
    expect(await findBoard(database.db, boardId)).toBeUndefined()
    expect(
      await database.db
        .select()
        .from(boardUpdates)
        .where(eq(boardUpdates.boardId, boardId)),
    ).toEqual([])
    expect(
      await database.db
        .select()
        .from(assets)
        .where(eq(assets.boardId, boardId)),
    ).toEqual([])
  })

  it('refuses non-owners', async () => {
    const a = app()
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const userB = await createUser('Bob', `bob-${randomUUID()}@example.com`)
    const cookieA = await cookieFor(userA)
    const cookieB = await cookieFor(userB)
    const boardId = await ownedBoard(userA)

    const anonymous = await a.request(`http://server/boards/${boardId}`, {
      method: 'DELETE',
    })
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({ error: 'sign in required' })

    const foreign = await a.request(`http://server/boards/${boardId}`, {
      method: 'DELETE',
      headers: { cookie: cookieB },
    })
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({ error: 'not your board' })
    expect((await findBoard(database.db, boardId))?.ownerId).toBe(userA)

    const unknown = await a.request(`http://server/boards/${randomUUID()}`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'unknown board' })
  })
})
