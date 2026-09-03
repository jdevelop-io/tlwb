import { createAuthClient } from 'better-auth/client'

// better-auth 1.7.2 validates an explicit `baseURL` as an absolute URL
// and throws on a relative one, even in a browser with a real origin.
// Its own unvalidated default already resolves to the relative
// '/api/auth' path this app needs, so the option is left unset rather
// than passed explicitly.
export const authClient = createAuthClient()

export interface Me {
  name: string
  email: string
  image: string | null
  plan: 'free' | 'pro'
}

interface SessionResponse {
  user: {
    name: string
    email: string
    image?: string | null
    plan?: string
  }
}

/**
 * Thrown instead of resolving `null` on a throttled session check: the
 * caller does not actually know this visitor is signed out, only that
 * the read was refused, and must not silently treat the two the same.
 */
export class SessionRateLimitedError extends Error {
  constructor() {
    super('session check was rate limited')
    this.name = 'SessionRateLimitedError'
  }
}

/**
 * null when signed out OR when the deployment has no accounts. Throws
 * `SessionRateLimitedError` on a 429, distinct from both: a throttled
 * read must never be read by a caller as a confirmed sign-out.
 */
export async function fetchSession(
  fetchFn: typeof fetch = fetch,
): Promise<Me | null> {
  let response: Response
  try {
    response = await fetchFn('/api/auth/get-session')
  } catch {
    // A thrown network error: a deployment without accounts configured
    // (or one genuinely unreachable) must read as signed out, never as
    // an error.
    return null
  }
  if (response.status === 429) {
    throw new SessionRateLimitedError()
  }
  if (response.status !== 200) {
    return null
  }
  try {
    const body = (await response.json()) as SessionResponse
    return {
      name: body.user.name,
      email: body.user.email,
      image: body.user.image ?? null,
      plan: body.user.plan === 'pro' ? 'pro' : 'free',
    }
  } catch {
    // A malformed response body, including a null body from a
    // signed-out session: reads as signed out, not as an error.
    return null
  }
}
