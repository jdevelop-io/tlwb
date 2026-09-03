import { createHmac, randomUUID } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'
import postgres from 'postgres'

// Kept in lockstep with playwright.config.ts's `AUTH_SECRET` for the
// collab-server webServer: both have to sign with the same secret for
// a seeded cookie to verify.
const AUTH_SECRET = 'e2e-secret-at-least-32-characters!!!'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

/**
 * Builds a `Cookie` header value Better Auth 1.7.2 accepts as a signed
 * `better-auth.session_token` cookie. Ported verbatim from
 * apps/collab-server/test/session-cookie.ts (same format, same secret):
 * the signature is a standard (padded) base64 HMAC-SHA256 of the token,
 * not base64url as `better-call`'s `getSignedCookie` (which Better
 * Auth's session route calls) requires the signature to be exactly 44
 * characters and end in `=`, a shape only padded base64 of a 32-byte
 * digest has.
 */
export function sessionCookie(token: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`
}

export interface SeededUser {
  id: string
  name: string
  email: string
}

export interface SeededSession {
  user: SeededUser
  token: string
}

/**
 * Inserts a `user` row and a `session` row straight into Postgres --
 * the same tables Better Auth reads from -- so a journey can start
 * signed in without ever driving an OAuth redirect. Returns the raw
 * session token; `addSessionCookie` turns it into a cookie for
 * whichever browser context should carry it (seeding the row is kept
 * separate from adding the cookie so the same session can be attached
 * to more than one context, e.g. to prove ownership grants edit access
 * with no local storage involved).
 */
export async function seedSession(
  overrides: Partial<SeededUser> = {},
): Promise<SeededSession> {
  const sql = postgres(databaseUrl)
  try {
    const user: SeededUser = {
      id: randomUUID(),
      name: 'E2E Otter',
      email: `e2e-${randomUUID()}@example.com`,
      ...overrides,
    }
    await sql`
      insert into "user" (id, name, email, email_verified)
      values (${user.id}, ${user.name}, ${user.email}, true)
    `
    const token = randomUUID()
    await sql`
      insert into session (id, token, user_id, expires_at)
      values (
        ${randomUUID()},
        ${token},
        ${user.id},
        ${new Date(Date.now() + 60 * 60 * 1000)}
      )
    `
    return { user, token }
  } finally {
    await sql.end()
  }
}

/** Adds the signed session cookie for `token` to a browser context. */
export async function addSessionCookie(
  context: BrowserContext,
  token: string,
): Promise<void> {
  const cookie = sessionCookie(token, AUTH_SECRET)
  const value = cookie.slice(cookie.indexOf('=') + 1)
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value,
      url: 'http://localhost:5173',
      httpOnly: true,
    },
  ])
}
