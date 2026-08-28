# tlwb Accounts and Freemium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign-in with GitHub or Google, board ownership with automatic adoption of the browser's boards, a ten-board free cap, Pro through Stripe, an optional MCP API key with a monthly quota, and a dashboard.

**Architecture:** Two new modules inside `apps/collab-server` — `src/accounts/` (Better Auth on the existing Hono app, ownership, adoption, API keys, quota) and `src/billing/` (Stripe Checkout, Portal, webhook) — plus two new entries in `apps/web` (`/login`, `/dashboard`). Role resolution gains a second source: a session whose user owns the board grants `edit`. Everything degrades: without OAuth env vars accounts are disabled, without Stripe env vars billing is disabled.

**Tech Stack:** Node >= 22, TypeScript, Hono 4, Better Auth (latest 1.x) with its Drizzle adapter, Drizzle ORM 0.45 + postgres, Stripe Node SDK, zod 4, React 19 (dashboard), Vitest, Playwright.

**Spec:** `.claude/superpowers/specs/2026-08-28-tlwb-accounts-freemium-design.md`

## Global Constraints

- Node >= 22, pnpm 11 (root `packageManager`). Biome from the root: `pnpm check` must pass (single quotes, no semicolons, trailing commas, 80 columns, organized imports).
- Files, code, comments, commit messages in English; no em-dashes; gitmoji + Conventional Commits; never add Claude attribution; never cite the plan or the spec in a commit message.
- Server tests run against Postgres: `docker compose up -d postgres` first; `DATABASE_URL` defaults to `postgres://tlwb:tlwb@localhost:5432/tlwb` in `apps/collab-server/vitest.config.ts` (`fileParallelism: false`). Run: `pnpm --filter @tlwb/collab-server test -- <file>`; typecheck: `pnpm --filter @tlwb/collab-server typecheck`.
- Web tests: `pnpm --filter @tlwb/web test -- <file>` (Vitest, happy-dom, fake-indexeddb); e2e: `pnpm --filter @tlwb/web e2e`.
- The web app calls `/api/*`; the Vite proxy and Caddy strip the `/api` prefix, so server routes live at the root (`/boards`, `/auth/*`, `/me/*`, `/billing/*`).
- Keys (board and API) travel only in fragments or Authorization headers, never in query strings, and are stored hashed (SHA-256); never log a key.
- Every anticipated MCP failure is a tool result with `isError: true` and one explicit text; unexpected failures answer `internal error` with one JSON log line (`guarded` in `src/mcp/tool-error.ts` already does this).
- New environment variables are all optional: a server started without them behaves exactly as before this work.

## Existing code the tasks rely on (read before starting)

- `apps/collab-server/src/config.ts`: `loadConfig(env)` with `required`/`integer`/`boolean` helpers; throws `ConfigError`.
- `apps/collab-server/src/keys.ts`: `generateKey()` (32 bytes base64url), `hashKey(key): Buffer`, `resolveRole(token, hashes): 'edit' | 'view' | null`, `type Role`.
- `apps/collab-server/src/db/schema.ts`: `boards`, `boardUpdates`, `assets` tables; `bytea` custom type; `apps/collab-server/src/db/boards.ts`: `createBoard`, `findBoard`, `appendUpdate`, `loadBoard`, `compactBoard`.
- `apps/collab-server/src/http.ts`: `createApp(deps: HttpDeps)`, `clientIp(c, trustProxy)`, `roleFromBearer`, routes `POST /boards`, assets PUT/GET, `/mcp` mount, `app.onError` JSON shape.
- `apps/collab-server/src/ws.ts`: upgrade on `/ws/:boardId?token=`, `resolve(upgrade)` returns `Role | closeCode`.
- `apps/collab-server/src/issue-board.ts`: `issueBoard(db): Promise<IssuedBoard | null>`.
- `apps/collab-server/src/rooms.ts`: `createRooms({ db, config }): RoomRegistry` (`acquire`, `release`, `shutdown`).
- `apps/collab-server/src/mcp/`: `createMcpApp(deps)`, `createMcpServer(deps, ip)`, `board-ref.ts` (`parseBoardRef`, `resolveBoardRole`), `tool-error.ts` (`ToolError`, `guarded`, `jsonResult`), `render.ts` (`renderPng`, `loadImages`, `exceedsPixelBudget`, `imageBlock`), six tools in `tools/`.
- `apps/collab-server/src/rate-limit.ts`: `createIpLimiter(limit, windowMs, now): IpLimiter` with `take(ip)`.
- `apps/web/src/board/session/keys.ts`: `readKeys`, `writeKeys`, `StoredKeys`, `keysFromFragment`; `session/recents.ts`: `listRecents`, `touchRecent`, `removeRecent`; `session/share.ts`: `shareBoard(session, deps)`; `session/server.ts`: `createHostedBoard`, `ServerError`; `session/identity.ts`: `loadIdentity`, `saveIdentity`.
- `apps/web/vite.config.ts`: MPA inputs `landing` + `board`, `boardRoutes()` rewrite plugin, `/api` proxy with `rewrite` stripping the prefix.
- `apps/web/Caddyfile`: `handle` fallback uses `try_files {path} {path}.html`, so `/login` and `/dashboard` serve `login.html` / `dashboard.html` without changes.
- `apps/web/playwright.config.ts`: two `webServer` entries (collab-server on 3000, built web app on 5173).
- `packages/store-yjs`: `createYjsBoardStore(doc)` (`getMeta().name`, `listElements()`), `createBoardDoc`, `persistBoard`, `connectBoard`; presence carries `isAgent: boolean`.

## File structure

```
apps/collab-server/src/
  config.ts                 (modify: accounts/billing/quota config)
  db/schema.ts              (modify: auth tables, api_keys, mcp_usage, boards columns)
  db/boards.ts              (modify: ownership + badge + thumbnail helpers)
  db/users.ts               (create: plan + stripe customer helpers)
  board-read.ts             (create: rebuild a board doc for reads)
  accounts/auth.ts          (create: Better Auth instance)
  accounts/api-keys.ts      (create: API key issue/revoke/resolve)
  accounts/quota.ts         (create: monthly MCP quota)
  accounts/routes.ts        (create: /auth mount, /me/*, /boards/adopt, DELETE /boards/:id)
  billing/routes.ts         (create: /billing/checkout|portal|webhook)
  thumbnail.ts              (create: cached board thumbnail PNG)
  http.ts                   (modify: wire accounts + billing + session-aware roles)
  ws.ts                     (modify: session-aware role resolution)
  rooms.ts                  (modify: evict(boardId))
  mcp/index.ts              (modify: Bearer API key -> caller)
  mcp/server.ts             (modify: caller threading)
  mcp/caller.ts             (create: assertCaller quota/key gate)
  mcp/board-ref.ts          (modify: mark agent badge)
  mcp/tools/*.ts            (modify: caller instead of ip)
apps/web/
  login.html, dashboard.html            (create)
  src/auth/client.ts                    (create: session fetch + auth client)
  src/auth/adopt.ts                     (create: adoption flow)
  src/login/main.ts                     (create)
  src/dashboard/main.tsx                (create: dashboard app)
  src/dashboard/*.tsx|css               (create: grid, card, settings)
  src/board/... (top-bar, board-menu, board-session, identity use)  (modify)
  src/landing/recents.ts                (modify: session link)
  vite.config.ts                        (modify: inputs + rewrites)
  e2e/accounts.spec.ts                  (create)
  e2e/session-helper.ts                 (create)
```

---

### Task 1: Server configuration for accounts, billing, and quotas

**Files:**
- Modify: `apps/collab-server/src/config.ts`
- Test: `apps/collab-server/src/config.test.ts` (extend the existing file; create it if absent)

**Interfaces:**
- Produces: `Config` gains `accounts: AccountsConfig | null`, `billing: BillingConfig | null`, `freeBoardCap: number`, `mcpQuotaFree: number`, `mcpQuotaPro: number` where

```typescript
export interface AccountsConfig {
  secret: string
  github: { clientId: string; clientSecret: string } | null
  google: { clientId: string; clientSecret: string } | null
}

export interface BillingConfig {
  secretKey: string
  webhookSecret: string
  priceMonthly: string
  priceYearly: string
}
```

- [ ] **Step 1: Write the failing tests**

Append to (or create) `config.test.ts`, following the file's existing style:

```typescript
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config'

const base = { DATABASE_URL: 'postgres://x', CORS_ORIGIN: '*' }

describe('accounts config', () => {
  it('is null when AUTH_SECRET is absent', () => {
    expect(loadConfig(base).accounts).toBeNull()
  })

  it('requires at least one provider when AUTH_SECRET is set', () => {
    expect(() => loadConfig({ ...base, AUTH_SECRET: 's' })).toThrow(ConfigError)
  })

  it('loads the configured providers', () => {
    const config = loadConfig({
      ...base,
      AUTH_SECRET: 's',
      GITHUB_CLIENT_ID: 'gid',
      GITHUB_CLIENT_SECRET: 'gsec',
    })
    expect(config.accounts).toEqual({
      secret: 's',
      github: { clientId: 'gid', clientSecret: 'gsec' },
      google: null,
    })
  })

  it('refuses a half-configured provider', () => {
    expect(() =>
      loadConfig({ ...base, AUTH_SECRET: 's', GITHUB_CLIENT_ID: 'gid' }),
    ).toThrow(ConfigError)
  })
})

describe('billing config', () => {
  it('is null when STRIPE_SECRET_KEY is absent', () => {
    expect(loadConfig(base).billing).toBeNull()
  })

  it('requires the webhook secret and both prices once enabled', () => {
    expect(() =>
      loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk' }),
    ).toThrow(ConfigError)
  })

  it('loads a full billing block', () => {
    const config = loadConfig({
      ...base,
      STRIPE_SECRET_KEY: 'sk',
      STRIPE_WEBHOOK_SECRET: 'wh',
      STRIPE_PRICE_MONTHLY: 'price_m',
      STRIPE_PRICE_YEARLY: 'price_y',
    })
    expect(config.billing).toEqual({
      secretKey: 'sk',
      webhookSecret: 'wh',
      priceMonthly: 'price_m',
      priceYearly: 'price_y',
    })
  })
})

describe('freemium limits', () => {
  it('defaults the cap and quotas', () => {
    const config = loadConfig(base)
    expect(config.freeBoardCap).toBe(10)
    expect(config.mcpQuotaFree).toBe(1000)
    expect(config.mcpQuotaPro).toBe(50000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/collab-server test -- src/config.test.ts`
