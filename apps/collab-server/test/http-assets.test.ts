import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { connectDatabase } from '../src/db/client'
import { createApp } from '../src/http'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  database = await connectDatabase(url)
  app = createApp({
    db: database.db,
    config: loadConfig({
      DATABASE_URL: url,
      CORS_ORIGIN: 'http://a',
      MAX_ASSET_BYTES: '64',
    }),
  })
})

afterAll(async () => {
  await database.close()
})

async function board() {
  const response = await app.request('http://server/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId: randomUUID() }),
  })
  return (await response.json()) as {
    boardId: string
    editKey: string
    viewKey: string
  }
}

const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
const hash = createHash('sha256').update(bytes).digest('hex')

function put(
  boardId: string,
  key: string,
  body: Uint8Array<ArrayBuffer>,
  type = 'image/png',
  at = hash,
) {
  return app.request(`http://server/boards/${boardId}/assets/${at}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, 'content-type': type },
    body,
  })
}

function get(boardId: string, key: string, at = hash) {
  return app.request(`http://server/boards/${boardId}/assets/${at}`, {
    headers: { authorization: `Bearer ${key}` },
  })
}

describe('assets', () => {
  it('stores with the edit key, serves with either key, immutable', async () => {
    const { boardId, editKey, viewKey } = await board()
    expect((await put(boardId, editKey, bytes)).status).toBe(201)
    expect((await put(boardId, editKey, bytes)).status).toBe(200)
    const response = await get(boardId, viewKey)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect((await get(boardId, editKey)).status).toBe(200)
  })

  it('refuses the view key on PUT and a wrong key on GET', async () => {
    const { boardId, editKey, viewKey } = await board()
    expect((await put(boardId, viewKey, bytes)).status).toBe(401)
    await put(boardId, editKey, bytes)
    expect((await get(boardId, 'nope')).status).toBe(401)
    const missing = await app.request(
      `http://server/boards/${boardId}/assets/${hash}`,
    )
    expect(missing.status).toBe(401)
  })

  it('answers 400 on a hash mismatch, 415 on a non-image, 413 past the limit, 404 when absent', async () => {
    const { boardId, editKey } = await board()
    expect(
      (await put(boardId, editKey, bytes, 'image/png', 'a'.repeat(64))).status,
    ).toBe(400)
    expect((await put(boardId, editKey, bytes, 'text/plain')).status).toBe(415)
    const big = new Uint8Array(65)
    const bigHash = createHash('sha256').update(big).digest('hex')
    expect(
      (await put(boardId, editKey, big, 'image/png', bigHash)).status,
    ).toBe(413)
    expect((await get(boardId, editKey)).status).toBe(404)
    expect((await get(randomUUID(), editKey)).status).toBe(401)
  })
})
