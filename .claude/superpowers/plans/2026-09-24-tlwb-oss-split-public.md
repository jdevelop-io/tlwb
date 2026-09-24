# tlwb Public Repository Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this repository into the anonymous, self-hostable whiteboard: remove accounts, billing, caps, quotas, and the dashboard, and replace them with one small extension port on the server and one `account` prop on the editor, so the private repository can compose the hosted service on top.

**Architecture:** `apps/collab-server` gains `src/extension.ts` (`identify`, `canCreateBoard`, `mcpKeys`, `migrate`, `mount`) and `src/index.ts` (its public surface), loses `accounts/`, `billing/`, `thumbnail.ts`, the account tables, and every account variable. `apps/web` loses the login, dashboard, and legal pages, the session thread through the editor, and gains `AccountProps` on `BoardApp` and `src/index.ts`. Two migrations: `0005` drops the owner foreign key and the thumbnail columns, `0006` drops the account tables. Each task leaves the tree green and the product anonymous.

**Tech Stack:** Node >= 22, TypeScript, Hono 4, Drizzle ORM 0.45 + drizzle-kit, postgres, `@modelcontextprotocol/sdk`, React 19, Vite 7, Vitest, Playwright, Biome.

**Spec:** `.claude/superpowers/specs/2026-09-24-tlwb-oss-saas-split-design.md` (read its section 13, "Amendments", too)

## Global Constraints

- Node >= 22, pnpm 11 (root `packageManager`). Biome from the root: `pnpm check` must pass (single quotes, no semicolons, trailing commas, 80 columns, organized imports). Run `pnpm check:write` before every commit.
- Files, code, comments, commit messages in English; no em-dashes; gitmoji + Conventional Commits; never add Claude attribution; never cite the plan or the spec in a commit message.
- Server tests run against Postgres: `docker compose up -d postgres` first; `DATABASE_URL` defaults to `postgres://tlwb:tlwb@localhost:5432/tlwb` in `apps/collab-server/vitest.config.ts` (`fileParallelism: false`). Run: `pnpm --filter @tlwb/collab-server test -- <file>`; typecheck: `pnpm --filter @tlwb/collab-server typecheck`.
- Web tests: `pnpm --filter @tlwb/web test -- <file>` (Vitest, happy-dom, fake-indexeddb); e2e: `pnpm --filter @tlwb/web e2e` (needs Postgres and Chromium: `pnpm --filter @tlwb/web exec playwright install chromium`).
- The web app calls `/api/*`; the Vite proxy and Caddy strip the `/api` prefix, so server routes live at the root (`/boards`, `/mcp`).
- When this plan is done, `grep -ri stripe` and `grep -riw plan` over the repository outside `.claude/` and `pnpm-lock.yaml` return nothing. `grep -ri "better-auth"` returns nothing at all.
- The words "user", "account", "sign in", "plan", "quota", "cap" do not appear in server or web source outside comments that explain the extension port.
- Nothing in this plan changes what an anonymous visitor can do today: draw, share, collaborate, drive an agent through `/mcp`.
- `MCP_RENDER_LIMIT_PER_MIN`, `@napi-rs/canvas`, `@fontsource/caveat`, and `@fontsource/inter` stay: the MCP tools `read_board` (with `image`) and `get_board_screenshot` render through them.

## Review Focus

1. A `POST /boards` from a browser that still carries an old `better-auth.session_token` cookie: the server must ignore the cookie and issue an anonymous board (no `owner_id`), never 500. Pinned in Task 2 (`http-boards.test.ts`, "ignores a session cookie when no extension identifies").
2. A `/mcp` call with `Authorization: Bearer tlwb_…` from an old API key against a server with no `mcpKeys` extension: the caller must be anonymous and rate limited per IP, never `invalid API key`. Pinned in Task 3 (`mcp/http.test.ts`, "ignores a bearer when no extension resolves keys").
3. A WebSocket upgrade on a board whose `owner_id` is a stale id from before the split: with no `identify`, the visitor must be treated like any keyed visitor (key required), and `markShared` must still fire for a keyed visitor. Pinned in Task 2 (`ws.test.ts`, "marks a board shared when a key-based visitor connects to it", kept).
4. Migration `0005` on a database where `boards.owner_id` still points at deleted users: the `UPDATE … SET owner_id = NULL` must run before the foreign key drop so `0006` can drop `user` without a constraint error. Pinned in Task 1 (`db/schema.test.ts`, "keeps ownership as an opaque column with no foreign key") and by the statement order written into `0005`.
5. The public web build must not reference `/login`, `/dashboard`, `/privacy`, or `/terms` anywhere: a Caddy `try_files` on those paths must fall through to the landing rather than serve a missing page. Pinned in Task 8 (`landing/index-html.test.ts`, "links nowhere the anonymous application does not serve").

## Existing code the tasks rely on (read before starting)

- `apps/collab-server/src/http.ts`: `createApp(deps: HttpDeps)`, `clientIp(c, trustProxy)`, `roleFor(board, token, userId)`, the route handlers named by path below, `app.onError` JSON shape.
- `apps/collab-server/src/ws.ts`: `attachWebSocket(server, deps: WsDeps)`, `resolve(upgrade, headers)` returns `{ role, foreignKey } | closeCode`, `nodeHeaders(request)`.
- `apps/collab-server/src/server.ts`: `startServer(config)` wires `connectDatabase`, `createRooms`, `createApp`, `attachWebSocket`.
- `apps/collab-server/src/mcp/index.ts`: `createMcpApp(deps)` resolves the bearer into a `Caller`; `src/mcp/caller.ts`: `Caller` union, `assertCaller`, `assertBoardAllowed`; `src/mcp/tools/create-board.ts`.
- `apps/collab-server/src/db/schema.ts`, `src/db/boards.ts`, `src/db/client.ts` (`connectDatabase` runs `migrate` from `src/migrations`).
- `apps/collab-server/src/rate-limit.ts`: `createIpLimiter(perMinute, windowMs, now)`, `IpLimiter`.
- `apps/web/src/board/components/board-app.tsx`, `top-bar.tsx`, `board-menu.tsx`, `share-dialog.tsx`; `apps/web/src/board/main.tsx`; `apps/web/src/board/session/board-session.ts` (`BoardSessionOptions.signedIn`), `identity.ts`, `server.ts`, `keys.ts`, `recents.ts`; `apps/web/src/landing/recents.ts`; `apps/web/index.html`; `apps/web/vite.config.ts`; `apps/web/Caddyfile`; `apps/web/playwright.config.ts`.

---

### Task 1: Drop the thumbnail and the owner foreign key

**Files:**
- Modify: `apps/collab-server/src/db/schema.ts:18-43`
- Modify: `apps/collab-server/src/db/boards.ts` (remove `readThumbnail`, `writeThumbnail`)
- Delete: `apps/collab-server/src/thumbnail.ts`, `apps/collab-server/test/thumbnail.test.ts`
- Modify: `apps/collab-server/src/http.ts` (remove the thumbnail route and import)
- Modify: `apps/collab-server/test/accounts/me.test.ts` (remove the thumbnail tests only)
- Create: `apps/collab-server/src/migrations/0005_drop-owner-fk-and-thumbnail.sql` (generated, then edited)
- Modify: `apps/collab-server/test/db/schema.test.ts`

**Interfaces:**
- Consumes: `boards` table, `bytea` custom type.
- Produces: `boards.ownerId` as a plain nullable `text` column with index `boards_owner_id_idx` and no foreign key; no `thumbnail` / `thumbnail_seq` columns.

- [ ] **Step 1: Write the failing schema test**

Replace the second and third tests in `apps/collab-server/test/db/schema.test.ts` with:

```ts
  it('keeps ownership as an opaque column with no foreign key', async () => {
    const columns = await database.db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'boards' and column_name in
        ('owner_id', 'shared_at', 'agent_at', 'thumbnail', 'thumbnail_seq')
    `)
    expect(columns.map((row) => row.column_name).sort()).toEqual([
      'agent_at',
      'owner_id',
      'shared_at',
    ])
    const constraints = await database.db.execute(sql`
      select constraint_name from information_schema.table_constraints
      where table_name = 'boards' and constraint_type = 'FOREIGN KEY'
    `)
    expect(constraints.length).toBe(0)
  })

  it('indexes boards.owner_id', async () => {
    const rows = await database.db.execute(sql`
      select indexname from pg_indexes where indexname = 'boards_owner_id_idx'
    `)
    expect(rows.length).toBe(1)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test -- test/db/schema.test.ts`
Expected: FAIL, the columns list still contains `thumbnail` and one foreign key exists.

- [ ] **Step 3: Change the schema**

In `apps/collab-server/src/db/schema.ts`, in the `boards` table: replace `ownerId: text('owner_id').references(() => user.id),` with `ownerId: text('owner_id'),` and delete the two lines `thumbnail: bytea('thumbnail'),` and `thumbnailSeq: bigint('thumbnail_seq', { mode: 'number' }),`. Update the index comment above the table options to:

```ts
  // `countOwnedBoards` and `listOwnedBoards` filter on this. The id is
  // opaque: whoever the extension's `identify` says a request is.
```

- [ ] **Step 4: Remove the thumbnail code**

Delete `apps/collab-server/src/thumbnail.ts` and `apps/collab-server/test/thumbnail.test.ts`. In `apps/collab-server/src/db/boards.ts` delete `readThumbnail` and `writeThumbnail`. In `apps/collab-server/src/http.ts` delete the import line `import { boardThumbnail, ThumbnailBudgetExceededError } from './thumbnail'` and the whole `app.get('/me/boards/:boardId/thumbnail', …)` handler. In `apps/collab-server/test/accounts/me.test.ts` delete every `it(...)` whose name mentions `thumbnail` (the file is deleted in Task 4; it only needs to compile and pass until then).

- [ ] **Step 5: Generate the migration and prepend the owner reset**

Run: `pnpm --filter @tlwb/collab-server exec drizzle-kit generate --name drop-owner-fk-and-thumbnail`
Expected: `src/migrations/0005_drop-owner-fk-and-thumbnail.sql` and `meta/0005_snapshot.json`, with the journal updated.

Open the generated SQL. It contains the constraint drop and the two column drops. Insert as the first statement:

```sql
UPDATE "boards" SET "owner_id" = NULL;--> statement-breakpoint
```

The final file reads (constraint name as generated, usually `boards_owner_id_user_id_fk`):

```sql
UPDATE "boards" SET "owner_id" = NULL;--> statement-breakpoint
ALTER TABLE "boards" DROP CONSTRAINT "boards_owner_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "boards" DROP COLUMN "thumbnail";--> statement-breakpoint
ALTER TABLE "boards" DROP COLUMN "thumbnail_seq";
```

- [ ] **Step 6: Run the server suite**

Run: `pnpm --filter @tlwb/collab-server typecheck && pnpm --filter @tlwb/collab-server test`
Expected: PASS. `connectDatabase` applies `0005` on the first test file.

- [ ] **Step 7: Commit**

```bash
pnpm check:write
git add apps/collab-server
git commit -m "🔥 refactor(db): drop board thumbnails and the owner foreign key"
```

---

### Task 2: The extension port on HTTP and WebSocket

**Files:**
- Create: `apps/collab-server/src/extension.ts`
- Modify: `apps/collab-server/src/http.ts`
- Modify: `apps/collab-server/src/ws.ts:203-210, 288-305`
- Modify: `apps/collab-server/src/server.ts`
- Modify: `apps/collab-server/test/http-boards.test.ts`, `apps/collab-server/test/ws.test.ts`, `apps/collab-server/test/rooms.test.ts:149`
- Delete: `apps/collab-server/test/accounts/adoption.test.ts`, `api-key-http.test.ts`, `auth-rate-limit.test.ts`, `deletion.test.ts`, `me.test.ts`, `apps/collab-server/test/billing/routes.test.ts`

**Interfaces:**
- Produces:

```ts
// src/extension.ts
export interface Principal { id: string }
export interface McpKeys {
  resolve(bearer: string): Promise<{ userId: string; boardIds: string[] | null } | 'invalid'>
  spend(userId: string): Promise<boolean>
}
export interface ExtensionContext {
  db: Db; config: Config; rooms: RoomRegistry
  clientIp(c: Context<Env>): string
  createIpLimiter(perMinute: number): IpLimiter
}
export interface Extension {
  identify?(headers: Headers): Promise<Principal | null>
  canCreateBoard?(principalId: string): Promise<boolean>
  mcpKeys?: McpKeys
  migrate?(db: Db): Promise<void>
  mount?(app: Hono<Env>, ctx: ExtensionContext): void
}
export async function identify(extension: Extension, headers: Headers): Promise<Principal | null>
```

  `HttpDeps.extension?: Extension`, `WsDeps.extension?: Extension`, `startServer(config, extension = {})`. `McpDeps.extension` is wired in Task 3; `migrate` in Task 5.

- [ ] **Step 1: Create the port**

`apps/collab-server/src/extension.ts`:

```ts
import type { HttpBindings } from '@hono/node-server'
import type { Context, Hono } from 'hono'
import type { Config } from './config'
import type { Db } from './db/client'
import type { IpLimiter } from './rate-limit'
import type { RoomRegistry } from './rooms'

export type Env = { Bindings: HttpBindings }

/** Whoever a request is, by an id this server never interprets. */
export interface Principal {
  id: string
}

export interface McpKeys {
  /** A bearer presented to /mcp: who it belongs to and which boards it
   * may reach (null: every board its share links resolve). */
  resolve(
    bearer: string,
  ): Promise<{ userId: string; boardIds: string[] | null } | 'invalid'>
  /** One tool call is about to run for this key's owner. False refuses it. */
  spend(userId: string): Promise<boolean>
}

export interface ExtensionContext {
  db: Db
  config: Config
  rooms: RoomRegistry
  /** The visitor's address, honouring TRUST_PROXY the way the core does. */
  clientIp(c: Context<Env>): string
  /** A per-address token bucket refilled every minute. */
  createIpLimiter(perMinute: number): IpLimiter
}

/**
 * What a deployment may add on top of the anonymous server. Every
 * member is optional; with none of them, everyone is anonymous, any
 * principal may create boards, bearers on /mcp are ignored, and no
 * extra route exists.
 */
export interface Extension {
  /** Who this request is, from its headers. Absent, or null: anonymous. */
  identify?(headers: Headers): Promise<Principal | null>
  /** May this principal create one more board? Absent: always. */
  canCreateBoard?(principalId: string): Promise<boolean>
  /** Bearer keys presented to /mcp. Absent: anonymous callers only. */
  mcpKeys?: McpKeys
  /** Runs once, right after this server's own migrations, before listening. */
  migrate?(db: Db): Promise<void>
  /** Extra routes, registered before the core ones. */
  mount?(app: Hono<Env>, ctx: ExtensionContext): void
}

export async function identify(
  extension: Extension,
  headers: Headers,
): Promise<Principal | null> {
  return extension.identify ? extension.identify(headers) : null
}
```

- [ ] **Step 2: Write the failing HTTP tests**

In `apps/collab-server/test/http-boards.test.ts`, change the `app` helper to accept an extension and replace the `GET /auth/*` describe block:

```ts
import type { Extension } from '../src/extension'

function app(
  overrides: Record<string, string> = {},
  now?: () => number,
  extension: Extension = {},
) {
  const config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    ...overrides,
  })
  return createApp({
    db: database.db,
    config,
    rooms: createRooms({ db: database.db, config }),
    now,
    extension,
  })
}
```

```ts
describe('extension', () => {
  it('ignores a session cookie when no extension identifies', async () => {
    const response = await app().request(
      new Request('http://server/boards', {
        method: 'POST',
        headers: { cookie: 'better-auth.session_token=stale' },
      }),
    )
    expect(response.status).toBe(201)
    const stored = await findBoard(database.db, (await response.json()).boardId)
    expect(stored?.ownerId).toBeNull()
  })

  it('owns a created board by whoever identify answers', async () => {
    const identified = app({}, undefined, {
      identify: async (headers) =>
        headers.get('x-who') ? { id: headers.get('x-who') as string } : null,
    })
    const response = await identified.request(
      new Request('http://server/boards', {
        method: 'POST',
        headers: { 'x-who': 'p1' },
      }),
    )
    expect(response.status).toBe(201)
    const stored = await findBoard(database.db, (await response.json()).boardId)
    expect(stored?.ownerId).toBe('p1')
  })

  it('refuses creation with 403 when canCreateBoard says no', async () => {
    const capped = app({}, undefined, {
      identify: async () => ({ id: 'p2' }),
      canCreateBoard: async (id) => id !== 'p2',
    })
    const response = await capped.request(post())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'board limit reached' })
  })

  it('mounts extra routes with the core context', async () => {
    const mounted = app({ TRUST_PROXY: 'true' }, () => 0, {
      mount: (hono, ctx) => {
        const limiter = ctx.createIpLimiter(1)
        hono.get('/whoami', (c) =>
          limiter.take(ctx.clientIp(c))
            ? c.json({ ip: ctx.clientIp(c), rooms: typeof ctx.rooms.acquire })
            : c.json({ error: 'too many requests' }, 429),
        )
      },
    })
    const first = await mounted.request(
      new Request('http://server/whoami', {
        headers: { 'x-forwarded-for': '9.9.9.9' },
      }),
    )
    expect(await first.json()).toEqual({ ip: '9.9.9.9', rooms: 'function' })
    const second = await mounted.request(
      new Request('http://server/whoami', {
        headers: { 'x-forwarded-for': '9.9.9.9' },
      }),
    )
    expect(second.status).toBe(429)
  })

  it('lets identify grant the owner edit on assets without a key', async () => {
    const owner = app({}, undefined, { identify: async () => ({ id: 'p3' }) })
    const created = await (await owner.request(post())).json()
    const bytes = new Uint8Array([137, 80, 78, 71])
    const hash = createHash('sha256').update(bytes).digest('hex')
    const put = await owner.request(
      new Request(`http://server/boards/${created.boardId}/assets/${hash}`, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: bytes,
      }),
    )
    expect(put.status).toBe(201)
  })
})
```

Add `import { createHash } from 'node:crypto'` at the top. Keep the `roleFor` describe block unchanged.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @tlwb/collab-server test -- test/http-boards.test.ts`
Expected: FAIL to compile, `extension` is not a known property of `HttpDeps`.

- [ ] **Step 4: Rewrite the HTTP application around the port**

In `apps/collab-server/src/http.ts`:

Delete these imports: `Stripe`, `issueApiKey, listApiKeys, revokeApiKey`, `type Auth, createAuth, sessionUser`, `accountCleanup`, `monthOf, readUsage`, `createBillingApp`, `claimBoard, countOwnedBoards, deleteBoardRows, listOwnedBoards` (keep `type BoardRecord` and `findBoard`), `readBoardStore`, and `z` from zod if nothing else uses it. Add `import { type Extension, identify } from './extension'`.

Replace `HttpDeps`:

```ts
export interface HttpDeps {
  db: Db
  config: Config
  rooms: RoomRegistry
  now?: () => number
  /** Shared with the MCP `create_board` tool; created here when absent. */
  createLimiter?: IpLimiter
  /** What the deployment adds on top; nothing by default. */
  extension?: Extension
}
```

Rename `roleFor`'s third parameter from `userId` to `principalId` and update its doc comment:

```ts
/**
 * The board's owner (whoever the extension identified) always edits, no
 * key needed; anyone else falls back to the token the request presented.
 * Side effect free.
 */
```

In `createApp`: add `const extension = deps.extension ?? {}` after `now`. Delete `authLimiter`, `stripe`, `auth`, the `if (auth) { … }` block, and the `if (config.billing) { … }` block. Right after `app.get('/health', …)`, add:

```ts
  extension.mount?.(app, {
    db,
    config,
    rooms: deps.rooms,
    clientIp: (c) => clientIp(c, config.trustProxy),
    createIpLimiter: (perMinute) => createIpLimiter(perMinute, 60_000, now),
  })
```

Rewrite `POST /boards`:

```ts
  app.post('/boards', async (c) => {
    if (!createLimiter.take(clientIp(c, config.trustProxy))) {
      return c.json({ error: 'too many boards created' }, 429)
    }
    const principal = await identify(extension, c.req.raw.headers)
    if (
      principal &&
      extension.canCreateBoard &&
      !(await extension.canCreateBoard(principal.id))
    ) {
      return c.json({ error: 'board limit reached' }, 403)
    }
    const issued = await issueBoard(db, principal?.id)
    if (!issued) {
      return c.json({ error: 'internal error' }, 500)
    }
    return c.json(issued, 201)
  })
```

Delete in full: the `adoptBody` schema and `app.post('/boards/adopt', …)`, `app.get('/me', …)`, `app.get('/me/boards', …)`, `app.get('/me/api-keys', …)`, `app.post('/me/api-keys', …)`, `app.delete('/me/api-keys/:id', …)`, `app.get('/me/usage', …)`, `app.delete('/boards/:boardId', …)`.

Rewrite `requestRole`:

```ts
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
    const principal = await identify(extension, c.req.raw.headers)
    return roleFor(board, token, principal?.id ?? null)
  }