Expected: FAIL (`accounts` does not exist on `Config`).

- [ ] **Step 3: Implement**

In `config.ts`, add the two interfaces above, extend `Config`, and in `loadConfig` after the existing fields:

```typescript
function provider(
  env: Env,
  idName: string,
  secretName: string,
): { clientId: string; clientSecret: string } | null {
  const clientId = env[idName]
  const clientSecret = env[secretName]
  if (!clientId && !clientSecret) {
    return null
  }
  if (!clientId || !clientSecret) {
    throw new ConfigError(`${idName} and ${secretName} go together`)
  }
  return { clientId, clientSecret }
}

function accountsConfig(env: Env): AccountsConfig | null {
  const secret = env.AUTH_SECRET
  if (!secret) {
    return null
  }
  const github = provider(env, 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET')
  const google = provider(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')
  if (!github && !google) {
    throw new ConfigError('AUTH_SECRET needs at least one OAuth provider')
  }
  return { secret, github, google }
}

function billingConfig(env: Env): BillingConfig | null {
  if (!env.STRIPE_SECRET_KEY) {
    return null
  }
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: required(env, 'STRIPE_WEBHOOK_SECRET'),
    priceMonthly: required(env, 'STRIPE_PRICE_MONTHLY'),
    priceYearly: required(env, 'STRIPE_PRICE_YEARLY'),
  }
}
```

and in the returned object: `accounts: accountsConfig(env)`, `billing: billingConfig(env)`, `freeBoardCap: integer(env, 'FREE_BOARD_CAP', 10)`, `mcpQuotaFree: integer(env, 'MCP_QUOTA_FREE', 1000)`, `mcpQuotaPro: integer(env, 'MCP_QUOTA_PRO', 50000)`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @tlwb/collab-server test -- src/config.test.ts && pnpm --filter @tlwb/collab-server typecheck`
Expected: PASS. The typecheck may flag other files that construct `Config` literally in tests; extend those literals with the new fields (`accounts: null`, `billing: null`, and the three numbers).

- [ ] **Step 5: Commit**

```bash
git add apps/collab-server/src/config.ts apps/collab-server/src/config.test.ts
git commit -m "✨ feat(collab-server): configure accounts, billing, and quotas"
```

---

### Task 2: Database schema and migration

**Files:**
- Modify: `apps/collab-server/src/db/schema.ts`
- Create: migration via `pnpm --filter @tlwb/collab-server db:generate`
- Test: `apps/collab-server/src/db/schema.test.ts`

**Interfaces:**
- Produces: exported Drizzle tables `user`, `session`, `account`, `verification`, `apiKeys`, `mcpUsage`; `boards` gains `ownerId`, `sharedAt`, `agentAt`, `thumbnail`, `thumbnailSeq`. Property names on the four auth tables are exactly Better Auth's defaults (the Drizzle adapter matches on property names).

- [ ] **Step 1: Write the failing test**

`src/db/schema.test.ts` (the migration runs in `connectDatabase`, so connecting proves the migration applies):

```typescript
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectDatabase, type Database } from './client'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

