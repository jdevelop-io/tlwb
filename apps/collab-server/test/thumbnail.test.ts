import { randomUUID } from 'node:crypto'
import { createElement } from '@tlwb/engine'
import { createBoardDoc, createYjsBoardStore } from '@tlwb/store-yjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { loadConfig } from '../src/config'
import { appendUpdate, compactBoard, readThumbnail } from '../src/db/boards'
import { connectDatabase, type Database } from '../src/db/client'
import { boards, session, user } from '../src/db/schema'
import { createApp } from '../src/http'
import { generateKey, hashKey } from '../src/keys'
import { createRooms } from '../src/rooms'
import {
  boardThumbnail,
  THUMB_WIDTH,
  ThumbnailBudgetExceededError,
} from '../src/thumbnail'
import { sessionCookie } from './session-cookie'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

const AUTH_SECRET = 'test-secret-at-least-32-characters!!'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

let database: Database

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    AUTH_SECRET,
    GITHUB_CLIENT_ID: 'gid',
    GITHUB_CLIENT_SECRET: 'gsec',
    FREE_BOARD_CAP: '10',
    ...overrides,
  })
}

function app(overrides: Record<string, string> = {}) {
  const config = testConfig(overrides)
  return createApp({
    db: database.db,
    config,
    rooms: createRooms({ db: database.db, config }),
  })
}