```

Leave the `createMcpApp({...})` call as it is for now (Task 3 adds `extension` to it).

- [ ] **Step 5: Wire the port through the WebSocket upgrade**

In `apps/collab-server/src/ws.ts`: replace the two `accounts/auth` imports with `import { type Extension, identify } from './extension'`. In `WsDeps` replace `auth: Auth | null` with `extension?: Extension`. In `resolve`:

```ts
    const principal = await identify(deps.extension ?? {}, headers)
    const role = roleFor(board, upgrade.token || null, principal?.id ?? null)
    if (!role) {
      return CLOSE.unauthorized
    }
    // A key-based connection on an owned board is someone else using a
    // share link: that is what a dashboard's "shared" badge reports.
    const foreignKey =
      board.ownerId !== null && principal?.id !== board.ownerId
    return { role, foreignKey }
```

Update the `nodeHeaders` doc comment to `/** Node's raw header map, reshaped into the `Headers` the extension reads. */`.

- [ ] **Step 6: Wire the port through startServer**

`apps/collab-server/src/server.ts`: delete the `createAuth` import and the `const auth = …` line; change the signature and the two calls:

```ts
export async function startServer(
  config: Config,
  extension: Extension = {},
): Promise<RunningServer> {
  const database = await connectDatabase(config.databaseUrl)
  const rooms = createRooms({ db: database.db, config })
  const app = createApp({ db: database.db, config, rooms, extension })
```

```ts
  const wss = attachWebSocket(server, {
    db: database.db,
    config,
    rooms,
    extension,
  })
```

Add `import type { Extension } from './extension'`.

- [ ] **Step 7: Adapt the WebSocket and rooms tests**

In `apps/collab-server/test/rooms.test.ts` delete the line `auth: null,` at line 149.

In `apps/collab-server/test/ws.test.ts`: delete the imports of `createAuth`, `session as sessionTable, user` (keep `boards`), and `sessionCookie`; delete `AUTH_ENV`. Change `serve` to take an extension:

```ts
async function serve(
  overrides: Record<string, string> = {},
  ping?: number,
  extension: Extension = {},
) {
```

and pass `extension` to `attachWebSocket` in place of `auth` (delete the `createAuth` line and its comment). Add `import type { Extension } from '../src/extension'`.

Rewrite the first ownership test. Its body keeps every step from `const client = new WsClient(` onward unchanged; the setup becomes:

```ts
  it('grants the identified owner edit access without a key', async () => {
    const ownerId = randomUUID()
    const server = await serve({}, undefined, {
      identify: async (headers) =>
        headers.get('x-who') === ownerId ? { id: ownerId } : null,
    })
    try {
      await database.db
        .update(boards)
        .set({ ownerId })
        .where(eq(boards.id, server.boardId))

      const client = new WsClient(
        `ws://localhost:${server.port}/ws/${server.boardId}`,
        { headers: { 'x-who': ownerId } },
      )
```

In the second ownership test ("marks a board shared when a key-based visitor connects to it") delete the `await database.db.insert(user).values({...})` statement; keep the `update(boards).set({ ownerId })` and everything else.

Delete `apps/collab-server/test/accounts/adoption.test.ts`, `api-key-http.test.ts`, `auth-rate-limit.test.ts`, `deletion.test.ts`, `me.test.ts`, and `apps/collab-server/test/billing/routes.test.ts`: every route they cover is gone.

- [ ] **Step 8: Run the server suite**

Run: `pnpm --filter @tlwb/collab-server typecheck && pnpm --filter @tlwb/collab-server test`
Expected: PASS, including the five new `extension` tests and both WebSocket ownership tests. `test/accounts/auth.test.ts`, `api-keys.test.ts`, `quota.test.ts`, and `test/mcp/tools.test.ts` still pass untouched.

- [ ] **Step 9: Commit**

```bash
pnpm check:write
git add apps/collab-server
git commit -m "♻️ refactor(server): resolve requests through an extension port"
```

---

### Task 3: The extension port on MCP

**Files:**
- Modify: `apps/collab-server/src/mcp/server.ts:20-33`
- Modify: `apps/collab-server/src/mcp/index.ts:6, 36-55`
- Modify: `apps/collab-server/src/mcp/caller.ts`
- Modify: `apps/collab-server/src/mcp/tools/create-board.ts`
- Modify: `apps/collab-server/src/http.ts` (the `createMcpApp` call)
- Modify: `apps/collab-server/test/mcp/tools.test.ts:736-956`, `apps/collab-server/test/mcp/http.test.ts`

**Interfaces:**
- Consumes: `Extension`, `McpKeys` from Task 2.
- Produces: `McpDeps.extension: Extension`; `Caller` keyed variant `{ kind: 'keyed'; ip; userId; boardIds }` (no `plan`); tool error texts `invalid API key`, `API key quota exhausted`, `board limit reached`.

- [ ] **Step 1: Write the failing tests**

In `apps/collab-server/test/mcp/http.test.ts`, extend the `app` helper with a third parameter `extension: Extension = {}` passed to `createApp`, import `type Extension` from `../../src/extension`, and add inside `describe('POST /mcp', …)`:

```ts
  it('ignores a bearer when no extension resolves keys', async () => {
    const request = rpc('tools/list')
    request.headers.set('authorization', 'Bearer tlwb_stale')
    const response = await app({ TRUST_PROXY: 'true' }).request(request)
    expect(response.status).toBe(200)
  })
```

`rpc` builds a `Request`; `Request.headers` is mutable before it is sent, so `set` works.

In `apps/collab-server/test/mcp/tools.test.ts`: delete the imports of `issueApiKey` and `user` (keep `boards`), add `import type { Extension } from '../../src/extension'`, and rewrite the `describe('keyed callers', …)` block's helpers and the four tests before `describe('board scope', …)`:

```ts
describe('keyed callers', () => {
  interface Stub {
    keys: Map<string, { userId: string; boardIds: string[] | null }>
    budget: Map<string, number>
    cap: Set<string>
  }

  function stub(): Stub {
    return { keys: new Map(), budget: new Map(), cap: new Set() }
  }

  function extensionOf(s: Stub): Extension {
    return {
      mcpKeys: {
        resolve: async (bearer) => s.keys.get(bearer) ?? 'invalid',
        spend: async (userId) => {
          const left = s.budget.get(userId) ?? Number.POSITIVE_INFINITY
          if (left < 1) {
            return false
          }
          s.budget.set(userId, left - 1)
          return true
        },
      },
      canCreateBoard: async (id) => !s.cap.has(id),
    }
  }

  function httpApp(
    overrides: Record<string, string> = {},
    extension: Extension = {},
  ) {
    const httpConfig = loadConfig({
      DATABASE_URL: url,
      CORS_ORIGIN: 'http://web.test',
      ROOM_IDLE_MS: '50',
      TRUST_PROXY: 'true',
      ...overrides,
    })
    return createApp({
      db: database.db,
      config: httpConfig,
      rooms: createRooms({ db: database.db, config: httpConfig }),
      extension,
    })
  }
```

Keep `mcpRequest` and `toolResult` as they are. Replace `seedUser` and the four tests:

```ts
  it('a resolved key spends the budget and an exhausted one errors', async () => {
    const s = stub()
    s.keys.set('good', { userId: 'u1', boardIds: null })
    s.budget.set('u1', 1)
    const app = httpApp({}, extensionOf(s))

    const first = await toolResult(
      await app.request(
        mcpRequest({ name: 'create_board', arguments: {} }, { bearer: 'good' }),
      ),
    )
    expect(first.isError).toBeFalsy()
    const second = await toolResult(
      await app.request(
        mcpRequest({ name: 'create_board', arguments: {} }, { bearer: 'good' }),
      ),
    )
    expect(second.isError).toBe(true)
    expect((second.content[0] as { text: string }).text).toBe(
      'API key quota exhausted',
    )
  })

  it('refuses a bearer the extension does not know', async () => {
    const app = httpApp({}, extensionOf(stub()))
    const result = await toolResult(
      await app.request(
        mcpRequest({ name: 'create_board', arguments: {} }, { bearer: 'nope' }),
      ),
    )
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toBe(
      'invalid API key',
    )
  })

  it('is not bounded by the board-creation limiter, unlike an anonymous caller', async () => {
    const s = stub()
    s.keys.set('good', { userId: 'u2', boardIds: null })
    const app = httpApp({ CREATE_LIMIT_PER_MIN: '1' }, extensionOf(s))
    for (let i = 0; i < 2; i += 1) {
      const result = await toolResult(
        await app.request(
          mcpRequest(
            { name: 'create_board', arguments: {} },
            { bearer: 'good' },
          ),
        ),
      )
      expect(result.isError).toBeFalsy()
    }
  })

  it('owns every board it creates and honours canCreateBoard', async () => {
    const s = stub()
    s.keys.set('good', { userId: 'u3', boardIds: null })
    const app = httpApp({}, extensionOf(s))

    const first = await toolResult(
      await app.request(
        mcpRequest({ name: 'create_board', arguments: {} }, { bearer: 'good' }),
      ),
    )
    expect(first.isError).toBeFalsy()
    const board = JSON.parse((first.content[0] as { text: string }).text) as {
      boardId: string
    }
    const [row] = await database.db
      .select({ ownerId: boards.ownerId })
      .from(boards)
      .where(eq(boards.id, board.boardId))
    expect(row?.ownerId).toBe('u3')

    s.cap.add('u3')
    const second = await toolResult(
      await app.request(
        mcpRequest({ name: 'create_board', arguments: {} }, { bearer: 'good' }),
      ),
    )
    expect(second.isError).toBe(true)
    expect((second.content[0] as { text: string }).text).toBe(
      'board limit reached',
    )
  })
```

Inside `describe('board scope', …)`, wherever the existing code calls `seedUser()` and `issueApiKey(...)` to obtain a key, replace with a stub: `const s = stub(); s.keys.set('scoped', { userId: 'u4', boardIds: [insideId] }); app = httpApp({}, extensionOf(s))` and use `bearer: 'scoped'`. Read the block first; it creates `insideId` from an anonymous `create_board` call before issuing the scoped key, so the order of operations stays the same and only the key source changes.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/tools.test.ts test/mcp/http.test.ts`
Expected: FAIL to compile (`extension` unknown on `HttpDeps`' `createMcpApp` path is fine; the failure is the stub typing against `McpDeps`), or FAIL at runtime with `invalid API key` where a resolved key was expected.

- [ ] **Step 3: Thread the extension into MCP**

`apps/collab-server/src/mcp/server.ts`: add `import type { Extension } from '../extension'` and the member `extension: Extension` to `McpDeps` (after `renderLimiter`).

`apps/collab-server/src/mcp/index.ts`: delete `import { API_KEY_PREFIX, resolveApiKey } from '../accounts/api-keys'`. Replace the caller resolution:

```ts
      const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
      let caller: Caller = { kind: 'anonymous', ip }
      // With nothing to resolve a key against, a bearer is noise: the
      // caller stays anonymous rather than being refused.
      if (bearer && deps.extension.mcpKeys) {
        const keyed = await deps.extension.mcpKeys.resolve(bearer)
        caller =
          keyed === 'invalid'
            ? { kind: 'invalid', ip }
            : {
                kind: 'keyed',
                ip,
                userId: keyed.userId,
                boardIds: keyed.boardIds,
              }
      }
```

`apps/collab-server/src/mcp/caller.ts`: delete the `accounts/quota` import; remove `plan` from the keyed variant; rewrite `assertCaller`:

```ts
/**
 * The first check every tool runs. Anonymous callers pass through
 * untouched (the per-IP app limiter already ran); an invalid key is
 * refused outright; a keyed caller asks the extension to spend one
 * unit for its owner and is refused when it declines.
 */
export async function assertCaller(
  deps: McpDeps,
  caller: Caller,
): Promise<void> {
  if (caller.kind === 'anonymous') {
    return
  }
  if (caller.kind === 'invalid') {
    throw new ToolError('invalid API key')
  }
  const ok = deps.extension.mcpKeys
    ? await deps.extension.mcpKeys.spend(caller.userId)
    : true
  if (!ok) {
    throw new ToolError('API key quota exhausted')
  }
}
```

Update the `Caller` doc comment: `keyed` "asks the extension for a unit of budget per call and, when `boardIds` is non-null, restricts the boards it may reach".

`apps/collab-server/src/mcp/tools/create-board.ts`: delete the `countOwnedBoards` import; replace the cap block:

```ts
        // The same ceiling `POST /boards` enforces: without it, a keyed
        // caller could create boards no ceiling ever counts.
        if (
          caller.kind === 'keyed' &&
          deps.extension.canCreateBoard &&
          !(await deps.extension.canCreateBoard(caller.userId))
        ) {
          throw new ToolError('board limit reached')
        }
```

`apps/collab-server/src/http.ts`: add `extension,` to the `createMcpApp({...})` call.

In `apps/collab-server/test/mcp/tools.test.ts` `connect` helper, add `extension: {},` to the `deps` literal.

- [ ] **Step 4: Run the server suite**

Run: `pnpm --filter @tlwb/collab-server typecheck && pnpm --filter @tlwb/collab-server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check:write
git add apps/collab-server
git commit -m "♻️ refactor(mcp): resolve API keys and budgets through the extension"
```

---

### Task 4: Remove accounts, billing, and quotas from the server

**Files:**
- Delete: `apps/collab-server/src/accounts/`, `apps/collab-server/src/billing/`, `apps/collab-server/src/db/users.ts`, `apps/collab-server/test/accounts/`, `apps/collab-server/test/billing/`, `apps/collab-server/test/db/auth-tables.test.ts`, `apps/collab-server/test/session-cookie.ts`
- Modify: `apps/collab-server/src/db/schema.ts` (drop six tables), `apps/collab-server/src/config.ts`, `apps/collab-server/package.json`, `apps/collab-server/test/config.test.ts`, `apps/collab-server/test/db/schema.test.ts`
- Create: `apps/collab-server/src/migrations/0006_drop-account-tables.sql` (generated)

**Interfaces:**
- Produces: `Config` without `accounts`, `billing`, `freeBoardCap`, `mcpQuotaFree`, `mcpQuotaPro`, `authLimitPerMin`; schema with `boards`, `boardUpdates`, `assets` only.

- [ ] **Step 1: Write the failing tests**

Replace the first test of `apps/collab-server/test/db/schema.test.ts`:

```ts
  it('creates only the board tables', async () => {
    const rows = await database.db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
        and table_name not like '\_\_drizzle%'
    `)
    expect(rows.map((row) => row.table_name).sort()).toEqual([
      'assets',
      'board_updates',
      'boards',
    ])
  })
```

In `apps/collab-server/test/config.test.ts`: delete the `accounts config`, `billing config`, and `public origin requirement` describe blocks in full, and the line `authLimitPerMin: 300,` in the defaults expectation. Add to the defaults describe:

```ts
  it('knows nothing about accounts, billing, caps, or quotas', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      CORS_ORIGIN: '*',
      AUTH_SECRET: 's',
      STRIPE_SECRET_KEY: 'sk',
      FREE_BOARD_CAP: '1',
      MCP_QUOTA_FREE: '1',
    })
    expect(Object.keys(config)).not.toContain('accounts')
    expect(Object.keys(config)).not.toContain('billing')
    expect(Object.keys(config)).not.toContain('freeBoardCap')
    expect(Object.keys(config)).not.toContain('mcpQuotaFree')
    expect(Object.keys(config)).not.toContain('authLimitPerMin')
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tlwb/collab-server test -- test/config.test.ts test/db/schema.test.ts`
Expected: FAIL, six extra tables listed and `accounts` present on the config.

- [ ] **Step 3: Delete the modules and the tables**

Delete the directories and files listed under **Files: Delete**. In `apps/collab-server/src/db/schema.ts` delete the `user`, `session`, `account`, `verification`, `apiKeys`, and `mcpUsage` table definitions and the now unused imports (`boolean`, `uniqueIndex`, `index` if nothing else uses it; keep `bigint` for `snapshotSeq` and `boardUpdates.seq`).

In `apps/collab-server/src/config.ts`: delete `AccountsConfig`, `BillingConfig`, `provider`, `accountsConfig`, `billingConfig`; in `Config` delete `authLimitPerMin`, `accounts`, `billing`, `freeBoardCap`, `mcpQuotaFree`, `mcpQuotaPro` (and the `authLimitPerMin` doc comment); in `loadConfig` delete the `accounts`/`billing` locals, the `PUBLIC_URL` guard block and its comment, and the six corresponding entries in the returned object. `publicUrl` keeps its `env.PUBLIC_URL || corsOrigin` default.

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @tlwb/collab-server exec drizzle-kit generate --name drop-account-tables`
Expected: `src/migrations/0006_drop-account-tables.sql` with `DROP TABLE` for `mcp_usage`, `api_keys`, `verification`, `session`, `account`, `user` (drizzle emits `CASCADE` where needed). Read it: it must not touch `boards`.

- [ ] **Step 5: Remove the dependencies**

Run: `pnpm --filter @tlwb/collab-server remove better-auth stripe`
Expected: both gone from `apps/collab-server/package.json`; `pnpm-lock.yaml` updated.

- [ ] **Step 6: Run the server suite and grep**

Run: `pnpm --filter @tlwb/collab-server typecheck && pnpm --filter @tlwb/collab-server test`
Expected: PASS.

Run: `grep -rniE "stripe|better-auth|sessionUser|freeBoardCap|mcpQuota|authLimit" apps/collab-server/src apps/collab-server/test`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
pnpm check:write
git add apps/collab-server pnpm-lock.yaml
git commit -m "🔥 refactor(server): remove accounts, billing, caps, and quotas"
```

---

### Task 5: The public entry point and the migrate hook

**Files:**
- Create: `apps/collab-server/src/index.ts`
- Modify: `apps/collab-server/src/server.ts`, `apps/collab-server/package.json`
- Create: `apps/collab-server/test/index.test.ts`

**Interfaces:**
- Produces: `@tlwb/collab-server` importable by the private repository with exactly the names listed in the spec's section 5; `startServer` calls `extension.migrate(db)` after `connectDatabase`.

- [ ] **Step 1: Write the failing test**

`apps/collab-server/test/index.test.ts`:

```ts
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as api from '../src/index'

describe('public surface', () => {
  it('exports exactly what a deployment composes with', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'ConfigError',
        'boards',
        'claimBoard',
        'clientIp',
        'countOwnedBoards',
        'createIpLimiter',
        'deleteBoardRows',
        'disownBoards',
        'findBoard',
        'identify',
        'listOwnedBoards',
        'loadConfig',
        'log',
        'readBoardStore',
        'resolveRole',
        'startServer',
      ].sort(),
    )
  })

  it('runs the extension migration after its own, before listening', async () => {
    const seen: string[] = []
    const server = await api.startServer(
      api.loadConfig({
        DATABASE_URL: process.env.DATABASE_URL,
        CORS_ORIGIN: 'http://a',
        PORT: '0',
      }),
      {
        migrate: async (db) => {
          const rows = await db.execute(sql`
            select table_name from information_schema.tables
            where table_name = 'boards'
          `)
          seen.push(rows.length === 1 ? 'boards ready' : 'boards missing')
        },
      },
    )
    try {
      expect(seen).toEqual(['boards ready'])
      const health = await fetch(`http://localhost:${server.port}/health`)
      expect(health.status).toBe(200)
    } finally {
      await server.close()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test -- test/index.test.ts`
Expected: FAIL, `../src/index` does not exist.

- [ ] **Step 3: Write the entry point and the hook**

`apps/collab-server/src/index.ts`:

```ts
export { readBoardStore } from './board-read'
export { type Config, ConfigError, loadConfig } from './config'
export {
  type BoardRecord,
  claimBoard,
  countOwnedBoards,
  deleteBoardRows,
  disownBoards,
  findBoard,
  listOwnedBoards,
  type OwnedBoard,
} from './db/boards'
export type { Db } from './db/client'
export { boards } from './db/schema'
export {
  type Env,
  type Extension,
  type ExtensionContext,
  identify,
  type McpKeys,
  type Principal,
} from './extension'
export { clientIp } from './http'
export { type Role, resolveRole } from './keys'
export { log } from './log'
export { createIpLimiter, type IpLimiter } from './rate-limit'
export type { RoomRegistry } from './rooms'
export { type RunningServer, startServer } from './server'
```

Types do not appear in `Object.keys`, which is why the test lists values only.

In `apps/collab-server/src/server.ts`, after `const database = await connectDatabase(config.databaseUrl)`:

```ts
  // The deployment's own tables may reference this server's, so its
  // migrations run once ours have.
  await extension.migrate?.(database.db)
```

In `apps/collab-server/package.json`, after `"type": "module",`:

```json
  "exports": {
    ".": "./src/index.ts"
  },
```

- [ ] **Step 4: Run the server suite**

Run: `pnpm --filter @tlwb/collab-server typecheck && pnpm --filter @tlwb/collab-server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check:write
git add apps/collab-server
git commit -m "✨ feat(server): expose the composition surface as a package"
```

---

### Task 6: Server and repository documentation

**Files:**
- Modify: `apps/collab-server/README.md:18-125, 147-180`
- Modify: `README.md:51-68`
- Modify: `docker-compose.yml:36-52`

- [ ] **Step 1: Rewrite the configuration section of the server README**

In the variables table delete the rows `AUTH_LIMIT_PER_MIN`, `AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `FREE_BOARD_CAP`, `MCP_QUOTA_FREE`, `MCP_QUOTA_PRO`. Change the `PUBLIC_URL` row's meaning to: `The server's own public origin, used to build the share URLs MCP returns`.

Delete every paragraph from "Accounts and billing are both optional" down to the end of the paragraph that starts "To offer billing" (the one ending "independently of whether billing is configured."). In their place:

````markdown
## Extending the server

The server is anonymous: nobody signs in, boards have no owner, and the
only limits are per address. A deployment that wants accounts, ownership,
API keys, or anything else on top composes them through one optional
argument:

```ts
import { loadConfig, startServer } from '@tlwb/collab-server'

await startServer(loadConfig(process.env), {
  identify: async (headers) => lookupSession(headers), // { id } or null
  canCreateBoard: async (principalId) => true,
  mcpKeys: {
    resolve: async (bearer) => ({ userId: 'u1', boardIds: null }),
    spend: async (userId) => true,
  },
  migrate: async (db) => runMyMigrations(db),
  mount: (app, ctx) => app.get('/me', (c) => c.json({ ok: true })),
})
```

- `identify` names the principal behind a request. A board created
  by an identified principal is owned by it (`boards.owner_id`), and the
  owner edits its boards with no key, over HTTP and WebSocket alike.
- `canCreateBoard` may refuse one more board for a principal; `POST
  /boards` answers `403 board limit reached` and the MCP `create_board`
  tool answers the same text.
- `mcpKeys` gives meaning to an `Authorization: Bearer` header on
  `/mcp`: `resolve` says who the key is and which boards it may reach,
  `spend` is asked before every tool call and refuses with `API key
  quota exhausted`. Without it, bearers are ignored.
- `migrate` runs after this server's own migrations, so the
  deployment's tables can reference `boards`.
- `mount` registers extra routes on the same Hono application, with
  the database, the configuration, the rooms, and the same address and
  rate-limit helpers the core uses.

Everything the package exports is listed in `src/index.ts`; nothing
else is a stable surface.
````

In the MCP section, replace the paragraph starting "An optional `Authorization: Bearer tlwb_<key>` header" with:

```markdown
An `Authorization: Bearer` header is ignored unless the deployment
composes an `mcpKeys` extension (see "Extending the server"). Without
one, every call is anonymous and subject only to the per-IP
`MCP_LIMIT_PER_MIN` limit.
```

- [ ] **Step 2: Trim the root README and the Compose file**

In `README.md`, the "Running the product" section stays; append one sentence after "the Vite server proxies `/api` and `/ws` to the collaboration server.":

```markdown
The self-hosted product is anonymous by design: no accounts, no sign-in,
nothing to configure beyond the variables in `apps/collab-server/README.md`.
```

In `docker-compose.yml` delete the comment block starting "# Accounts, billing, and MCP quotas are optional" and every commented variable after it up to and including `# MCP_QUOTA_PRO: "50000"`.

- [ ] **Step 3: Grep and commit**

Run: `grep -rniE "stripe|better-auth|AUTH_SECRET|FREE_BOARD_CAP|MCP_QUOTA" README.md docker-compose.yml apps/collab-server/README.md`
Expected: no output.

```bash
pnpm check:write
git add README.md docker-compose.yml apps/collab-server/README.md
git commit -m "📝 docs(server): document the extension port in place of accounts"
```

---

### Task 7: The editor's `account` props

**Files:**
- Modify: `apps/web/src/board/components/board-app.tsx`, `top-bar.tsx`, `board-menu.tsx`, `share-dialog.tsx:192-204`
- Modify: `apps/web/src/board/main.tsx`, `apps/web/src/board/session/board-session.ts:55-66, 138-145`, `apps/web/src/board/session/identity.ts`
- Modify: `apps/web/test/components/top-bar.test.tsx`, `board-menu.test.tsx`, `share-dialog.test.tsx:221-227`, `apps/web/test/session/identity.test.ts`, `apps/web/test/session/board-session-owner-connect.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AccountProps {
  homeHref: string
  menuItems?: ReactNode
  onConnectAgent?: () => void
}
BoardApp(props: { session: BoardSession; identity: Identity; account?: AccountProps })
TopBar(props: { session: BoardSession; account?: AccountProps })
BoardMenu(props: { currentId: string; items?: ReactNode })
BoardSessionOptions.keylessOwner?: boolean   // formerly signedIn
```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/components/top-bar.test.tsx`: delete the `Me` import and the `me` constant; replace every `me={null}` with nothing; rewrite the test "links the wordmark to the dashboard when signed in":

```ts
  it('links the wordmark where the account says, and home otherwise', async () => {
    const session = await openBoardSession({
      boardId: 'top7',
      fresh: true,
      identity,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const { rerender } = render(<TopBar session={session} />)
    expect(screen.getByRole('link', { name: 'tlwb' })).toHaveAttribute(
      'href',
      '/',
    )
    rerender(
      <TopBar session={session} account={{ homeHref: '/dashboard' }} />,
    )
    expect(screen.getByRole('link', { name: 'tlwb' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    await session.destroy()
  })
```

Check the accessible name of the logotype link in `logotype.tsx` before running; use whatever `getByRole('link', …)` the existing test at line 125 used.

`apps/web/test/components/board-menu.test.tsx`, whole file:

```tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BoardMenu } from '../../src/board/components/board-menu'
import { touchRecent } from '../../src/board/session/recents'

beforeEach(() => localStorage.clear())

describe('BoardMenu', () => {
  it('lists recents, the current board excluded, then home', () => {
    touchRecent({ id: 'b1', name: 'Current', updatedAt: 2 })
    touchRecent({ id: 'b2', name: 'Other', updatedAt: 1 })
    render(<BoardMenu currentId="b1" />)
    expect(screen.getByRole('link', { name: /Other/ })).toHaveAttribute(
      'href',
      '/b/b2',
    )
    expect(screen.queryByRole('link', { name: /Current/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('renders the extra items a deployment passes, before home', () => {
    const { container } = render(
      <BoardMenu
        currentId="b1"
        items={<button type="button">Add to my account</button>}
      />,
    )
    const labels = Array.from(container.querySelectorAll('a, button')).map(
      (node) => node.textContent,
    )
    expect(labels).toEqual(['New board', 'Add to my account', 'Home'])
  })
})
```

`apps/web/test/components/share-dialog.test.tsx`: replace the test "sends a signed-out visitor to sign in to connect an agent":

```ts
  it('shows the MCP endpoint when no agent connection is wired', () => {
    renderHosted()
    expect(screen.queryByRole('link', { name: 'Connect an agent' })).toBeNull()
    expect(screen.getByText(`${location.origin}/mcp`)).toBeInTheDocument()
  })
```

`apps/web/test/session/identity.test.ts`: delete the `Me` import, the `me` constant, and the whole `describe('identityFor', …)`.

`apps/web/test/session/board-session-owner-connect.test.ts`: replace every `signedIn: true` with `keylessOwner: true`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tlwb/web test -- test/components test/session/identity.test.ts test/session/board-session-owner-connect.test.ts`
Expected: FAIL to compile (`account`, `items`, `keylessOwner` unknown).

- [ ] **Step 3: Rename the session option**

In `apps/web/src/board/session/board-session.ts` rename `signedIn` to `keylessOwner` in `BoardSessionOptions` and in `openBoardSession` (`if (!options.keylessOwner) {`). New doc comment:

```ts
  /**
   * Try a keyless connection when there is no local key and no local
   * copy: a deployment that identifies visitors grants a board's owner
   * edit access with no key at all. Ignored whenever a key or a local
   * copy already answers the question. Off by default.
   */
  keylessOwner?: boolean
```

- [ ] **Step 4: Cut the session out of identity and the editor**

`apps/web/src/board/session/identity.ts`: delete the `Me` import and the `identityFor` function with its comment.

`apps/web/src/board/components/board-app.tsx`: delete the imports of `Me`, `createApiKey, fetchApiKeys`, `NewTokenDialog`; add `import type { ReactNode } from 'react'` (merge into the existing react import). Add before `BoardApp`:

```ts
/**
 * What a deployment with accounts adds to the editor. Absent, the
 * editor is the anonymous one: the wordmark goes home, the menu holds
 * recents only, and the share dialog hands the agent the MCP endpoint.
 */
export interface AccountProps {
  /** Where the wordmark links. */
  homeHref: string
  /** Extra entries rendered at the end of the board menu. */
  menuItems?: ReactNode
  /** Share dialog, "Connect an agent". */
  onConnectAgent?: () => void
}
```

Change the signature to `props: { session: BoardSession; identity: Identity; account?: AccountProps }` and `const { session, account } = props`. Delete the `agentDialogOpen` state. Render `<TopBar session={session} account={account} />`; pass `onConnectAgent={snapshot.role !== 'local' ? account?.onConnectAgent : undefined}` to `ShareDialog`; delete the `{me && snapshot.role !== 'local' ? (<NewTokenDialog …/>) : null}` block.

`apps/web/src/board/components/top-bar.tsx`: replace the `Me` import with `import type { AccountProps } from './board-app'`; signature `props: { session: BoardSession; account?: AccountProps }`; `const { session, account } = props`; `<Logotype size="editor" href={account?.homeHref ?? '/'} />`; `<BoardMenu currentId={snapshot.boardId} items={account?.menuItems} />`.

`apps/web/src/board/components/board-menu.tsx`: delete the imports of `useState`, `Me`, `readKeys`, `requestAdoption`; delete `AdoptEntry`; add `import type { ReactNode } from 'react'`. New component:

```tsx
export function BoardMenu(props: { currentId: string; items?: ReactNode }) {
  const recents = listRecents().filter((item) => item.id !== props.currentId)
  return (
    <nav className="board-menu" aria-label="Boards">
      <a href="/b/new">New board</a>
      {recents.length > 0 ? (
        <ul>
          {recents.slice(0, 10).map((item) => (
            <li key={item.id}>
              <a href={`/b/${item.id}`}>
                {item.name || 'Untitled'}{' '}
                <small>{relative(item.updatedAt)}</small>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {props.items}
      <a href="/">Home</a>
    </nav>
  )
}
```

`apps/web/src/board/components/share-dialog.tsx`: replace the `<a className="button-secondary" href="/login">Connect an agent</a>` branch with:

```tsx
            <p className="caption share-agent-endpoint">
              Point your agent at <code>{`${location.origin}/mcp`}</code> and
              hand it this board's edit link.
            </p>
```

Add to `share-dialog.css`:

```css
.share-agent-endpoint code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}
```

(Read `src/styles/tokens.css` first; if a monospace token exists under another name, use it.)

`apps/web/src/board/main.tsx`: delete the `fetchSession, SessionRateLimitedError` import, the `mePromise` line and its comment, the `me` / `signedIn` block with its comment, and the `identityFor` import; `const identity = loadIdentity()`; `openBoardSession({ boardId, fresh, identity })`; render `<BoardApp session={session} identity={identity} />`.

- [ ] **Step 5: Run the web unit suite**

Run: `pnpm --filter @tlwb/web typecheck && pnpm --filter @tlwb/web test`
Expected: PASS. The `test/auth`, `test/dashboard`, and `test/login` suites still pass because their sources are untouched until Task 8.

- [ ] **Step 6: Commit**

```bash
pnpm check:write
git add apps/web
git commit -m "♻️ refactor(web): let a deployment extend the editor through account props"
```

---

### Task 8: Remove login, dashboard, legal pages, and the session from the web application

**Files:**
- Delete: `apps/web/login.html`, `dashboard.html`, `privacy.html`, `terms.html`, `apps/web/src/auth/`, `src/dashboard/`, `src/login/`, `src/legal/`, `apps/web/test/auth/`, `test/dashboard/`, `test/login/`, `apps/web/e2e/accounts.spec.ts`, `apps/web/e2e/session-helper.ts`
- Modify: `apps/web/vite.config.ts:14-21, 56-63`, `apps/web/Caddyfile:42-53`, `apps/web/index.html:30-34, 107-181, 199-201`, `apps/web/src/landing/landing.css`, `apps/web/src/landing/recents.ts`, `apps/web/src/board/session/server.ts:66-91`, `apps/web/package.json`, `apps/web/playwright.config.ts:38-46`, `apps/web/e2e/visual.spec.ts`
- Modify: `apps/web/test/landing/recents.test.ts`, `apps/web/test/landing/index-html.test.ts`, `apps/web/test/session/server.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/web/test/landing/index-html.test.ts`, replace the test:

```ts
  it('exposes the resume hook and links nowhere the anonymous application does not serve', () => {
    const doc = new DOMParser().parseFromString(markup, 'text/html')
    expect(doc.getElementById('resume')).not.toBeNull()
    expect(doc.getElementById('session-link')).toBeNull()
    const hrefs = Array.from(doc.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    )
    for (const forbidden of ['/login', '/dashboard', '/privacy', '/terms', '#pricing']) {
      expect(hrefs).not.toContain(forbidden)
    }
    expect(doc.getElementById('pricing')).toBeNull()
  })
```

`apps/web/test/landing/recents.test.ts`: delete the `Me` import, the `me` constant, the `renderSession` import, and the whole `describe('renderSession', …)`.

`apps/web/test/session/server.test.ts`: delete `requestAdoption` from the import and the two tests that call it ("posts the boards list and returns the adoption result" and the one asserting the 401 case).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tlwb/web test -- test/landing`
Expected: FAIL, `session-link` and `pricing` still present.

- [ ] **Step 3: Delete the pages and modules**

Delete everything under **Files: Delete**.

`apps/web/src/landing/recents.ts`: delete the `fetchSession, type Me` import, the `renderSession` function with its comment, and the `sessionTarget` block at the bottom. The file keeps `renderResume` and the `resume` wiring.

`apps/web/src/board/session/server.ts`: delete `requestAdoption` with its comment.

`apps/web/index.html`: delete `<a href="#pricing">Pricing</a>` and `<a id="session-link" href="/login">Sign in</a>` from the nav; delete the whole `<section class="pricing" id="pricing">…</section>` element; in the footer delete the two `footer-dot` spans and the `Privacy` and `Terms` links that follow "Made by JDevelop".

`apps/web/src/landing/landing.css`: delete every rule whose selector starts with `.pricing`, `.plan-`, or `.plan` (run `grep -n "pricing\|plan" src/landing/landing.css` to list them; the block at line 249 onward holds most of them; also drop `.pricing,` from the selector list at line 8).

`apps/web/vite.config.ts`: in `pages` keep only nothing (delete the five entries, leave `const pages: Record<string, string> = {}`), or delete `pages` and the `else` branch entirely and keep the `/b/` rewrite; in `rollupOptions.input` keep `landing` and `board` only.

`apps/web/Caddyfile`: in `@html` change the path list to `/ /*.html /b/*`; delete the `@dashboard` matcher and its `handle` block.

`apps/web/package.json`: run `pnpm --filter @tlwb/web remove better-auth postgres`.

`apps/web/playwright.config.ts`: delete the `AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `FREE_BOARD_CAP` lines and the comment block above them ("Accounts, seeded and OAuth-free…"). Keep `CREATE_LIMIT_PER_MIN`. Delete the `databaseUrl` constant only if nothing else in the file uses it (the server `webServer` env still does: keep it).

`apps/web/e2e/visual.spec.ts`: delete the `session-helper` import; delete from `const seeded = await seedSession()` through `await addSessionCookie(context, seeded.token)`; change the test signature to `async ({ page })`; delete everything after the `board-share.png` screenshot down to the end of the test body (the new-token, dashboard, and agents captures), keeping the closing `})`. Update the comment above `page.goto('/')` to drop "the session cookie is added only after this capture".

- [ ] **Step 4: Run the web suites**

Run: `pnpm --filter @tlwb/web typecheck && pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web build`
Expected: PASS, and the build emits `index.html` and `board.html` only.

Run: `pnpm --filter @tlwb/web e2e`
Expected: PASS on `board.spec.ts` and `visual.spec.ts` (with Postgres up and Chromium installed).

Run: `grep -rniE "login|dashboard|better-auth|fetchSession|/privacy|/terms" apps/web/src apps/web/index.html apps/web/board.html apps/web/Caddyfile apps/web/vite.config.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
pnpm check:write
git add apps/web pnpm-lock.yaml
git commit -m "🔥 refactor(web): remove sign-in, the dashboard, and the legal pages"
```

---

### Task 9: The web library entry point

**Files:**
- Create: `apps/web/src/index.ts`
- Modify: `apps/web/package.json`
- Create: `apps/web/test/index.test.ts`

**Interfaces:**
- Produces: `@tlwb/web` importable by the private repository's board page and landing.

- [ ] **Step 1: Write the failing test**

`apps/web/test/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as api from '../src/index'

describe('library surface', () => {
  it('exports what a deployment composes the editor with', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'BoardApp',
        'Logotype',
        'NotFound',
        'clearKeys',
        'keysFromFragment',
        'listRecents',
        'loadIdentity',
        'openBoardSession',
        'readAlias',
        'readKeys',
        'removeRecent',
        'renderResume',
        'saveIdentity',
        'touchRecent',
        'writeKeys',
      ].sort(),
    )
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @tlwb/web test -- test/index.test.ts`
Expected: FAIL, `../src/index` does not exist.

- [ ] **Step 3: Write the entry point and the exports map**

`apps/web/src/index.ts`:

```ts
export { type AccountProps, BoardApp } from './board/components/board-app'
export { Logotype } from './board/components/logotype'
export { NotFound } from './board/components/not-found'
export {
  type BoardSession,
  type BoardSessionOptions,
  openBoardSession,
} from './board/session/board-session'
export {
  type Identity,
  loadIdentity,
  saveIdentity,
} from './board/session/identity'
export {
  clearKeys,
  keysFromFragment,
  readAlias,
  readKeys,
  type StoredKeys,
  writeKeys,
} from './board/session/keys'
export {
  listRecents,
  type RecentBoard,
  removeRecent,
  touchRecent,
} from './board/session/recents'
export { renderResume } from './landing/recents'
```

`renderResume` lives in a module with side effects at the bottom (the `resume` wiring runs on import). Move those side effects out: create `apps/web/src/landing/main.ts` holding the `const target = document.getElementById('resume') …` block importing `renderResume` from `./recents`, and point `index.html`'s script tag at `/src/landing/main.ts`. `recents.ts` keeps the pure function only.

`apps/web/package.json`, after `"type": "module",`:

```json
  "exports": {
    ".": "./src/index.ts",
    "./styles/tokens.css": "./src/styles/tokens.css",
    "./styles/ui.css": "./src/styles/ui.css",
    "./board.css": "./src/board/board.css"
  },
```

- [ ] **Step 4: Run the web suite and the full repository checks**

Run: `pnpm --filter @tlwb/web typecheck && pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web build`
Expected: PASS.

Run from the root: `pnpm check && pnpm typecheck && pnpm test`
Expected: PASS.

Run: `grep -rniE "stripe|better-auth" --exclude-dir=node_modules --exclude-dir=.claude --exclude=pnpm-lock.yaml . ; grep -rniw "plan" --exclude-dir=node_modules --exclude-dir=.claude --exclude=pnpm-lock.yaml --exclude-dir=dist --exclude-dir=playwright-report --exclude-dir=test-results .`
Expected: no output from either.

- [ ] **Step 5: Commit**

```bash
pnpm check:write
git add apps/web
git commit -m "✨ feat(web): expose the editor and its session as a package"
```