describe('schema migration', () => {
  let database: Database
  beforeAll(async () => {
    database = await connectDatabase(url)
  })
  afterAll(async () => {
    await database.close()
  })

  it('creates the accounts tables', async () => {
    const rows = await database.db.execute(sql`
      select table_name from information_schema.tables
      where table_name in
        ('user', 'session', 'account', 'verification',
         'api_keys', 'mcp_usage')
    `)
    expect(rows.length).toBe(6)
  })

  it('extends boards with ownership and thumbnail columns', async () => {
    const rows = await database.db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'boards' and column_name in
        ('owner_id', 'shared_at', 'agent_at', 'thumbnail', 'thumbnail_seq')
    `)
    expect(rows.length).toBe(5)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test -- src/db/schema.test.ts`
Expected: FAIL (tables missing).

- [ ] **Step 3: Extend the schema**

In `schema.ts` add (keeping the existing `bytea` helper and import `boolean` from drizzle pg-core):

```typescript
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  plan: text('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
    withTimezone: true,
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  keyHash: bytea('key_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const mcpUsage = pgTable(
  'mcp_usage',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.month] })],
)
```

and on `boards` add:

```typescript
  ownerId: text('owner_id').references(() => user.id),
  sharedAt: timestamp('shared_at', { withTimezone: true }),
  agentAt: timestamp('agent_at', { withTimezone: true }),
  thumbnail: bytea('thumbnail'),
  thumbnailSeq: bigint('thumbnail_seq', { mode: 'number' }),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @tlwb/collab-server db:generate`
Expected: a new file in `src/migrations/` altering `boards` and creating the six tables. Read the generated SQL and confirm it only adds (no drops).

- [ ] **Step 5: Run the test and the full server suite**

Run: `pnpm --filter @tlwb/collab-server test -- src/db/schema.test.ts && pnpm --filter @tlwb/collab-server test`
Expected: PASS everywhere (existing suites prove the altered `boards` table still serves them).

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/src/db apps/collab-server/src/migrations
git commit -m "✨ feat(collab-server): add accounts, api key, and usage tables"
```

---

### Task 3: Better Auth instance mounted on the Hono app

**Files:**
- Create: `apps/collab-server/src/accounts/auth.ts`
- Modify: `apps/collab-server/src/http.ts`, `apps/collab-server/package.json`
- Test: `apps/collab-server/src/accounts/auth.test.ts`

**Interfaces:**
- Produces:

```typescript
// accounts/auth.ts
export type Auth = ReturnType<typeof betterAuth>
export interface AuthDeps {
  db: Db
  config: Config
  /** Called before a user row is deleted; wired fully in a later task. */
  beforeDelete?: (userId: string) => Promise<void>
}
export function createAuth(deps: AuthDeps): Auth | null
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
): Promise<SessionUser | null>
```

- `HttpDeps` gains `auth?: Auth | null`; `createApp` creates it from config when absent and mounts `app.on(['GET', 'POST'], '/auth/*', ...)`.

- [ ] **Step 1: Install the dependency**

Run: `pnpm --filter @tlwb/collab-server add better-auth`
Note: the Drizzle adapter import below is `better-auth/adapters/drizzle`; if the resolved major has moved it to the separate package `@better-auth/drizzle-adapter`, install that and import from it instead. Everything else is identical.

- [ ] **Step 2: Write the failing tests**

`src/accounts/auth.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config'
import { connectDatabase, type Database } from '../db/client'
import { createAuth, sessionUser } from './auth'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

const env = {
  DATABASE_URL: url,
  CORS_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-at-least-32-characters!!',
  GITHUB_CLIENT_ID: 'gid',
  GITHUB_CLIENT_SECRET: 'gsec',
}

describe('createAuth', () => {
  let database: Database
  beforeAll(async () => {
    database = await connectDatabase(url)
  })
  afterAll(async () => {
    await database.close()
  })

  it('is null without accounts config', () => {
    const config = loadConfig({ DATABASE_URL: url, CORS_ORIGIN: '*' })
    expect(createAuth({ db: database.db, config })).toBeNull()
  })

  it('answers ok on its own routes', async () => {
    const auth = createAuth({ db: database.db, config: loadConfig(env) })
    expect(auth).not.toBeNull()
    const response = await auth!.handler(
      new Request('http://localhost:3000/auth/ok'),
    )
    expect(response.status).toBe(200)
  })

  it('resolves no session from empty headers', async () => {
    const auth = createAuth({ db: database.db, config: loadConfig(env) })
    expect(await sessionUser(auth, new Headers())).toBeNull()
  })

  it('resolves null against a disabled auth', async () => {
    expect(await sessionUser(null, new Headers())).toBeNull()
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @tlwb/collab-server test -- src/accounts/auth.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `accounts/auth.ts`**

```typescript
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Config } from '../config'
import type { Db } from '../db/client'
import * as schema from '../db/schema'

export type Auth = ReturnType<typeof betterAuth>

export interface AuthDeps {
  db: Db
  config: Config
  beforeDelete?: (userId: string) => Promise<void>
}

/**
 * The Better Auth instance, or null when no accounts are configured:
 * a self-hosted server without OAuth secrets runs anonymous-only.
 * `basePath` is `/auth` because Caddy and the Vite proxy strip `/api`;
 * `baseURL` keeps the public prefix so provider redirect URIs are the
 * ones the outside world can reach.
 */
export function createAuth(deps: AuthDeps): Auth | null {
  const { config } = deps
  const accounts = config.accounts
  if (!accounts) {
    return null
  }
  const base = config.publicUrl === '*' ? 'http://localhost:3000' : config.publicUrl
  return betterAuth({
    baseURL: `${base}/api`,
    basePath: '/auth',
    secret: accounts.secret,
    trustedOrigins: config.corsOrigin === '*' ? undefined : [config.corsOrigin],
    database: drizzleAdapter(deps.db, { provider: 'pg', schema }),
    socialProviders: {
      ...(accounts.github ? { github: accounts.github } : {}),
      ...(accounts.google ? { google: accounts.google } : {}),
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ['github', 'google'] },
    },
    user: {
      additionalFields: {
        plan: { type: 'string', defaultValue: 'free', input: false },
        stripeCustomerId: { type: 'string', required: false, input: false },
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user: { id: string }) => {
          await deps.beforeDelete?.(user.id)
        },
      },
    },
  })
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
  const user = session.user as SessionUser & { plan?: string }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    plan: user.plan === 'pro' ? 'pro' : 'free',
    stripeCustomerId: user.stripeCustomerId ?? null,
  }
}
```

- [ ] **Step 5: Mount in `http.ts`**

In `HttpDeps` add `auth?: Auth | null`. In `createApp`, after the limiters:

```typescript
const auth = deps.auth === undefined ? createAuth({ db, config }) : deps.auth
if (auth) {
  app.use('/auth/*', async (c, next) => {
    if (!createLimiter.take(clientIp(c, config.trustProxy))) {
      return c.json({ error: 'too many requests' }, 429)
    }
    await next()
  })
  app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))
}
```

(Reusing `createLimiter`'s budget for `/auth/*` is deliberate: both are account-shaped write endpoints; a dedicated bucket is not worth a new knob.)

Also update `apps/collab-server/src/server.ts` (or wherever `createApp` is called for production) only if it passes an explicit `HttpDeps` literal that now needs no change; `auth` is optional.

- [ ] **Step 6: Add an http-level test**

Append to the existing http test file (find it with `ls apps/collab-server/src/*.test.ts`; it builds `createApp` with a test config):

```typescript
it('serves better-auth when configured and 404s when not', async () => {
  // app built with accounts config
  const ok = await appWithAuth.request('/auth/ok')
  expect(ok.status).toBe(200)
  // app built without accounts config
  const missing = await appWithoutAuth.request('/auth/ok')
  expect(missing.status).toBe(404)
})
```

Build `appWithAuth` with the env block from Step 2 through `loadConfig`, mirroring how the file already builds its app.

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @tlwb/collab-server test -- src/accounts/auth.test.ts && pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/collab-server/src/accounts apps/collab-server/src/http.ts apps/collab-server/package.json pnpm-lock.yaml apps/collab-server/src/*.test.ts
git commit -m "✨ feat(accounts): sign in with GitHub or Google through Better Auth"
```

---

### Task 4: Ownership in role resolution

**Files:**
- Modify: `apps/collab-server/src/db/boards.ts`, `apps/collab-server/src/http.ts`, `apps/collab-server/src/ws.ts`
- Test: `apps/collab-server/src/db/boards.test.ts` (extend), `apps/collab-server/src/ws.test.ts` (extend; find the actual existing test filenames with `ls`)

**Interfaces:**
- Consumes: `sessionUser(auth, headers)` from Task 3.
- Produces:

```typescript
// db/boards.ts
export interface BoardRecord {
  id: string
  editKeyHash: Buffer
  viewKeyHash: Buffer
  ownerId: string | null      // new
}
export async function markShared(db: Db, boardId: string): Promise<void>
// http.ts — replaces roleFromBearer's body, also used by ws.ts:
export function roleFor(
  board: BoardRecord,
  token: string | null,
  userId: string | null,
): Role | null
```

`roleFor` rules: `userId` equal to `board.ownerId` returns `'edit'`; otherwise the token path through `resolveRole`; otherwise null. Side effect free.

- [ ] **Step 1: Write the failing tests**

In the boards db test file:

```typescript
it('findBoard returns the owner', async () => {
  // create a board, then set owner_id directly with db.update
  // expect findBoard(...).ownerId to be the user id
})
```

Add a `roleFor` unit test (in `apps/collab-server/src/http.test.ts` or a new `role.test.ts` colocated with `http.ts`):

```typescript
import { hashKey } from './keys'
import { roleFor } from './http'

const board = {
  id: 'b1',
  editKeyHash: hashKey('edit-key'),
  viewKeyHash: hashKey('view-key'),
  ownerId: 'user-1',
}

it('owner session grants edit without a key', () => {
  expect(roleFor(board, null, 'user-1')).toBe('edit')
})
it('another user falls back to the key', () => {
  expect(roleFor(board, 'view-key', 'user-2')).toBe('view')
})
it('no key and no ownership is refused', () => {
  expect(roleFor(board, null, 'user-2')).toBeNull()
})
it('owner wins over a weaker key', () => {
  expect(roleFor(board, 'view-key', 'user-1')).toBe('edit')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/collab-server test -- src/http.test.ts`
Expected: FAIL (`roleFor` not exported).

- [ ] **Step 3: Implement**

`db/boards.ts`: add `ownerId: boards.ownerId` to `findBoard`'s select and to `BoardRecord`; add

```typescript
export async function markShared(db: Db, boardId: string): Promise<void> {
  await db
    .update(boards)
    .set({ sharedAt: new Date() })
    .where(and(eq(boards.id, boardId), isNull(boards.sharedAt)))
}
```

`http.ts`:

```typescript
export function roleFor(
  board: BoardRecord,
  token: string | null,
  userId: string | null,
): Role | null {
  if (userId && board.ownerId === userId) {
    return 'edit'
  }
  return token ? resolveRole(token, board) : null
}
```

Rewrite `roleFromBearer` to use it, resolving the session once per request:

```typescript
async function requestRole(
  c: Context<Env>,
  boardId: string,
): Promise<Role | null> {
  const board = await findBoard(db, boardId)
  if (!board) {
    return null
  }
  const token =
    c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? null
  const user = await sessionUser(auth, c.req.raw.headers)
  return roleFor(board, token, user?.id ?? null)
}
```

Replace the two `roleFromBearer` call sites with `requestRole`.

`ws.ts`: `WsDeps` gains `auth: Auth | null`. In `resolve(upgrade)`, thread the upgrade request through:

```typescript
async function resolve(
  upgrade: Upgrade,
  headers: Headers,
): Promise<{ role: Role; foreignKey: boolean } | number> {
  const board = await findBoard(db, upgrade.boardId)
  if (!board) {
    return CLOSE.unknownBoard
  }
  const user = await sessionUser(deps.auth, headers)
  const role = roleFor(board, upgrade.token || null, user?.id ?? null)
  if (!role) {
    return CLOSE.unauthorized
  }
  // A key-based connection on an owned board is someone else using a
  // share link: that is what the dashboard's "shared" badge reports.
  const foreignKey =
    board.ownerId !== null && user?.id !== board.ownerId
  return { role, foreignKey }
}
```

Build the `Headers` from the upgrade: `new Headers(Object.entries(request.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : (v ?? []).map((x) => [k, x]))))` — extract as a small helper `nodeHeaders(request)`. On a resolved `foreignKey`, fire-and-forget `void markShared(db, upgrade.boardId).catch(() => {})` before joining. The `resolve(upgrade)` call site in the `upgrade` handler changes shape: `typeof outcome === 'number'` still closes, otherwise destructure `outcome.role` into the existing `connect(...)` call. Update `attachWebSocket` callers (in `server.ts` and ws tests) to pass `auth`.

- [ ] **Step 4: Add a ws integration test**

In the ws test file (it already boots a server against Postgres): create a user and session row directly with Drizzle (`user` and `session` tables; token `'t-1'`, `expiresAt` in one hour), set the board's `ownerId`, then open a WebSocket to `/ws/<id>` with header `Cookie: better-auth.session_token=<signed>`. Signing: Better Auth signs the cookie value as `<token>.<base64url HMAC-SHA256(secret, token)>`. Add this helper in the test:

```typescript
import { createHmac } from 'node:crypto'
export function sessionCookie(token: string, secret: string): string {
  const signature = createHmac('sha256', secret)
    .update(token)
    .digest('base64url')
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`
}
```

Assert the connection is accepted with edit behavior (an update is not rejected). Verify the cookie format empirically first: call `GET /auth/get-session` on the test app with that cookie and assert the user comes back; if Better Auth's format differs, adapt the helper until that assertion passes, then keep it as the single source (export it — the e2e task reuses it).

- [ ] **Step 5: Run the suites**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/src
git commit -m "✨ feat(accounts): grant owners the edit role through their session"
```

---

### Task 5: Adoption and the creation cap

**Files:**
- Modify: `apps/collab-server/src/db/boards.ts`, `apps/collab-server/src/http.ts`, `apps/collab-server/src/issue-board.ts`
- Test: `apps/collab-server/src/accounts/adoption.test.ts`

**Interfaces:**
- Produces:

```typescript
// db/boards.ts
export async function claimBoard(
  db: Db,
  boardId: string,
  ownerId: string,
): Promise<boolean>                     // true when this call took ownership
export async function countOwnedBoards(db: Db, ownerId: string): Promise<number>
// issue-board.ts
export async function issueBoard(
  db: Db,
  ownerId?: string,
): Promise<IssuedBoard | null>          // ownerId lands in the insert
// http.ts routes
// POST /boards          — signed-in: cap check, board owned at birth
// POST /boards/adopt    — body { boards: [{ boardId, editKey }] } (max 50)
//                         answers { adopted: string[], skipped: string[] }
```

- [ ] **Step 1: Write the failing tests**

`src/accounts/adoption.test.ts`, following the http test file's app construction (Postgres, `app.request`). Create users directly with Drizzle inserts and authenticate requests with the `sessionCookie` helper from Task 4. Cases:

```typescript
it('adopts an unowned board when the edit key matches', async () => {
  // POST /boards (anonymous) -> { boardId, editKey }
  // POST /boards/adopt as user A with [{ boardId, editKey }]
  // expect adopted to contain boardId; findBoard(...).ownerId === A
})

it('skips a board whose key is wrong or already owned', async () => {
  // adopt with viewKey instead of editKey -> skipped
  // adopt a board already owned by B -> skipped, ownership unchanged
})

it('is idempotent for the current owner', async () => {
  // adopting your own board again lands in adopted, no error
})

it('stops adopting at the free cap', async () => {
  // user with FREE_BOARD_CAP owned boards: further adoption -> skipped,
  // response 200 with the board under skipped
})

it('caps creation for a signed-in free user', async () => {
  // FREE_BOARD_CAP owned boards; POST /boards with session cookie -> 403
  // { error: 'board limit reached' }; anonymous POST /boards still 201
})

it('a pro user is uncapped', async () => {
  // user row with plan 'pro' and cap+1 boards: POST /boards -> 201
})

it('requires a session', async () => {
  // POST /boards/adopt without cookie -> 401
})
```

Use a tiny cap in the test config (`FREE_BOARD_CAP: '2'`) so the cap cases stay cheap.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/collab-server test -- src/accounts/adoption.test.ts`
Expected: FAIL (route missing, 404).

- [ ] **Step 3: Implement**

`db/boards.ts`:

```typescript
export async function claimBoard(
  db: Db,
  boardId: string,
  ownerId: string,
): Promise<boolean> {
  const rows = await db
    .update(boards)
    .set({ ownerId })
    .where(and(eq(boards.id, boardId), isNull(boards.ownerId)))
    .returning({ id: boards.id })
  return rows.length > 0
}

export async function countOwnedBoards(
  db: Db,
  ownerId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(boards)
    .where(eq(boards.ownerId, ownerId))
  return row?.value ?? 0
}
```

`issue-board.ts`: add the optional `ownerId` parameter, passed into `createBoard`'s values (extend `createBoard`'s signature with `ownerId?: string`).

`http.ts` — `POST /boards` becomes:

```typescript
app.post('/boards', async (c) => {
  if (!createLimiter.take(clientIp(c, config.trustProxy))) {
    return c.json({ error: 'too many boards created' }, 429)
  }
  const user = await sessionUser(auth, c.req.raw.headers)
  if (user && user.plan === 'free') {
    // ponytail: read-then-insert races can overshoot the cap by a
    // concurrent request or two; a serialized check is not worth it
    // for a fair-use limit.
    if ((await countOwnedBoards(db, user.id)) >= config.freeBoardCap) {
      return c.json({ error: 'board limit reached' }, 403)
    }
  }
  const issued = await issueBoard(db, user?.id)
  if (!issued) {
    return c.json({ error: 'internal error' }, 500)
  }
  return c.json(issued, 201)
})
```

`POST /boards/adopt` (zod-validated body; import `z` from `'zod'`):

```typescript
const adoptBody = z.object({
  boards: z
    .array(
      z.object({
        boardId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
        editKey: z.string().min(1).max(128),
      }),
    )
    .max(50),
})

app.post('/boards/adopt', async (c) => {
  const user = await sessionUser(auth, c.req.raw.headers)
  if (!user) {
    return c.json({ error: 'sign in required' }, 401)
  }
  const parsed = adoptBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: 'invalid body' }, 400)
  }
  const adopted: string[] = []
  const skipped: string[] = []
  for (const entry of parsed.data.boards) {
    const board = await findBoard(db, entry.boardId)
    if (!board || resolveRole(entry.editKey, board) !== 'edit') {
      skipped.push(entry.boardId)
      continue
    }
    if (board.ownerId === user.id) {
      adopted.push(entry.boardId)
      continue
    }
    if (board.ownerId !== null) {
      skipped.push(entry.boardId)
      continue
    }
    const capped =
      user.plan === 'free' &&
      (await countOwnedBoards(db, user.id)) >= config.freeBoardCap
    if (capped) {
      skipped.push(entry.boardId)
      continue
    }
    if (await claimBoard(db, entry.boardId, user.id)) {
      adopted.push(entry.boardId)
    } else {
      skipped.push(entry.boardId)
    }
  }
  return c.json({ adopted, skipped })
})
```

(The client sends boards most recently updated first, so "adoption stops at the cap, most recent first" comes from the request order.)

- [ ] **Step 4: Run the suites**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/collab-server/src
git commit -m "✨ feat(accounts): adopt browser boards and cap free creation"
```

---

### Task 6: Owner board listing and deletion

**Files:**
- Create: `apps/collab-server/src/board-read.ts`
- Modify: `apps/collab-server/src/db/boards.ts`, `apps/collab-server/src/rooms.ts`, `apps/collab-server/src/http.ts`
- Test: `apps/collab-server/src/accounts/me.test.ts`, extend the rooms test file

**Interfaces:**
- Produces:

```typescript
// board-read.ts — rebuilds the persisted doc (same replay rooms.ts does)
export async function readBoardStore(
  db: Db,
  boardId: string,
): Promise<{ store: BoardStore; latestSeq: number } | undefined>
// db/boards.ts
export interface OwnedBoard {
  id: string
  updatedAt: Date
  sharedAt: Date | null
  agentAt: Date | null
}
export async function listOwnedBoards(db: Db, ownerId: string): Promise<OwnedBoard[]>
export async function deleteBoardRows(db: Db, boardId: string): Promise<void>
// rooms.ts
// RoomRegistry gains: evict(boardId): Promise<void>  (closeAll + destroy + forget)
// http.ts routes
// GET  /me            -> { user: { name, email, image, plan }, billing: boolean }
// GET  /me/boards     -> { boards: [{ id, name, updatedAt, shared, agent }],
//                          cap: number | null }   (cap null on pro)
// DELETE /boards/:boardId  (owner only) -> 204
```

- [ ] **Step 1: Write the failing tests**

`src/accounts/me.test.ts` (same app construction as Task 5):

```typescript
it('GET /me answers 401 signed out and the profile signed in', async () => {
  expect((await app.request('/me')).status).toBe(401)
  const response = await app.request('/me', {
    headers: { cookie: sessionCookie(tokenA, secret) },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    user: { name: 'Ada', email: 'ada@example.com', image: null, plan: 'free' },
    billing: false,
  })
})

it('lists owned boards with their names', async () => {
  // create two boards owned by A (one via POST /boards with session);
  // push a named update through the room or write a snapshot with
  // store-yjs: build createBoardDoc + createYjsBoardStore, setMeta name,
  // then compactBoard(db, id, Y.encodeStateAsUpdate(doc), 1)
  // expect names and ids in the listing, most recently updated first
})

it('does not list anonymous or foreign boards', async () => {
  // one anonymous board and one owned by B exist alongside A's two:
  // A's listing still holds exactly A's two ids
})

it('DELETE /boards/:id purges an owned board', async () => {
  // 204, findBoard undefined, updates and assets gone
})

it('DELETE refuses non-owners', async () => {
  // anonymous -> 401; another user -> 403; unknown board -> 404
})
```

Extend the rooms test file: `evict` closes a live room's connections and a later `acquire` reloads from the database.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/collab-server test -- src/accounts/me.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`board-read.ts`:

```typescript
import { createYjsBoardStore } from '@tlwb/store-yjs'
import * as Y from 'yjs'
import { loadBoard } from './db/boards'
import type { Db } from './db/client'

/** The persisted board as a readable store, outside any live room. */
export async function readBoardStore(db: Db, boardId: string) {
  const loaded = await loadBoard(db, boardId)
  if (!loaded) {
    return undefined
  }
  const doc = new Y.Doc()
  if (loaded.snapshot) {
    Y.applyUpdate(doc, loaded.snapshot)
  }
  for (const row of loaded.updates) {
    Y.applyUpdate(doc, row.update)
  }
  return {
    store: createYjsBoardStore(doc),
    latestSeq: loaded.updates.at(-1)?.seq ?? loaded.snapshotSeq,
  }
}
```

`db/boards.ts`: `listOwnedBoards` selects id/updatedAt/sharedAt/agentAt where `ownerId` matches, `orderBy(desc(boards.updatedAt))`; `deleteBoardRows` deletes from `boardUpdates`, `assets`, then `boards` in one transaction.

`rooms.ts` — add to the registry:

```typescript
async function evict(boardId: string): Promise<void> {
  const pending = entries.get(boardId)
  if (!pending) {
    return
  }
  entries.delete(boardId)
  const entry = await pending.catch(() => undefined)
  if (entry) {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
    }
    entry.room.closeAll(CLOSE.unknownBoard, 'board deleted')
    entry.room.destroy()
  }
}
```

(Match the exact cleanup the existing `shutdown` performs — read it and mirror it, minus the compaction, which a deletion makes pointless.)

`http.ts` routes:

```typescript
app.get('/me', async (c) => {
  const user = await sessionUser(auth, c.req.raw.headers)
  if (!user) {
    return c.json({ error: 'sign in required' }, 401)
  }
  return c.json({
    user: {
      name: user.name,
      email: user.email,
      image: user.image,
      plan: user.plan,
    },
    billing: config.billing !== null,
  })
})

app.get('/me/boards', async (c) => {
  const user = await sessionUser(auth, c.req.raw.headers)
  if (!user) {
    return c.json({ error: 'sign in required' }, 401)
  }
  const owned = await listOwnedBoards(db, user.id)
  const result = []
  // ponytail: one doc replay per board per listing; cache names in a
  // column if dashboards ever hold hundreds of boards.
  for (const board of owned) {
    const read = await readBoardStore(db, board.id)
    result.push({
      id: board.id,
      name: read?.store.getMeta().name ?? 'Untitled',
      updatedAt: board.updatedAt.toISOString(),
      shared: board.sharedAt !== null,
      agent: board.agentAt !== null,
    })
  }
  return c.json({
    boards: result,
    cap: user.plan === 'free' ? config.freeBoardCap : null,
  })
})

app.delete('/boards/:boardId', async (c) => {
  const user = await sessionUser(auth, c.req.raw.headers)
  if (!user) {
    return c.json({ error: 'sign in required' }, 401)
  }
  const board = await findBoard(db, c.req.param('boardId'))
  if (!board) {
    return c.json({ error: 'unknown board' }, 404)
  }
  if (board.ownerId !== user.id) {
    return c.json({ error: 'not your board' }, 403)
  }
  await deps.rooms.evict(board.id)
  await deleteBoardRows(db, board.id)
  return c.body(null, 204)
})
```

- [ ] **Step 4: Run the suites**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/collab-server/src
git commit -m "✨ feat(accounts): list and delete owned boards"
```

---

### Task 7: Cached board thumbnails

**Files:**
- Create: `apps/collab-server/src/thumbnail.ts`
- Modify: `apps/collab-server/src/db/boards.ts`, `apps/collab-server/src/http.ts`
- Test: `apps/collab-server/src/thumbnail.test.ts`

**Interfaces:**
- Consumes: `readBoardStore` (Task 6), `renderPng`/`loadImages` from `src/mcp/render.ts`, `renderLimiter` already in `createApp`.
- Produces:

```typescript
// db/boards.ts
export async function readThumbnail(
  db: Db,
  boardId: string,
): Promise<{ thumbnail: Buffer | null; thumbnailSeq: number | null }>
export async function writeThumbnail(
  db: Db,
  boardId: string,
  png: Uint8Array,
  seq: number,
): Promise<void>
// thumbnail.ts
export const THUMB_WIDTH = 400
export async function boardThumbnail(
  db: Db,
  config: Config,
  boardId: string,
): Promise<Buffer | null>   // null when the board is empty or too large
// http.ts route
// GET /me/boards/:boardId/thumbnail (owner only) -> image/png | 204
```

- [ ] **Step 1: Write the failing tests**

`src/thumbnail.test.ts`:

```typescript
it('renders, caches, and serves a PNG for a board with content', async () => {
  // seed a board with one rectangle element via store-yjs + compactBoard
  // first boardThumbnail call: PNG signature bytes, row written
  // (readThumbnail returns bytes and the latest seq)
})

it('reuses the cache until the board changes', async () => {
  // second call returns the identical buffer without re-render
  // (assert readThumbnail seq unchanged; then appendUpdate and expect a
  //  new render: seq moved)
})

it('answers null for an empty board', async () => {
  // a board created through POST /boards but never drawn on
  expect(await boardThumbnail(db, config, emptyBoardId)).toBeNull()
})

it('the route requires ownership', async () => {
  // GET /me/boards/:id/thumbnail anonymous -> 401, non-owner -> 403,
  // owner with empty board -> 204, owner with content -> 200 image/png
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/collab-server test -- src/thumbnail.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`thumbnail.ts`:

```typescript
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readBoardStore } from './board-read'
import type { Config } from './config'
import { readThumbnail, writeThumbnail } from './db/boards'
import type { Db } from './db/client'
import { loadImages, renderPng } from './mcp/render'

export const THUMB_WIDTH = 400

/**
 * The board as a small PNG, cached in the boards row and re-rendered
 * only when the persisted document moved past the cached sequence.
 */
export async function boardThumbnail(
  db: Db,
  config: Config,
  boardId: string,
): Promise<Buffer | null> {
  const read = await readBoardStore(db, boardId)
  if (!read) {
    return null
  }
  const cached = await readThumbnail(db, boardId)
  if (cached.thumbnail && cached.thumbnailSeq === read.latestSeq) {
    return cached.thumbnail
  }
  const elements = read.store.listElements()
  if (elements.length === 0) {
    return null
  }
  const full = await renderPng(elements, {
    scale: 1,
    maxPixels: config.mcpMaxImagePixels,
    resolveImage: await loadImages(db, boardId, elements),
  })
  if (!full) {
    return null
  }
  const image = await loadImage(Buffer.from(full))
  const height = Math.max(
    1,
    Math.round((image.height / image.width) * THUMB_WIDTH),
  )
  const canvas = createCanvas(THUMB_WIDTH, height)
  canvas.getContext('2d').drawImage(image, 0, 0, THUMB_WIDTH, height)
  const png = canvas.toBuffer('image/png')
  await writeThumbnail(db, boardId, png, read.latestSeq)
  return png
}
```

(Check `renderPng`'s actual return type in `src/mcp/render.ts` first and adapt the `Buffer.from` accordingly; if `renderPng` or `imageBlock` are not exported the way this needs, export them.)

`db/boards.ts`: `readThumbnail` selects the two columns; `writeThumbnail` updates them.

`http.ts` route (spend `renderLimiter` only when a render is possible, mirroring the MCP screenshot tool):

```typescript
app.get('/me/boards/:boardId/thumbnail', async (c) => {
  const user = await sessionUser(auth, c.req.raw.headers)
  if (!user) {
    return c.json({ error: 'sign in required' }, 401)
  }
  const board = await findBoard(db, c.req.param('boardId'))
  if (!board || board.ownerId !== user.id) {
    return c.json(
      { error: board ? 'not your board' : 'unknown board' },
      board ? 403 : 404,
    )
  }
  if (!renderLimiter.take(clientIp(c, config.trustProxy))) {
    return c.json({ error: 'too many renders, retry later' }, 429)
  }
  const png = await boardThumbnail(db, config, board.id)
  if (!png) {
    return c.body(null, 204)
  }
  return c.body(new Uint8Array(png), 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'private, max-age=60',
  })
})
```

- [ ] **Step 4: Run the suites**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/collab-server/src
git commit -m "✨ feat(accounts): render cached dashboard thumbnails"
```

---

### Task 8: MCP API key and monthly quota

**Files:**
- Create: `apps/collab-server/src/accounts/api-keys.ts`, `apps/collab-server/src/accounts/quota.ts`, `apps/collab-server/src/mcp/caller.ts`
- Modify: `apps/collab-server/src/http.ts` (three `/me/api-key` routes), `apps/collab-server/src/mcp/index.ts`, `apps/collab-server/src/mcp/server.ts`, `apps/collab-server/src/mcp/board-ref.ts`, all six files in `apps/collab-server/src/mcp/tools/`, `apps/collab-server/src/db/boards.ts`
- Test: `apps/collab-server/src/accounts/api-keys.test.ts`, `apps/collab-server/src/accounts/quota.test.ts`, extend the MCP tools test file

**Interfaces:**
- Produces:

```typescript
// accounts/api-keys.ts
export const API_KEY_PREFIX = 'tlwb_'
export async function issueApiKey(db: Db, userId: string): Promise<string>
  // revokes any active key, inserts the new hash, returns `tlwb_<key>`
export async function revokeApiKey(db: Db, userId: string): Promise<void>
export async function resolveApiKey(
  db: Db,
  bearer: string,
): Promise<{ userId: string; plan: 'free' | 'pro' } | null>
  // null for unknown or revoked; joins user for the plan

// accounts/quota.ts
export function monthOf(now: number): string          // 'YYYY-MM' (UTC)
export async function spendQuota(
  db: Db,
  userId: string,
  month: string,
  limit: number,
): Promise<boolean>                                    // false once exhausted
export async function readUsage(
  db: Db,
  userId: string,
  month: string,
): Promise<number>

// mcp/caller.ts
export type Caller =
  | { kind: 'anonymous'; ip: string }
  | { kind: 'invalid'; ip: string }
  | { kind: 'keyed'; ip: string; userId: string; plan: 'free' | 'pro' }
export async function assertCaller(deps: McpDeps, caller: Caller): Promise<void>
  // 'invalid' -> ToolError('invalid API key')
  // 'keyed'   -> spendQuota; exhausted ->
  //              ToolError('monthly quota reached, resets on the 1st')
  // 'anonymous' -> nothing (the per-IP app limiter already ran)

// db/boards.ts
export async function markAgentSeen(db: Db, boardId: string): Promise<void>
  // sets agent_at when null, like markShared

// mcp/server.ts: createMcpServer(deps, caller) — tools receive Caller
// instead of the bare ip (caller.ip replaces the old parameter).
// mcp/index.ts: parses Authorization Bearer tlwb_*, builds the Caller,
// skips the per-IP limiter for a valid key.
// http.ts routes:
// POST   /me/api-key  -> { key }         (shown once)
// DELETE /me/api-key  -> 204
// GET    /me/usage    -> { month, count, limit }
```

- [ ] **Step 1: Write the failing tests**

`api-keys.test.ts`:

```typescript
it('issues a prefixed key and resolves it to its user and plan', async () => {
  // seed user A with plan 'pro' via a direct drizzle insert
  const key = await issueApiKey(db, userA)
  expect(key.startsWith('tlwb_')).toBe(true)
  expect(await resolveApiKey(db, key)).toEqual({ userId: userA, plan: 'pro' })
})
it('regenerating revokes the previous key', async () => {
  const first = await issueApiKey(db, userA)
  await issueApiKey(db, userA)
  expect(await resolveApiKey(db, first)).toBeNull()
})
it('resolves null for unknown and revoked keys', async () => {
  expect(await resolveApiKey(db, 'tlwb_nonsense')).toBeNull()
  expect(await resolveApiKey(db, 'no-prefix')).toBeNull()
  const key = await issueApiKey(db, userA)
  await revokeApiKey(db, userA)
  expect(await resolveApiKey(db, key)).toBeNull()
})
```

`quota.test.ts`:

```typescript
it('monthOf formats UTC months', () => {
  expect(monthOf(Date.UTC(2026, 7, 28))).toBe('2026-08')
})
it('spendQuota counts up and stops at the limit', async () => {
  expect(await spendQuota(db, userA, '2026-08', 2)).toBe(true)
  expect(await spendQuota(db, userA, '2026-08', 2)).toBe(true)
  expect(await spendQuota(db, userA, '2026-08', 2)).toBe(false)
  expect(await readUsage(db, userA, '2026-08')).toBe(2)
})
it('a zero limit spends nothing', async () => {
  expect(await spendQuota(db, userA, '2026-08', 0)).toBe(false)
})
it('a new month starts a fresh counter', async () => {
  expect(await spendQuota(db, userA, '2026-09', 2)).toBe(true)
  expect(await readUsage(db, userA, '2026-09')).toBe(1)
})
```

MCP tools test file — add:

```typescript
it('a valid API key spends the quota and an exhausted one errors', async () => {
  // limit 1 via MCP_QUOTA_FREE=1; first tools/call succeeds,
  // second answers isError with 'monthly quota reached, resets on the 1st'
})
it('an invalid API key errors every tool', async () => {
  // Authorization: Bearer tlwb_wrong -> isError 'invalid API key'
})
it('a keyed call marks the board as agent-touched', async () => {
  // after a read_board with a key, boards.agent_at is set
})
```

(Reuse the file's existing helper that drives `tools/call` requests through `app.request('/mcp', ...)`; add the Authorization header.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/collab-server test -- src/accounts/api-keys.test.ts src/accounts/quota.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the accounts side**

`api-keys.ts` — reuse `generateKey`/`hashKey` from `../keys`; `resolveApiKey` strips `API_KEY_PREFIX` (no prefix -> null), hashes, selects the active row (`revokedAt` null) joined to `user` for the plan. `issueApiKey`: transaction — set `revokedAt` on active rows, insert `{ id: randomBytes(16).toString('base64url'), userId, keyHash }`, return the clear key.

`quota.ts`:

```typescript
export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

export async function spendQuota(
  db: Db,
  userId: string,
  month: string,
  limit: number,
): Promise<boolean> {
  const rows = await db
    .insert(mcpUsage)
    .values({ userId, month, count: 1 })
    .onConflictDoUpdate({
      target: [mcpUsage.userId, mcpUsage.month],
      set: { count: sql`${mcpUsage.count} + 1` },
      setWhere: sql`${mcpUsage.count} < ${limit}`,
    })
    .returning({ count: mcpUsage.count })
  return rows.length > 0
}
```

(Also guard `limit < 1` by returning false immediately, and treat a fresh insert against `limit === 0` the same; cover in the test.)

- [ ] **Step 4: Implement the MCP side**

`mcp/caller.ts` as specified (quota limit from `caller.plan === 'pro' ? deps.config.mcpQuotaPro : deps.config.mcpQuotaFree`, month from `deps.now ?? Date.now`).

`mcp/index.ts` — in the handler, before the limiter:

```typescript
const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
let caller: Caller = { kind: 'anonymous', ip }
if (bearer?.startsWith(API_KEY_PREFIX)) {
  const keyed = await resolveApiKey(deps.db, bearer)
  caller = keyed
    ? { kind: 'keyed', ip, ...keyed }
    : { kind: 'invalid', ip }
}
if (
  c.req.method === 'POST' &&
  caller.kind !== 'keyed' &&
  !limiter.take(ip)
) {
  return c.json({ error: 'too many requests' }, 429)
}
const server = createMcpServer(deps, caller)
```

`mcp/server.ts`: `createMcpServer(deps, caller: Caller)`; pass `caller` to every `register*`. In each of the six tool files: the parameter becomes `caller: Caller`; inside `guarded`, first line `await assertCaller(deps, caller)`; every former `ip` use becomes `caller.ip`. (`create-board` keeps its `createLimiter` check but only for `caller.kind === 'anonymous'` — a keyed caller is bounded by their quota and the board cap does not apply to MCP-created anonymous boards.)

`mcp/board-ref.ts` — at the end of a successful `resolveBoardRole`, fire and forget:

```typescript
void markAgentSeen(db, ref.boardId).catch(() => {})
```

`http.ts` — the three `/me/api-key` and `/me/usage` routes, all session-gated like `/me`:

```typescript
app.post('/me/api-key', async (c) => {
  const user = await sessionUser(auth, c.req.raw.headers)
  if (!user) {
    return c.json({ error: 'sign in required' }, 401)
  }
  return c.json({ key: await issueApiKey(db, user.id) }, 201)
})
app.delete('/me/api-key', async (c) => { /* revokeApiKey, 204 */ })
app.get('/me/usage', async (c) => {
  // month: monthOf(now()), count: readUsage,
  // limit: user.plan === 'pro' ? config.mcpQuotaPro : config.mcpQuotaFree
})
```

- [ ] **Step 5: Run the suites**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck`
Expected: PASS, existing MCP tests included (anonymous callers behave exactly as before).

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/src
git commit -m "✨ feat(mcp): meter keyed agents against a monthly account quota"
```

---

### Task 9: Stripe billing

**Files:**
- Create: `apps/collab-server/src/billing/routes.ts`
- Create: `apps/collab-server/src/db/users.ts`
- Modify: `apps/collab-server/src/http.ts`, `apps/collab-server/package.json`
- Test: `apps/collab-server/src/billing/routes.test.ts`

**Interfaces:**
- Produces:

```typescript
// db/users.ts
export async function setPlan(db: Db, userId: string, plan: 'free' | 'pro'): Promise<void>
export async function setStripeCustomer(db: Db, userId: string, customerId: string): Promise<void>
export async function findUserByStripeCustomer(db: Db, customerId: string): Promise<{ id: string } | undefined>
// billing/routes.ts
export interface BillingDeps {
  db: Db
  config: Config          // config.billing is non-null when mounted
  auth: Auth | null
  stripe?: Stripe         // injected by tests
}
export function createBillingApp(deps: BillingDeps): Hono
// routes (mounted at /billing by http.ts, only when config.billing):
// POST /billing/checkout {interval:'month'|'year'} -> { url }  (303 target)
// POST /billing/portal -> { url }
// POST /billing/webhook -> 200 (signature checked, plan written)
```

- [ ] **Step 1: Install Stripe**

Run: `pnpm --filter @tlwb/collab-server add stripe`

- [ ] **Step 2: Write the failing tests**

`billing/routes.test.ts`. For checkout/portal, inject a stub `stripe` object (plain object with the three methods used; no mocking library):

```typescript
const stripeStub = {
  checkout: {
    sessions: {
      create: async (params: unknown) => ({ url: 'https://stripe.test/c' }),
    },
  },
  billingPortal: {
    sessions: { create: async () => ({ url: 'https://stripe.test/p' }) },
  },
  customers: { create: async () => ({ id: 'cus_test' }) },
  webhooks: new Stripe('sk_test_x').webhooks, // real signature verification
} as unknown as Stripe
```

Cases:

```typescript
it('checkout requires a session and answers the redirect url', async () => {
  // 401 anonymous; signed in: { url }, stripe customer stored on user
})
it('portal requires a stripe customer', async () => {
  // user without stripeCustomerId -> 409 { error: 'no subscription yet' }
})
it('webhook rejects a bad signature', async () => {
  // random payload + wrong signature header -> 400
})
it('webhook flips the plan with the subscription state', async () => {
  // build payloads with stripe.webhooks.generateTestHeaderString(
  //   { payload, secret }) for:
  // customer.subscription.updated (status 'active')   -> plan pro
  // customer.subscription.deleted                     -> plan free
  // replayed event                                    -> still free, 200
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @tlwb/collab-server test -- src/billing/routes.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

`billing/routes.ts`:

```typescript
import { Hono } from 'hono'
import Stripe from 'stripe'
import { type Auth, sessionUser } from '../accounts/auth'
import type { Config } from '../config'
import type { Db } from '../db/client'
import {
  findUserByStripeCustomer,
  setPlan,
  setStripeCustomer,
} from '../db/users'
import { log } from '../log'

export function createBillingApp(deps: BillingDeps): Hono {
  const billing = deps.config.billing
  if (!billing) {
    throw new Error('billing app mounted without billing config')
  }
  const stripe = deps.stripe ?? new Stripe(billing.secretKey)
  const app = new Hono()
  const base =
    deps.config.publicUrl === '*' ? '' : deps.config.publicUrl

  app.post('/checkout', async (c) => {
    const user = await sessionUser(deps.auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    const body = await c.req.json().catch(() => ({}))
    const price =
      body.interval === 'year' ? billing.priceYearly : billing.priceMonthly
    let customer = user.stripeCustomerId
    if (!customer) {
      customer = (await stripe.customers.create({ email: user.email })).id
      await setStripeCustomer(deps.db, user.id, customer)
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price, quantity: 1 }],
      success_url: `${base}/dashboard?checkout=success`,
      cancel_url: `${base}/dashboard`,
    })
    return c.json({ url: session.url })
  })

  app.post('/portal', async (c) => {
    const user = await sessionUser(deps.auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    if (!user.stripeCustomerId) {
      return c.json({ error: 'no subscription yet' }, 409)
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${base}/dashboard`,
    })
    return c.json({ url: session.url })
  })

  app.post('/webhook', async (c) => {
    const signature = c.req.header('stripe-signature')
    if (!signature) {
      return c.json({ error: 'missing signature' }, 400)
    }
    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        await c.req.text(),
        signature,
        billing.webhookSecret,
      )
    } catch {
      return c.json({ error: 'bad signature' }, 400)
    }
    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted' ||
      event.type === 'checkout.session.completed'
    ) {
      const object = event.data.object as { customer?: string | { id: string } }
      const customerId =
        typeof object.customer === 'string'
          ? object.customer
          : object.customer?.id
      const user = customerId
        ? await findUserByStripeCustomer(deps.db, customerId)
        : undefined
      if (user) {
        // The absolute state, not a delta: replays and reordering land
        // on the same answer.
        const active =
          event.type !== 'customer.subscription.deleted' &&
          ('status' in event.data.object
            ? ['active', 'trialing', 'past_due'].includes(
                (event.data.object as { status: string }).status,
              )
            : true)
        await setPlan(deps.db, user.id, active ? 'pro' : 'free')
        log({ event: 'plan updated', userId: user.id, active })
      }
    }
    return c.json({ received: true })
  })

  return app
}
```

`http.ts`: after the auth mount, `if (config.billing) { app.route('/billing', createBillingApp({ db, config, auth })) }` — and let tests inject the stub by adding `stripe?: Stripe` to `HttpDeps`, passed through.

- [ ] **Step 5: Run the suites**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/src apps/collab-server/package.json pnpm-lock.yaml
git commit -m "✨ feat(billing): subscribe to Pro through Stripe Checkout"
```

---

### Task 10: Account deletion cleanup

**Files:**
- Modify: `apps/collab-server/src/http.ts` (wire `beforeDelete`), `apps/collab-server/src/db/boards.ts`
- Test: `apps/collab-server/src/accounts/deletion.test.ts`

**Interfaces:**
- Consumes: `createAuth`'s `beforeDelete` hook (Task 3), `revokeApiKey` (Task 8).
- Produces: `db/boards.ts` gains `disownBoards(db, ownerId): Promise<void>` (sets `owner_id` to null on every board the user owns; share links keep working).

- [ ] **Step 1: Write the failing test**

`accounts/deletion.test.ts` — call the cleanup function directly (the OAuth-driven delete flow is Better Auth's own; ours is the hook body):

```typescript
it('re-anonymizes boards, revokes the api key, cancels the subscription', async () => {
  // seed: user with 2 owned boards, an active api key, and
  // stripeCustomerId 'cus_1'; a stub stripe records
  // subscriptions.list -> [{ id: 'sub_1', status: 'active' }] and
  // subscriptions.cancel calls
  // run the exported cleanup; expect: both boards ownerId null,
  // resolveApiKey(oldKey) null, stripe cancel called with 'sub_1'
})
it('tolerates a user with nothing to clean', async () => {})
```

Export the hook body as a named function so the test reaches it:

```typescript
// http.ts (or accounts/cleanup.ts if http.ts grows unwieldy)
export function accountCleanup(
  db: Db,
  stripe: Stripe | null,
): (userId: string) => Promise<void>
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/collab-server test -- src/accounts/deletion.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
export function accountCleanup(
  db: Db,
  stripe: Stripe | null,
): (userId: string) => Promise<void> {
  return async (userId) => {
    await disownBoards(db, userId)
    await revokeApiKey(db, userId)
    if (stripe) {
      const [row] = await db
        .select({ customer: user.stripeCustomerId })
        .from(user)
        .where(eq(user.id, userId))
      if (row?.customer) {
        const subs = await stripe.subscriptions.list({
          customer: row.customer,
          status: 'active',
        })
        for (const sub of subs.data) {
          await stripe.subscriptions.cancel(sub.id)
        }
      }
    }
  }
}
```

Wire it in `createApp`: build the Stripe instance once (shared with billing), then `createAuth({ db, config, beforeDelete: accountCleanup(db, stripe) })`.

- [ ] **Step 4: Run the suites, typecheck, and lint**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck && pnpm check`
Expected: PASS. (This closes the server half; `pnpm check` covers the whole repo.)

- [ ] **Step 5: Commit**

```bash
git add apps/collab-server/src
git commit -m "✨ feat(accounts): clean up boards, keys, and billing on account deletion"
```

---

### Task 11: Web login page and auth client

**Files:**
- Create: `apps/web/login.html`, `apps/web/src/login/main.ts`, `apps/web/src/login/login.css`, `apps/web/src/auth/client.ts`
- Modify: `apps/web/vite.config.ts`, `apps/web/package.json`
- Test: `apps/web/src/auth/client.test.ts`

**Interfaces:**
- Produces:

```typescript
// src/auth/client.ts
import { createAuthClient } from 'better-auth/client'
export const authClient = createAuthClient({ baseURL: '/api/auth' })
export interface Me {
  name: string
  email: string
  image: string | null
  plan: 'free' | 'pro'
}
/** null when signed out OR when the deployment has no accounts. */
export async function fetchSession(
  fetchFn: typeof fetch = fetch,
): Promise<Me | null>
```

`fetchSession` calls `GET /api/auth/get-session`; any non-200, empty body, or network error resolves null (an accounts-disabled server 404s here, which must read as signed out, never as an error).

- [ ] **Step 1: Install and write the failing test**

Run: `pnpm --filter @tlwb/web add better-auth`

`src/auth/client.test.ts` (happy-dom, stub `fetchFn`):

```typescript
it('maps a session payload to Me', async () => {
  const me = await fetchSession(async () =>
    Response.json({
      user: { name: 'Ada', email: 'ada@example.com', image: null, plan: 'pro' },
    }),
  )
  expect(me).toEqual({
    name: 'Ada', email: 'ada@example.com', image: null, plan: 'pro',
  })
})
it('resolves null on 404, null body, and network failure', async () => {
  expect(await fetchSession(async () => new Response('', { status: 404 })))
    .toBeNull()
  expect(await fetchSession(async () => Response.json(null))).toBeNull()
  expect(await fetchSession(async () => { throw new Error('offline') }))
    .toBeNull()
})
it('defaults a missing plan to free', async () => {
  const me = await fetchSession(async () =>
    Response.json({ user: { name: 'Ada', email: 'a@x.io' } }),
  )
  expect(me?.plan).toBe('free')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- src/auth/client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement client, page, and config**

`src/auth/client.ts` as specified. `login.html`: same head pattern as `board.html` (fonts, tokens.css), a centered card with the tlwb wordmark linking `/`, an `<h1>Sign in</h1>`, two buttons `#github` and `#continue-google`, module script `/src/login/main.ts`. `src/login/main.ts`:

```typescript
import { authClient } from '../auth/client'

const callbackURL =
  new URLSearchParams(location.search).get('from') ?? '/dashboard'

// The OAuth return lands on /dashboard, which runs adoption on load.
document.getElementById('github')?.addEventListener('click', () => {
  void authClient.signIn.social({ provider: 'github', callbackURL })
})
document.getElementById('google')?.addEventListener('click', () => {
  void authClient.signIn.social({ provider: 'google', callbackURL })
})
```

`vite.config.ts`: add inputs `login: resolve(__dirname, 'login.html')` and `dashboard: resolve(__dirname, 'dashboard.html')` (the file arrives in Task 13; create an empty placeholder `dashboard.html` now so the build stays green, filled in Task 13). Extend the rewrite plugin:

```typescript
const pages: Record<string, string> = {
  '/login': '/login.html',
  '/dashboard': '/dashboard.html',
}
server.middlewares.use((req, _res, next) => {
  if (req.url?.startsWith('/b/')) {
    req.url = '/board.html'
  } else {
    const page = pages[req.url?.split('?')[0] ?? '']
    if (page) {
      req.url = page
    }
  }
  next()
})
```

- [ ] **Step 4: Run tests, typecheck, build**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm --filter @tlwb/web build`
Expected: PASS; the build emits `login.html`.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): add the sign-in page"
```

---

### Task 12: Client adoption flow

**Files:**
- Create: `apps/web/src/auth/adopt.ts`
- Modify: `apps/web/src/board/session/server.ts` (adopt request helper)
- Test: `apps/web/src/auth/adopt.test.ts`

**Interfaces:**
- Consumes: `listRecents` (`RecentBoard`), `readKeys` (`StoredKeys`), `shareBoard`'s building blocks — but adoption of a purely local board must not need a live `BoardSession`; it re-hosts from IndexedDB directly with `persistBoard` + `createHostedBoard` + `uploadAsset`.
- Produces:

```typescript
// session/server.ts
export async function requestAdoption(
  boards: { boardId: string; editKey: string }[],
  fetchFn: typeof fetch = fetch,
): Promise<{ adopted: string[]; skipped: string[] }>
  // POST /api/boards/adopt; a 401 returns { adopted: [], skipped: [] }

// auth/adopt.ts
export interface Adoptable {
  boardId: string
  editKey: string
}
/** Hosted boards created in this browser: both keys held locally. */
export function collectAdoptables(storage?: Storage): Adoptable[]
/**
 * Hosts one local (never-hosted) recents entry, returns its Adoptable,
 * or null when the local database is empty or hosting fails.
 */
export async function hostLocalBoard(
  localId: string,
  deps?: { /* createHostedBoard, uploadAsset, storage, now — test seams */ },
): Promise<Adoptable | null>
/** The whole flow, safe to run on every dashboard load. */
export async function adoptBrowserBoards(
  deps?: { storage?: Storage; fetchFn?: typeof fetch },
): Promise<{ adopted: string[]; skipped: string[] }>
```

- [ ] **Step 1: Write the failing tests**

`src/auth/adopt.test.ts` (happy-dom localStorage + fake-indexeddb, mirroring how `share.ts` and `recents.ts` are already tested — read those test files first and reuse their seeding helpers):

```typescript
it('collects only boards holding both keys, most recent first', () => {
  // recents: A (both keys), B (editKey only), C (viewKey only), D (no keys)
  // expect [A]; order follows listRecents order
})

it('hosts a local board then reports it adoptable', async () => {
  // seed a local board in fake-indexeddb via createBoardDoc +
  // persistBoard + a named meta; stub createHostedBoard/uploadAsset;
  // expect keys written, alias written, recents moved to the new id
})

it('adoptBrowserBoards posts hosted and local boards together', async () => {
  // stub fetch capturing the body; expect boards list =
  // hosted adoptables + hosted-local ones, and the response passed back
})

it('a signed-out response adopts nothing and touches nothing', async () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- src/auth/adopt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`collectAdoptables`:

```typescript
import { readKeys } from '../board/session/keys'
import { listRecents } from '../board/session/recents'

export function collectAdoptables(
  storage: Storage = localStorage,
): Adoptable[] {
  return listRecents(storage).flatMap((board) => {
    const keys = readKeys(board.id, storage)
    return keys?.editKey && keys.viewKey
      ? [{ boardId: board.id, editKey: keys.editKey }]
      : []
  })
}
```

`hostLocalBoard` — the share flow without a live session: open the doc (`createBoardDoc` + `persistBoard(doc, localId)` + `whenLoaded`), refuse when the store holds no elements AND the meta is the default (nothing worth hosting); `createHostedBoard()`; persist under the new id; upload image assets from the local `createAssetStore(localId)`; `writeKeys`, `writeAlias(localId, hostedId)`, `removeRecent(localId)`, `touchRecent` with the new id; destroy the temporary persistences; return `{ boardId, editKey }`. Wrap the whole body in try/catch returning null (adoption must never break the dashboard).

`adoptBrowserBoards`:

```typescript
export async function adoptBrowserBoards(deps: {
  storage?: Storage
  fetchFn?: typeof fetch
} = {}) {
  const storage = deps.storage ?? localStorage
  const hosted = collectAdoptables(storage)
  const locals = listRecents(storage).filter(
    (board) => readKeys(board.id, storage) === null,
  )
  for (const local of locals) {
    const adoptable = await hostLocalBoard(local.id, { storage })
    if (adoptable) {
      hosted.push(adoptable)
    }
  }
  if (hosted.length === 0) {
    return { adopted: [], skipped: [] }
  }
  return requestAdoption(hosted.slice(0, 50), deps.fetchFn)
}
```

- [ ] **Step 4: Run the suites**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "✨ feat(web): adopt the browser's boards into the account"
```

---

### Task 13: Dashboard

**Files:**
- Create: `apps/web/dashboard.html` (replace the Task 11 placeholder), `apps/web/src/dashboard/main.tsx`, `apps/web/src/dashboard/dashboard-app.tsx`, `apps/web/src/dashboard/board-card.tsx`, `apps/web/src/dashboard/settings.tsx`, `apps/web/src/dashboard/api.ts`, `apps/web/src/dashboard/dashboard.css`
- Test: `apps/web/src/dashboard/api.test.ts`, `apps/web/src/dashboard/dashboard-app.test.tsx`

**Interfaces:**
- Consumes: `fetchSession` (Task 11), `adoptBrowserBoards` (Task 12), `authClient.signOut`, `authClient.deleteUser`.
- Produces (`src/dashboard/api.ts`, thin fetch wrappers, each throwing `ServerError` from `session/server.ts` on non-ok):

```typescript
export interface DashboardBoard {
  id: string
  name: string
  updatedAt: string
  shared: boolean
  agent: boolean
}
export interface MeResponse {
  user: { name: string; email: string; image: string | null; plan: 'free' | 'pro' }
  billing: boolean
}
export async function fetchMe(fetchFn?: typeof fetch): Promise<MeResponse | null>  // null on 401
export async function fetchBoards(fetchFn?: typeof fetch): Promise<{ boards: DashboardBoard[]; cap: number | null }>
export async function deleteBoard(id: string, fetchFn?: typeof fetch): Promise<void>
export async function createApiKey(fetchFn?: typeof fetch): Promise<string>
export async function revokeApiKey(fetchFn?: typeof fetch): Promise<void>
export async function fetchUsage(fetchFn?: typeof fetch): Promise<{ month: string; count: number; limit: number }>
export async function startCheckout(interval: 'month' | 'year', fetchFn?: typeof fetch): Promise<string>  // url
export async function openPortal(fetchFn?: typeof fetch): Promise<string>  // url
```

- [ ] **Step 1: Write the failing tests**

`api.test.ts`: stubbed fetch per function — `fetchMe` maps 401 to null; `createApiKey` returns the key; `startCheckout` posts the interval and returns the url. Three or four focused cases.

`dashboard-app.test.tsx` (Testing Library, mirror the component-test style used in `src/board/components`):

```tsx
it('redirects to /login when signed out', async () => {
  // render with a deps prop { fetchMe: async () => null, navigate: spy }
  // expect navigate('/login?from=/dashboard')
})
it('renders the grid, the gauge, and New board', async () => {
  // 2 boards, cap 10 -> two cards, '2/10 boards', a New board button
})
it('hides the gauge and upgrade on pro', async () => {
  // fetchBoards -> cap: null; expect no '/10 boards' text, no Upgrade
})
it('deletes a board through its card menu', async () => {
  // confirm stubbed true; deleteBoard spy called with the id and the
  // card disappears from the grid
})
```

Give `DashboardApp` a `deps` prop with test seams for every `api.ts` function plus `navigate` and `adopt` (defaulting to the real ones), the pattern the board components already use for injectables.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- src/dashboard`
Expected: FAIL.

- [ ] **Step 3: Implement**

`dashboard.html` mirrors `board.html` (fonts, tokens, `<div id="root">`, module script `/src/dashboard/main.tsx`, title `Dashboard · tlwb`). `main.tsx` mounts `<DashboardApp />`.

`dashboard-app.tsx` behavior:

- On mount: `adopt()` (fire and forget, then refresh the list), `fetchMe()`; null -> `navigate('/login?from=/dashboard')`.
- Header: wordmark linking `/`, user name + avatar (image or initial), Sign out button (`authClient.signOut` then `navigate('/')`).
- "New board" button: `POST /api/boards` via `createHostedBoard()`, then `writeKeys(boardId, keys)` and `navigate('/b/<id>')`. A 403 shows the cap message inline with an Upgrade link when `billing` is true.
- Grid of `BoardCard`: thumbnail `<img src={'/api/me/boards/' + id + '/thumbnail'} loading="lazy">` with a gray fallback on error/204 (an `onError` swap to a plain div), name, `updatedAt` formatted with `Intl.DateTimeFormat`, badges `shared` / `agent connected` when true, card menu (Open, Delete with `confirm()`).
- Gauge when `cap !== null`: `{boards.length}/{cap} boards` plus, when `billing`, Upgrade buttons (monthly/yearly) calling `startCheckout` and `location.assign(url)`. After a `?checkout=success` return, show "payment confirming" and poll `fetchMe` a few times until `plan === 'pro'` (stop after 30 s, keep the notice).
- Settings section: plan line with "Manage billing" (`openPortal` -> assign) when subscribed; MCP API key block — "Generate key" shows the key once in a `<code>` with a copy button and the warning "shown once"; "Revoke" clears it; usage line "N / limit calls this month" from `fetchUsage`; Delete account (double `confirm()`, `authClient.deleteUser()`, navigate `/`).

Keep components presentational; every network call goes through the injected `deps`. Styling in `dashboard.css` with the existing tokens (`tokens.css` custom properties, one class block per component, same conventions as `board/components/*.css`).

- [ ] **Step 4: Run tests, typecheck, build**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm --filter @tlwb/web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): add the boards dashboard"
```

---

### Task 14: Editor and landing integration

**Files:**
- Modify: `apps/web/src/board/components/top-bar.tsx`, `apps/web/src/board/components/board-menu.tsx`, `apps/web/src/board/components/board-app.tsx` (or wherever presence identity is fed — find `loadIdentity()` call sites), `apps/web/src/landing/recents.ts`, `apps/web/index.html`
- Test: extend `apps/web/src/board/components` tests and `apps/web/src/landing` test if present

**Interfaces:**
- Consumes: `fetchSession` (Task 11), `requestAdoption` (Task 12), `readKeys`.

- [ ] **Step 1: Write the failing tests**

- Top bar: signed in, the logo link's `href` is `/dashboard`; signed out, `/`.
- Presence identity: with a session, the awareness name is the account name (color still from `loadIdentity`); without, unchanged. Test at the seam where identity is built (pass `me: Me | null` into the builder rather than fetching inside).
- Board menu: an entry "Add to my account" appears only when `me` is set, the board is hosted, and `readKeys` holds both keys; clicking posts adoption for this board and on success swaps to a "In your account" disabled entry.
- Landing: `renderResume` (or a sibling `renderSession(container, me)`) renders "Sign in" linking `/login` when `me` is null and "Dashboard" linking `/dashboard` otherwise.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- src/board/components src/landing`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

Fetch the session once at board startup (`fetchSession()` in the board `main.tsx` bootstrap, before or alongside the existing session construction) and thread `me` down as a prop; same one-shot fetch in `landing/recents.ts`'s bootstrap and in `index.html`'s header markup (add an anchor with id `session-link` the script fills). Presence: where the code currently does `loadIdentity()` to build awareness state, use `me ? { name: me.name, color: identity.color } : identity`. Keep every addition small; no new state libraries, no context providers — props.

- [ ] **Step 4: Run the suites and build**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm --filter @tlwb/web build && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): surface the account in the editor and landing"
```

---

### Task 15: End-to-end journey

**Files:**
- Create: `apps/web/e2e/session-helper.ts`, `apps/web/e2e/accounts.spec.ts`
- Modify: `apps/web/playwright.config.ts`

**Interfaces:**
- Consumes: the whole stack. The helper signs a session cookie the way Task 4's server-side helper does (same format, same secret) — port that helper here, do not invent a second format.

- [ ] **Step 1: Configure the server for accounts in e2e**

In `playwright.config.ts`, extend the collab-server `webServer.env`:

```typescript
AUTH_SECRET: 'e2e-secret-at-least-32-characters!!!',
GITHUB_CLIENT_ID: 'e2e',
GITHUB_CLIENT_SECRET: 'e2e',
FREE_BOARD_CAP: '2',
```

(The OAuth redirect is never followed; sessions are seeded directly.)

- [ ] **Step 2: Write the session helper**

`e2e/session-helper.ts`: connects with the `postgres` package (add it to `apps/web` devDependencies), inserts a `user` row and a `session` row (random ids, `expires_at` now + 1 h), computes the signed cookie value with the Task 4 signing function, and adds it to the Playwright context:

```typescript
await context.addCookies([
  {
    name: 'better-auth.session_token',
    value: signedValue,
    url: 'http://localhost:5173',
    httpOnly: true,
  },
])
```

First assertion of the suite: `GET /api/auth/get-session` through `page.request` answers the seeded user — this pins the cookie format before anything else runs.

- [ ] **Step 3: Write the journey**

`e2e/accounts.spec.ts` (one worker, mirroring `board.spec.ts` patterns):

```typescript
test('adopt, dashboard, cap', async ({ page, context }) => {
  // 1. Anonymously: open /, create a board, draw a rectangle, Share it
  //    (board.spec.ts shows how); localStorage now holds both keys.
  // 2. Seed a session (helper) and reload /dashboard.
  // 3. Expect the shared board's card, by name, in the grid.
  // 4. New board -> lands on /b/<id>; back to /dashboard: 2/2 boards.
  // 5. New board again -> the cap message appears, no third card.
  // 6. Open the first board from its card: the URL has no fragment and
  //    drawing still works (owner session granted edit).
})
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @tlwb/web e2e -- e2e/accounts.spec.ts`
Expected: PASS on both viewport projects. Then the full e2e: `pnpm --filter @tlwb/web e2e` — the pre-existing `board.spec.ts` must stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✅ test(web): drive sign-in, adoption, and the free cap end to end"
```

---

### Task 16: Deployment and documentation

**Files:**
- Modify: the Compose file that ships Caddy + collab-server (find it: `ls docker-compose*.yml deploy 2>/dev/null` at the root), the server README or `docs/` page that lists environment variables (find with `grep -rln "CORS_ORIGIN" --include="*.md" .`)

**Interfaces:** none (documentation and env plumbing only).

- [ ] **Step 1: Compose and Caddy**

Add the new environment variables (all optional, commented out with placeholder values) to the collab-server service: `AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `FREE_BOARD_CAP`, `MCP_QUOTA_FREE`, `MCP_QUOTA_PRO`. Caddy needs no change (`/api/*` already proxies `/auth`, `/me`, `/billing`; `try_files {path}.html` already serves `/login` and `/dashboard`) — verify by running the compose stack locally if it is runnable, otherwise by reading the Caddyfile against the new routes.

- [ ] **Step 2: Documentation**

In the environment-variable documentation, add a section for accounts (OAuth app setup for GitHub and Google, callback URLs `<origin>/api/auth/callback/github` and `/google`), billing (Stripe keys, the two price ids, webhook endpoint `<origin>/api/billing/webhook` and the events to subscribe: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`), and the quota knobs. State the degradation rule: no `AUTH_SECRET` means anonymous-only, no `STRIPE_SECRET_KEY` means no billing. In the MCP documentation page (the one written with the MCP server work), add the optional `Authorization: Bearer tlwb_<key>` header, where to generate the key, and the quota error text.

- [ ] **Step 3: Full verification**

Run: `pnpm check && pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/web test && pnpm --filter @tlwb/collab-server typecheck && pnpm --filter @tlwb/web typecheck`
Expected: PASS everywhere.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "📝 docs: document accounts, billing, and MCP key configuration"
```
