import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Config } from '../config'
import type { Db } from '../db/client'
import * as schema from '../db/schema'

export type Auth = ReturnType<typeof betterAuth>

/** Columns added to Better Auth's `user` table; the schema test reads them too. */
export const additionalUserFields = {
  plan: { type: 'string', defaultValue: 'free', input: false },
  stripeCustomerId: { type: 'string', required: false, input: false },
} as const

export interface AuthDeps {
  db: Db
  config: Config
  /** Called before a user row is deleted; wired fully in a later task. */
  beforeDelete?: (userId: string) => Promise<void>
}

/**
 * The Better Auth instance, or null when no accounts are configured:
 * a self-hosted server without OAuth secrets runs anonymous-only.
 *
 * `http.ts` mounts this at `/auth/*`, the same un-prefixed path Caddy
 * and the Vite dev proxy deliver after stripping the public `/api`
 * prefix (the pattern `/boards` and `/mcp` already use). Better Auth
 * ties its internal route matching directly to `baseURL`'s path, so
 * `baseURL` carries that same `/auth` path rather than `/api/auth`.
 * The one address that does need the public `/api` prefix is the OAuth
 * redirect URI sent to each provider, so that is set explicitly per
 * provider instead of through `baseURL`.
 */
export function createAuth(deps: AuthDeps): Auth | null {
  const { config } = deps
  const accounts = config.accounts
  if (!accounts) {
    return null
  }
  const base =
    config.publicUrl === '*' ? 'http://localhost:3000' : config.publicUrl
  const redirectURI = (provider: string) =>
    `${base}/api/auth/callback/${provider}`
  return betterAuth({
    baseURL: `${base}/auth`,
    secret: accounts.secret,
    trustedOrigins: config.corsOrigin === '*' ? undefined : [config.corsOrigin],
    database: drizzleAdapter(deps.db, { provider: 'pg', schema }),
    socialProviders: {
      ...(accounts.github
        ? { github: { ...accounts.github, redirectURI: redirectURI('github') } }
        : {}),
      ...(accounts.google
        ? { google: { ...accounts.google, redirectURI: redirectURI('google') } }
        : {}),
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['github', 'google'],
      },
    },
    user: {
      additionalFields: additionalUserFields,
      deleteUser: {
        enabled: true,
        beforeDelete: async (user: { id: string }) => {
          await deps.beforeDelete?.(user.id)
        },
      },
    },
    // The inferred options type here is more specific than the default
    // `BetterAuthOptions` the `Auth` alias is pinned to (conditional
    // provider entries and `additionalFields` narrow it further than
    // Better Auth's own generics reconcile); the returned instance is
    // structurally the same `Auth`.
  }) as unknown as Auth
}

export interface SessionUser {
  id: string
  name: string
  email: string
  image: string | null
  plan: 'free' | 'pro'
  stripeCustomerId: string | null
}

export async function sessionUser(
  auth: Auth | null,
  headers: Headers,
): Promise<SessionUser | null> {
  if (!auth) {
    return null
  }
  const session = await auth.api.getSession({ headers })
  if (!session) {
    return null
  }
  // `Auth`'s erased generic loses the `plan` and `stripeCustomerId`
  // additional fields configured in `createAuth`; the schema (and the
  // failing test in their absence) guarantees they are actually there.
  const user = session.user as unknown as SessionUser & { plan?: string }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    plan: user.plan === 'pro' ? 'pro' : 'free',
    stripeCustomerId: user.stripeCustomerId ?? null,
  }
}
