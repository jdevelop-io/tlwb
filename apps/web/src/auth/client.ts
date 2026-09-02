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

/** null when signed out OR when the deployment has no accounts. */
export async function fetchSession(
  fetchFn: typeof fetch = fetch,
): Promise<Me | null> {
  try {
    const response = await fetchFn('/api/auth/get-session')
    if (response.status !== 200) {
      return null
    }
    const body = (await response.json()) as SessionResponse | null
    if (!body) {
      return null
    }
    return {
      name: body.user.name,
      email: body.user.email,
      image: body.user.image ?? null,
      plan: body.user.plan === 'pro' ? 'pro' : 'free',
    }
  } catch {
    // Covers a thrown network error and any malformed response body:
    // a deployment without accounts configured must read as signed
    // out, never as an error.
    return null
  }
}
