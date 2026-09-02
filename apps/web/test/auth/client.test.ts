import { describe, expect, it } from 'vitest'
import { fetchSession } from '../../src/auth/client'

describe('fetchSession', () => {
  it('maps a session payload to Me', async () => {
    const me = await fetchSession(async () =>
      Response.json({
        user: {
          name: 'Ada',
          email: 'ada@example.com',
          image: null,
          plan: 'pro',
        },
      }),
    )
    expect(me).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      image: null,
      plan: 'pro',
    })
  })

  it('resolves null on a non-200 response, even with a well-formed body', async () => {
    expect(
      await fetchSession(async () =>
        Response.json(
          { user: { name: 'Ada', email: 'a@x.io' } },
          { status: 500 },
        ),
      ),
    ).toBeNull()
  })

  it('resolves null on a 404 (a deployment without accounts configured)', async () => {
    expect(
      await fetchSession(async () => new Response('', { status: 404 })),
    ).toBeNull()
  })

  it('resolves null on a null body', async () => {
    expect(await fetchSession(async () => Response.json(null))).toBeNull()
  })

  it('resolves null when the fetch throws', async () => {
    expect(
      await fetchSession(async () => {
        throw new Error('offline')
      }),
    ).toBeNull()
  })

  it('defaults a missing plan to free', async () => {
    const me = await fetchSession(async () =>
      Response.json({ user: { name: 'Ada', email: 'a@x.io' } }),
    )
    expect(me?.plan).toBe('free')
  })
})
