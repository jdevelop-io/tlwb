import { describe, expect, it } from 'vitest'
import { ServerError } from '../../src/board/session/server'
import {
  createApiKey,
  deleteBoard,
  fetchBoards,
  fetchMe,
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

  it('returns the key from createApiKey', async () => {
    expect(await createApiKey(respond(201, { key: 'sk_test' }))).toBe('sk_test')
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