async function createUser(name: string, email: string): Promise<string> {
  const id = randomUUID()
  await database.db.insert(user).values({ id, name, email, plan: 'free' })
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

/** A board inserted directly, owned, with no live room. */
async function ownedBoard(ownerId?: string): Promise<string> {
  const boardId = randomUUID()
  await database.db.insert(boards).values({
    id: boardId,
    editKeyHash: hashKey(generateKey()),
    viewKeyHash: hashKey(generateKey()),
    ownerId,
  })
  return boardId
}

function rectangle(id: string, x: number): ReturnType<typeof createElement> {
  return createElement('rectangle', {
    index: 'a0',
    id,
    x,
    y: 0,
    width: 100,
    height: 50,
  })
}

/** Seeds a board with one rectangle, compacted at seq 1; the live doc is
 * returned so a test can append further updates against the same state. */
async function seedBoard(boardId: string): Promise<Y.Doc> {
  const doc = createBoardDoc()
  createYjsBoardStore(doc).applyChanges([
    { kind: 'create', element: rectangle('r', 0) },
  ])
  await compactBoard(database.db, boardId, Y.encodeStateAsUpdate(doc), 1)
  return doc
}

/** Seeds a board with one 1000x1000 rectangle: over any low
 * MCP_MAX_IMAGE_PIXELS a test configures, same as the MCP screenshot
 * tool's own oversized-board tests. */
async function seedOversizedBoard(boardId: string): Promise<void> {
  const doc = createBoardDoc()
  createYjsBoardStore(doc).applyChanges([
    {
      kind: 'create',
      element: createElement('rectangle', {
        index: 'a0',
        id: 'big',
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
      }),
    },
  ])
  await compactBoard(database.db, boardId, Y.encodeStateAsUpdate(doc), 1)
  doc.destroy()
}

describe('boardThumbnail', () => {
  it('renders, caches, and serves a PNG for a board with content', async () => {
    const config = testConfig()
    const boardId = await ownedBoard()
    await seedBoard(boardId)

    const png = await boardThumbnail(database.db, config, boardId)

    expect(png).not.toBeNull()
    expect([...(png as Buffer).subarray(0, 4)]).toEqual(PNG_SIGNATURE)
    const cached = await readThumbnail(database.db, boardId)
    expect(cached.thumbnail).toEqual(png)
    expect(cached.thumbnailSeq).toBe(1)
  })

  it('reuses the cache until the board changes', async () => {
    const config = testConfig()
    const boardId = await ownedBoard()
    const doc = await seedBoard(boardId)

    const first = await boardThumbnail(database.db, config, boardId)
    expect(first).not.toBeNull()
    const cachedAfterFirst = await readThumbnail(database.db, boardId)
    expect(cachedAfterFirst.thumbnailSeq).toBe(1)

    // A cache hit must never consult the render budget: a callback that
    // throws when called proves no render is attempted.
    const second = await boardThumbnail(database.db, config, boardId, () => {
      throw new Error('render budget must not be spent on a cache hit')
    })
    expect(second).toEqual(first)
    const cachedAfterSecond = await readThumbnail(database.db, boardId)
    expect(cachedAfterSecond.thumbnailSeq).toBe(1)

    // Widening the board (a second, far-away rectangle) guarantees the
    // re-render produces different bytes, not just a different seq.
    const before = Y.encodeStateVector(doc)
    createYjsBoardStore(doc).applyChanges([
      { kind: 'create', element: rectangle('r2', 900) },
    ])
    const seq = await appendUpdate(
      database.db,
      boardId,
      Y.encodeStateAsUpdate(doc, before),
    )
    doc.destroy()

    let renderCalls = 0
    const third = await boardThumbnail(database.db, config, boardId, () => {
      renderCalls += 1
      return true
    })
    expect(renderCalls).toBe(1)
    expect(third).not.toBeNull()
    expect(third).not.toEqual(first)

    const cachedAfterThird = await readThumbnail(database.db, boardId)
    expect(cachedAfterThird.thumbnailSeq).toBe(seq)
    expect(cachedAfterThird.thumbnailSeq).not.toBe(1)
  })

  it('answers null for an empty board, without spending a render budget', async () => {
    const config = testConfig()
    const boardId = await ownedBoard()
    const png = await boardThumbnail(database.db, config, boardId, () => {
      throw new Error('render budget must not be spent on an empty board')
    })
    expect(png).toBeNull()
  })

  it('raises when the render budget is exhausted for a board that needs one', async () => {
    const config = testConfig()
    const boardId = await ownedBoard()
    await seedBoard(boardId)
    await expect(
      boardThumbnail(database.db, config, boardId, () => false),
    ).rejects.toBeInstanceOf(ThumbnailBudgetExceededError)
  })

  it('answers null for a board over the pixel budget, without spending a render budget', async () => {
    const config = testConfig({ MCP_MAX_IMAGE_PIXELS: '100000' })
    const boardId = await ownedBoard()
    await seedOversizedBoard(boardId)

    const png = await boardThumbnail(database.db, config, boardId, () => {
      throw new Error('render budget must not be spent over the pixel budget')
    })
    expect(png).toBeNull()
  })

  it('answers undefined-safe null for an unknown board', async () => {
    const config = testConfig()
    const png = await boardThumbnail(database.db, config, randomUUID())
    expect(png).toBeNull()
  })

  it('scales the thumbnail to THUMB_WIDTH', () => {
    expect(THUMB_WIDTH).toBe(400)
  })
})

describe('GET /me/boards/:boardId/thumbnail', () => {
  it('requires ownership: anonymous 401, non-owner 403, unknown 404', async () => {
    const a = app()
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const userB = await createUser('Bob', `bob-${randomUUID()}@example.com`)
    const boardId = await ownedBoard(userA)

    const anonymous = await a.request(
      `http://server/me/boards/${boardId}/thumbnail`,
    )
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({ error: 'sign in required' })

    const cookieB = await cookieFor(userB)
    const foreign = await a.request(
      `http://server/me/boards/${boardId}/thumbnail`,
      { headers: { cookie: cookieB } },
    )
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({ error: 'not your board' })

    const cookieA = await cookieFor(userA)
    const unknown = await a.request(
      `http://server/me/boards/${randomUUID()}/thumbnail`,
      { headers: { cookie: cookieA } },
    )
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'unknown board' })
  })

  it('answers 204 for an empty board and 200 image/png for one with content', async () => {
    const a = app()
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)
    const emptyBoard = await ownedBoard(userA)
    const filledBoard = await ownedBoard(userA)
    await seedBoard(filledBoard)

    const empty = await a.request(
      `http://server/me/boards/${emptyBoard}/thumbnail`,
      { headers: { cookie } },
    )
    expect(empty.status).toBe(204)
    expect(await empty.arrayBuffer()).toEqual(new ArrayBuffer(0))

    const filled = await a.request(
      `http://server/me/boards/${filledBoard}/thumbnail`,
      { headers: { cookie } },
    )
    expect(filled.status).toBe(200)
    expect(filled.headers.get('content-type')).toBe('image/png')
    expect(filled.headers.get('cache-control')).toBe('private, max-age=60')
    const bytes = new Uint8Array(await filled.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE)
  })

  it('answers 401 with no AUTH_SECRET configured, same as before this route existed', async () => {
    const config = loadConfig({
      DATABASE_URL: url,
      CORS_ORIGIN: 'http://a',
      FREE_BOARD_CAP: '10',
    })
    const a = createApp({
      db: database.db,
      config,
      rooms: createRooms({ db: database.db, config }),
    })
    const boardId = await ownedBoard()
    const response = await a.request(
      `http://server/me/boards/${boardId}/thumbnail`,
    )
    expect(response.status).toBe(401)
  })

  it('does not spend the render limiter on a cache hit', async () => {
    const a = app({ MCP_RENDER_LIMIT_PER_MIN: '1' })
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)
    const boardId = await ownedBoard(userA)
    await seedBoard(boardId)

    const first = await a.request(
      `http://server/me/boards/${boardId}/thumbnail`,
      { headers: { cookie } },
    )
    expect(first.status).toBe(200)

    // The single token was spent by the render above; a second request
    // for the same, unchanged board is a cache hit and must still
    // succeed rather than being refused for want of a token.
    const second = await a.request(
      `http://server/me/boards/${boardId}/thumbnail`,
      { headers: { cookie } },
    )
    expect(second.status).toBe(200)
  })

  it('answers 429 once the render limiter is spent on a board that needs a render', async () => {
    const a = app({ MCP_RENDER_LIMIT_PER_MIN: '1' })
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)
    const first = await ownedBoard(userA)
    const other = await ownedBoard(userA)
    await seedBoard(first)
    await seedBoard(other)

    const firstResponse = await a.request(
      `http://server/me/boards/${first}/thumbnail`,
      { headers: { cookie } },
    )
    expect(firstResponse.status).toBe(200)

    const secondResponse = await a.request(
      `http://server/me/boards/${other}/thumbnail`,
      { headers: { cookie } },
    )
    expect(secondResponse.status).toBe(429)
    expect(await secondResponse.json()).toEqual({
      error: 'too many renders, retry later',
    })
  })

  it('leaves the render limiter alone when a board is over the pixel budget', async () => {
    const a = app({
      MCP_RENDER_LIMIT_PER_MIN: '1',
      MCP_MAX_IMAGE_PIXELS: '100000',
    })
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)
    const big = await ownedBoard(userA)
    const small = await ownedBoard(userA)
    await seedOversizedBoard(big)
    await seedBoard(small)

    const bigResponse = await a.request(
      `http://server/me/boards/${big}/thumbnail`,
      { headers: { cookie } },
    )
    expect(bigResponse.status).toBe(204)

    // A refusal for size must not have cost a token: a board that fits
    // still renders afterwards, with the single token untouched.
    const smallResponse = await a.request(
      `http://server/me/boards/${small}/thumbnail`,
      { headers: { cookie } },
    )
    expect(smallResponse.status).toBe(200)
  })
})
