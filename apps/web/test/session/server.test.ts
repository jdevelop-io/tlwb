import { describe, expect, it, vi } from 'vitest'
import {
  createHostedBoard,
  fetchAsset,
  requestAdoption,
  ServerError,
  socketUrl,
  uploadAsset,
} from '../../src/board/session/server'

function respond(status: number, body?: unknown, type = 'application/json') {
  return vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': type },
      }),
  ) as unknown as typeof fetch
}

describe('server client', () => {
  it('creates a hosted board with a relative POST', async () => {
    const fetchFn = respond(201, { boardId: 'b', editKey: 'e', viewKey: 'v' })
    expect(await createHostedBoard(fetchFn)).toEqual({
      boardId: 'b',
      editKey: 'e',
      viewKey: 'v',
    })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe('/api/boards')
    expect(init.method).toBe('POST')
  })

  it('throws a ServerError carrying the status', async () => {
    await expect(createHostedBoard(respond(429))).rejects.toBeInstanceOf(
      ServerError,
    )
    await expect(createHostedBoard(respond(429))).rejects.toMatchObject({
      status: 429,
    })
  })

  it('uploads an asset with the edit key and its content type', async () => {
    const fetchFn = respond(201)
    await uploadAsset(
      'b',
      'h',
      new Blob(['x'], { type: 'image/png' }),
      'e',
      fetchFn,
    )
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe('/api/boards/b/assets/h')
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer e')
    expect(new Headers(init.headers).get('content-type')).toBe('image/png')
  })

  it('fetches an asset and answers null on 404', async () => {
    const found = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    ) as unknown as typeof fetch
    const blob = await fetchAsset('b', 'h', 'v', found)
    expect(blob?.type).toBe('image/png')
    expect(await fetchAsset('b', 'h', 'v', respond(404))).toBeNull()
  })

  it('posts the boards list and returns the adoption result', async () => {
    const fetchFn = respond(200, {
      adopted: ['b1'],
      skipped: ['b2'],
    })
    const result = await requestAdoption(
      [{ boardId: 'b1', editKey: 'e1' }],
      fetchFn,
    )
    expect(result).toEqual({ adopted: ['b1'], skipped: ['b2'] })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe('/api/boards/adopt')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      boards: [{ boardId: 'b1', editKey: 'e1' }],
    })
  })

  it('answers empty rather than throwing when signed out', async () => {
    expect(
      await requestAdoption([{ boardId: 'b1', editKey: 'e1' }], respond(401)),
    ).toEqual({ adopted: [], skipped: [] })
  })

  it('throws a ServerError on an unexpected status', async () => {
    await expect(
      requestAdoption([{ boardId: 'b1', editKey: 'e1' }], respond(500)),
    ).rejects.toBeInstanceOf(ServerError)
  })

  it('derives the socket url from the page origin', () => {
    expect(socketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    )
    expect(socketUrl({ protocol: 'https:', host: 'tlwb.app' })).toBe(
      'wss://tlwb.app/ws',
    )
  })
})
