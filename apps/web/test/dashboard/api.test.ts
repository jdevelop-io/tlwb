import { describe, expect, it } from 'vitest'
import { ServerError } from '../../src/board/session/server'
import {
  createApiKey,
  deleteBoard,
  fetchApiKeys,
  fetchBoards,
  fetchMe,
  fetchUsage,
  revokeApiKey,
  startCheckout,
} from '../../src/dashboard/api'

function respond(status: number, body?: unknown) {
  return async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
}

describe('dashboard api', () => {
  it('maps a 401 to null instead of throwing', async () => {
    expect(await fetchMe(respond(401))).toBeNull()
  })

  it('returns the session on a signed-in fetchMe', async () => {
    const me = {
      user: {
        name: 'Ada',
        email: 'ada@example.com',
        image: null,
        plan: 'free',
      },
      billing: true,
    }
    expect(await fetchMe(respond(200, me))).toEqual(me)
  })

  it('returns the boards and cap from fetchBoards', async () => {
    const payload = { boards: [], cap: 10 }
    expect(await fetchBoards(respond(200, payload))).toEqual(payload)
  })

  it('returns the id and key from createApiKey', async () => {
    expect(
      await createApiKey(
        { name: 'Claude', boardIds: null },
        respond(201, { id: 'k1', key: 'sk_test' }),
      ),
    ).toEqual({ id: 'k1', key: 'sk_test' })
  })

  it('omits boardIds from the request body when scoped to all boards', async () => {
    let seenBody: string | undefined
    const fetchFn: typeof fetch = async (_url, init) => {
      seenBody = init?.body as string | undefined
      return new Response(JSON.stringify({ id: 'k1', key: 'sk_test' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }
    await createApiKey({ name: 'Claude', boardIds: null }, fetchFn)
    expect(seenBody).toBe(JSON.stringify({ name: 'Claude' }))
  })

  it('sends boardIds in the request body when scoped to specific boards', async () => {
    let seenBody: string | undefined
    const fetchFn: typeof fetch = async (_url, init) => {
      seenBody = init?.body as string | undefined
      return new Response(JSON.stringify({ id: 'k1', key: 'sk_test' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }
    await createApiKey({ name: 'Claude', boardIds: ['b1'] }, fetchFn)
    expect(seenBody).toBe(JSON.stringify({ name: 'Claude', boardIds: ['b1'] }))
  })

  it('returns the keys from fetchApiKeys', async () => {
    const keys = [
      {
        id: 'k1',
        name: 'Claude',
        boardIds: null,
        createdAt: '2026-09-01T00:00:00Z',
        lastUsedAt: null,
      },
    ]
    expect(await fetchApiKeys(respond(200, { keys }))).toEqual(keys)
  })

  it('returns the month, count and limit from fetchUsage', async () => {
    const usage = { month: '2026-09', count: 12, limit: 200 }
    expect(await fetchUsage(respond(200, usage))).toEqual(usage)
  })

  it('resolves on a successful revokeApiKey', async () => {
    await expect(revokeApiKey('k1', respond(204))).resolves.toBeUndefined()
  })

  it('throws a ServerError instead of resolving on a failed revokeApiKey', async () => {
    await expect(revokeApiKey('k1', respond(404))).rejects.toBeInstanceOf(
      ServerError,
    )
  })

  it('posts the interval and returns the checkout url', async () => {
    let seenUrl: string | undefined
    let seenBody: string | undefined
    const fetchFn: typeof fetch = async (url, init) => {
      seenUrl = String(url)
      seenBody = init?.body as string | undefined
      return new Response(JSON.stringify({ url: 'https://stripe.example/x' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const url = await startCheckout('year', fetchFn)
    expect(url).toBe('https://stripe.example/x')
    expect(seenUrl).toBe('/api/billing/checkout')
    expect(seenBody).toBe(JSON.stringify({ interval: 'year' }))
  })

  it('throws a ServerError instead of resolving on a failed delete', async () => {
    await expect(deleteBoard('b1', respond(403))).rejects.toBeInstanceOf(
      ServerError,
    )
  })
})
