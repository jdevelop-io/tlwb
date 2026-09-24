# tlwb open source and SaaS split: design

Date: 2026-09-24
Status: approved
Parent specification: `2026-08-07-tlwb-product-design.md` (section 3,
"Freemium and retention")
Supersedes: `2026-08-28-tlwb-accounts-freemium-design.md` as far as
_where_ accounts, billing, and quotas live. The behaviour that
specification describes is unchanged; it moves out of this repository.
Sibling specifications: `2026-08-26-tlwb-collab-server-design.md` and
`2026-08-26-tlwb-web-app-design.md` (the two applications this
specification turns into libraries)

## 1. Scope and goal

This specification draws the line between tlwb, the open-source product
in this repository, and tlwb.io, the hosted service run from the private
repository `tlwb-internal`.

Today the public repository contains the whole hosted service: sign-in,
board ownership, the free-plan cap, the Pro subscription through Stripe,
the MCP API keys and their monthly quota, and the dashboard. None of
that is the product. A self-hoster gets no value from a ten-board cap or
an upgrade button, and an MIT repository should not carry a Stripe
integration.

After this work, the public repository is the Excalidraw model: an
anonymous, local-first whiteboard with sharing, real-time collaboration,
and an MCP endpoint, self-hostable from two images with nothing to sign
in to. The private repository composes those same packages, unchanged,
into the hosted service: accounts, ownership, adoption, API keys,
quotas, billing, dashboard. Nothing in the public repository knows the
words "plan", "Stripe", "quota", or "user".

Implementation is planned as two plans, one per repository, executed in
the order section 9 gives.

## 2. Decisions and rationale

- **The public product is anonymous only.** Accounts are not a feature
  of the whiteboard; they are the retention layer of the hosted
  service. Keeping them public would force every commercial decision
  (caps, quotas, plans) into the open-source code, which is exactly the
  leak this work removes. Sharing, collaboration, and MCP all work
  without an account today and keep working.
- **The public packages are libraries the private repository composes,
  never forks.** `tlwb-internal` consumes `@tlwb/collab-server` and
  `@tlwb/web` as workspace packages through a git submodule pinned on a
  commit. No published npm release: nothing asks for one yet, and a
  submodule gives full typing with zero release process. Publishing to
  npm is the upgrade when a third party wants to embed the editor.
- **One small extension port on the server, not a plugin system.** The
  server keeps an opaque, nullable `boards.owner_id` and asks an
  optional extension who a request is. That keeps the role logic
  (owner edits without a key, everyone else presents one) in one place
  for HTTP and WebSocket. The alternative, removing `owner_id` and
  letting the extension authorise every request, duplicates the key
  logic on both sides for a purity nobody sees.
- **Extension by props in the editor, not by plugin.** `BoardApp` takes
  one optional `account` object with three fields. Absent, the editor
  is exactly the anonymous editor. The hosted web application renders
  its own dialogs beside `BoardApp`; it needs no slot for them.
- **The local multi-board experience stays.** Recents in IndexedDB cost
  the server nothing and are already built. Reducing the public product
  to a single board would be work spent making it worse.
- **The MCP per-IP rate limit stays public; the per-account monthly
  quota goes private.** The first protects any instance from abuse. The
  second meters a commercial plan.
- **tlwb.io's existing account data is not migrated.** There is nothing
  worth preserving. The public migration drops the account tables; the
  private repository starts its own schema from zero. Sign-in is OAuth
  only, so nobody loses a password, and the browser re-adopts its
  boards on the next visit to the dashboard.

## 3. What lives where

Public, `jdevelop-io/tlwb`:

| Package                | Keeps                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine`      | Unchanged                                                                                                                              |
| `packages/store-yjs`   | Unchanged                                                                                                                              |
| `apps/collab-server`   | Boards, updates, assets, WebSocket rooms, anonymous MCP with its per-IP limiter, `shared_at` / `agent_at`, the extension port          |
| `apps/web`             | Landing with recents, the board editor, legal-free static pages, the `account` props on `BoardApp`, a library entry point              |

Private, `jdevelop-io/tlwb-internal`:

| Package              | Holds                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `tlwb/`              | The public repository as a git submodule                                                                                                 |
| `apps/server`        | Better Auth, OAuth, ownership routes, adoption, API keys, monthly quota, free cap, Stripe, thumbnails, its own schema and migrations      |
| `apps/web`           | tlwb.io landing, login, dashboard, privacy and terms, and the board page composing `BoardApp` with the account props                    |
| `compose.yaml` etc.  | The existing operations files, now pointing at the private images                                                                        |

Leaving `apps/collab-server`: `accounts/`, `billing/`, `thumbnail.ts`,
the `user`, `session`, `account`, `verification`, `api_keys`, and
`mcp_usage` tables, the `boards.thumbnail` and `boards.thumbnail_seq`
columns, the routes `/auth/*`, `/billing/*`, `/me/*`, `/boards/adopt`,
and `DELETE /boards/:boardId`, the dependencies `better-auth`,
`stripe`, `@napi-rs/canvas`, `@fontsource/caveat`, `@fontsource/inter`,
and the variables `AUTH_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
`STRIPE_PRICE_YEARLY`, `FREE_BOARD_CAP`, `MCP_QUOTA_FREE`,
`MCP_QUOTA_PRO`, `AUTH_LIMIT_PER_MIN`, `MCP_RENDER_LIMIT_PER_MIN`.

Leaving `apps/web`: `login.html`, `dashboard.html`, `privacy.html`,
`terms.html`, `src/auth/`, `src/dashboard/`, `src/login/`, `src/legal/`,
the `better-auth` dependency, the `/login` and `/dashboard*` routes in
`vite.config.ts` and the Caddyfile, the "Sign in" link of the landing
and the session check in `landing/recents.ts`, the `me` thread through
`board/main.tsx`, `BoardApp`, `TopBar`, `BoardMenu`, and `identityFor`,
the `requestAdoption` client in `board/session/server.ts`, the unit
tests under `test/auth/`, `test/dashboard/`, and `test/session/` that
cover those, `e2e/accounts.spec.ts`, `e2e/session-helper.ts`, the
dashboard captures in `e2e/visual.spec.ts`, and the `postgres`
development dependency those helpers needed.

Everything that leaves is moved, not rewritten: the private repository
receives the files with their tests, adapted to the new imports.

## 4. The server extension port

`@tlwb/collab-server` exports `startServer(config, extension?)`:

```ts
export interface Extension {
  /** Who this request is, from its headers. Absent, or null: anonymous. */
  identify?(headers: Headers): Promise<{ id: string } | null>
  /** May this principal create one more board? Absent: always. */
  canCreateBoard?(principalId: string): Promise<boolean>
  /** Bearer keys presented to /mcp. Absent: anonymous callers only. */
  mcpKeys?: {
    resolve(
      bearer: string,
    ): Promise<{ userId: string; boardIds: string[] | null } | 'invalid'>
    /** One tool call is about to run. False refuses it. */
    spend(userId: string): Promise<boolean>
  }
  /** Runs once, right after the public migrations, before listening. */
  migrate?(db: Db): Promise<void>
  /** Extra routes, mounted before the public ones. */
  mount?(app: Hono<Env>, ctx: ExtensionContext): void
}

export interface ExtensionContext {
  db: Db
  config: Config
  rooms: RoomRegistry
  clientIp(c: Context<Env>): string
  createIpLimiter(perMinute: number): IpLimiter
}
```

How the public server uses it:

- `identify` replaces `sessionUser(auth, headers)` everywhere it is
  called today: `POST /boards`, `requestRole` for the asset routes, and
  the WebSocket upgrade. `roleFor(board, token, principalId)` is
  unchanged, and so is the `foreignKey` flag the room reports.
- `POST /boards` and the MCP `create_board` tool call `canCreateBoard`
  when a principal is present and answer `403 board limit reached` (or
  the equivalent tool error) when it refuses. Both pass the principal id
  to `issueBoard`, which writes `owner_id` as today.
- The MCP endpoint keeps its `Caller` union. A bearer that starts with
  the API key prefix goes through `mcpKeys.resolve`; `assertCaller`
  calls `mcpKeys.spend` for a keyed caller. `plan` disappears from the
  union: the quota is the extension's business. With no `mcpKeys`, a
  bearer is ignored and the caller is anonymous.
- `migrate` runs inside `startServer` after `connectDatabase` applied
  the public migrations, so the private tables can reference `boards`.
- `mount` runs before the public routes are registered, with `app` the
  root Hono application, so the private repository mounts `/auth`,
  `/billing`, `/me`, `/boards/adopt`, and `DELETE /boards/:boardId` at
  the same paths the web application already calls.

The public `Config` loses every variable listed in section 3.
`PUBLIC_URL` stays (MCP share links build on it) and so does
`CORS_ORIGIN`; the rule "`PUBLIC_URL` is required when `CORS_ORIGIN` is
`*` and accounts or billing are configured" moves to the private
configuration, which is where accounts and billing are configured.

## 5. The server package API and migrations

`apps/collab-server/package.json` gains `"exports": { ".": "./src/index.ts" }`
(the same shape as `@tlwb/engine`, source served through `tsx`, no
build). `src/index.ts` is the whole public surface:

- `startServer`, `RunningServer`, `Extension`, `ExtensionContext`
- `loadConfig`, `ConfigError`, `Config`
- `Db`, and the `boards` table from the schema
- `findBoard`, `claimBoard`, `disownBoards`, `listOwnedBoards`,
  `countOwnedBoards`, `deleteBoardRows`, `BoardRecord`, `OwnedBoard`
- `readBoardStore`
- `resolveRole`, `Role`
- `clientIp`, `createIpLimiter`, `IpLimiter`
- `log`

Everything not exported is private to the package. The private
repository never reaches into `@tlwb/collab-server/src/...`.

The public migration `0005` does, in this order: `UPDATE boards SET
owner_id = NULL`; drop the foreign key from `boards.owner_id` to
`user.id`; drop `boards.thumbnail` and `boards.thumbnail_seq`; drop
`mcp_usage`, `api_keys`, `verification`, `session`, `account`, `user`.
`owner_id` stays as a plain nullable `text` column with its index: it is
the principal id the extension supplies, and the public server never
writes it on an anonymous instance.

## 6. The web library and the editor props

`apps/web/package.json` gains `"exports"` for `./src/index.ts` and for
the stylesheets (`./styles/tokens.css`, `./styles/ui.css`,
`./board.css`). The application keeps building and serving itself
exactly as today; the entry point only adds a second way in. Vite
resolves the TypeScript source through the workspace link, and the
React plugin transforms it because the linked path resolves outside
`node_modules`.

`src/index.ts` exports: `BoardApp` and its `AccountProps` type,
`openBoardSession` and `BoardSession`, `NotFound`, `Logotype`,
`loadIdentity` and `Identity`, the key helpers of `board/session/keys.ts`
(`readKeys`, `writeKeys`, `readAlias`, `keysFromFragment`), the recents
store of `board/session/recents.ts`, and the landing's `recents.ts`
renderer.

The editor's single extension point:

```ts
export interface AccountProps {
  /** Where the logotype links. The anonymous editor links to "/". */
  homeHref: string
  /** Extra entries rendered at the end of the board menu. */
  menuItems?: ReactNode
  /** Share dialog, "Connect an agent". Absent: the dialog shows the MCP
   * endpoint to hand an agent, and no button. */
  onConnectAgent?: () => void
}

<BoardApp session={session} identity={identity} account={account} />
```

What changes inside the editor:

- `board/main.tsx` no longer fetches a session. It opens the board
  session with `keylessOwner: false` (the option formerly named
  `signedIn`, kept because the hosted board page passes `true` when a
  session cookie exists, so the owner connects without a key).
- `TopBar` links the logotype to `account?.homeHref ?? '/'`.
- `BoardMenu` loses `AdoptEntry` and `me`; it renders
  `account?.menuItems` after the recents. The hosted application builds
  its "Add to my account" entry from `session.keys()` and its own
  adoption client.
- `ShareDialog` loses the `/login` link. With `onConnectAgent` it shows
  the button; without it, the agent section shows the MCP endpoint
  (`${location.origin}/mcp`) and a one-line hint, since anonymous MCP
  works on any instance.
- `BoardApp` loses `NewTokenDialog` and the `dashboard/api` imports. The
  hosted board page renders its token dialog as a sibling of
  `BoardApp`, fed by the same `session`.
- `identityFor` goes; the hosted board page overrides the identity name
  itself before calling `openBoardSession`.

## 7. The private repository

```text
tlwb-internal/
  tlwb/                     git submodule (jdevelop-io/tlwb), pinned
  pnpm-workspace.yaml       tlwb/packages/*, tlwb/apps/*, apps/*
  package.json              scripts: check, typecheck, test; biome
  biome.json                extends ./tlwb/biome.json
  tsconfig.base.json        extends ./tlwb/tsconfig.base.json
  apps/
    server/                 @tlwb-io/server
      src/main.ts           loads config, builds the extension, startServer
      src/config.ts         AUTH_*, GITHUB_*, GOOGLE_*, STRIPE_*, caps, quotas
      src/accounts/         auth.ts, api-keys.ts, cleanup.ts, quota.ts (moved)
      src/billing/          routes.ts (moved)
      src/routes.ts         /me/*, /boards/adopt, DELETE /boards/:id (moved)
      src/thumbnail.ts      (moved)
      src/db/schema.ts      user, session, account, verification,
                            api_keys, mcp_usage, board_thumbnails
      src/migrations/       drizzle, journal table "drizzle_internal"
      Dockerfile
    web/                    @tlwb-io/web
      index.html            tlwb.io landing (copied, then free to diverge)
      login.html, dashboard.html, privacy.html, terms.html, board.html
      src/auth/, src/dashboard/, src/login/, src/legal/   (moved)
      src/board/main.tsx    fetchSession, identity, BoardApp + account
      Dockerfile, Caddyfile
  compose.yaml, tlwb.caddy, deploy.sh, .env.example
  .github/workflows/ci.yml
  README.md
```

The server composition, in full:

```ts
const config = loadInternalConfig(process.env) // wraps loadConfig
const stripe = config.billing ? new Stripe(config.billing.secretKey) : null
let auth: Auth | null = null
await startServer(config, {
  migrate: (db) => migrate(db, { migrationsFolder, migrationsTable: 'drizzle_internal' }),
  identify: (headers) => sessionUser(auth, headers).then((u) => u && { id: u.id }),
  canCreateBoard: (id) => underCap(db, config, id),
  mcpKeys: { resolve: (bearer) => resolveApiKey(db, bearer), spend: (id) => spendQuota(db, id, ...) },
  mount: (app, ctx) => {
    auth = createAuth({ db: ctx.db, config, beforeDelete: accountCleanup(ctx.db, stripe) })
    app.on(['GET', 'POST'], '/auth/*', ...)   // with its own limiter from ctx.createIpLimiter
    if (config.billing) app.route('/billing', createBillingApp(...))
    app.route('/', createAccountRoutes({ ...ctx, auth }))  // /me/*, /boards/adopt, DELETE /boards/:id
  },
})
```

`auth` is built inside `mount` because it needs `db`; `identify` reads
it lazily, and no request reaches `identify` before `mount` ran.

The private data model is the one `2026-08-28-tlwb-accounts-freemium-design.md`
describes, with two changes: the `plan` and `stripe_customer_id`
columns stay on `user` (the table is private now, so there is nothing
to separate), and thumbnails move from `boards` to a
`board_thumbnails(board_id, png, seq)` table. Every private table that
references a board declares `references(() => boards.id, { onDelete:
'cascade' })` against the `boards` table exported by the public
package, so `deleteBoardRows` keeps working and the account routes need
no extra cleanup.

`underCap` is today's `countOwnedBoards(db, id) >= config.freeBoardCap`
check for a free-plan user, unchanged, now behind the port.

## 8. Continuous integration, images, deployment

The private workflow mirrors the public one without the Node matrix:
`actions/checkout` with `submodules: true` (the submodule is public, no
token), `pnpm install --frozen-lockfile` against the single private
lockfile, check, typecheck, server tests against a Postgres service,
web unit tests, the account journeys with Playwright, then on a green
`main` the publication of `ghcr.io/jdevelop-io/tlwb-io-server` and
`ghcr.io/jdevelop-io/tlwb-io-web` as private packages, tagged `latest`
and `sha-<short>`.

The two Dockerfiles copy the whole private repository, submodule
included, and follow the public ones: the server image runs
`@tlwb-io/server` through `tsx`; the web image builds `@tlwb-io/web`
with Vite and serves it with Caddy. The private Caddyfile is the public
one plus the `/login` and `/dashboard*` routes it has today.

`compose.yaml` points at the two private images. `deploy.sh` is
unchanged. Provisioning gains one step: `docker login ghcr.io` on the
host, once, with a token limited to `read:packages`.

The public repository keeps publishing its own two images for
self-hosters; its workflow is unchanged.

## 9. Data migration and rollout order

1. On the VPS, pin the currently running tag in `.env` (`TLWB_TAG=sha-…`)
   so that a `./deploy.sh` without argument cannot pull the anonymous
   public images by accident once the public branch merges.
2. Public branch: the extension port, the removals of section 3, the
   `0005` migration, the library entry points, the documentation. Green
   on its own, mergeable on its own: it is a complete anonymous product.
3. Private repository: submodule on that branch's head, the two
   applications, the workflow, the README. Green on its own.
4. `pg_dump app_tlwb` on the host. Merge the public branch. Point the
   submodule at the merged commit. Let the private workflow publish.
   `./deploy.sh`. The public `0005` migration runs first inside
   `connectDatabase`, then the private baseline through `migrate`.
   Visitors sign in again with GitHub or Google; the dashboard re-adopts
   the boards their browser still holds keys for.

Public documentation updated in step 2: the root `README.md`
self-hosting section, `apps/collab-server/README.md` (variables table,
the accounts, billing, and MCP key sections replaced by the extension
port), `docker-compose.yml` comments. The private `README.md`, rewritten
in step 3, covers cloning with `--recurse-submodules`, local
development, moving the submodule forward, and deployment.

## 10. Testing

Public repository:

- Server tests that exercised accounts, billing, and quotas move with
  the code. The HTTP and WebSocket tests that used a stubbed `auth`
  now pass a stubbed `identify`, which is smaller.
- New tests: `startServer` with no extension serves an anonymous
  instance; `identify` returning an id makes `POST /boards` write
  `owner_id` and grants the keyless owner edit over WebSocket;
  `canCreateBoard` returning false yields `403` on `POST /boards` and
  the tool error on `create_board`; `mcpKeys.resolve` and `spend` gate
  a keyed caller; `mount` routes are reachable; `migrate` runs after the
  public migrations.
- Web: the unit tests of the editor drop `me`; one test each for the
  three `account` props. `e2e/board.spec.ts` and the anonymous captures
  of `visual.spec.ts` stay.

Private repository:

- The moved server and web tests, adapted to the new imports, plus one
  test that the composed extension resolves a session cookie into a
  principal end to end.
- `e2e/accounts.spec.ts` and the dashboard captures, run against the
  private web build proxied to the private server.

## 11. Success criteria

- `grep -ri stripe` and `grep -riw plan` over the public repository
  (outside `.claude/`) return nothing.
- A self-hoster running the public `docker-compose.yml` draws, shares,
  collaborates, and drives an agent through `/mcp` with no account and
  no account-related variable to set.
- tlwb.io behaves as before this work for a signed-in visitor: sign-in,
  dashboard, adoption, API keys, quota, cap, Pro checkout and portal,
  account deletion.
- Moving the submodule forward and deploying is two commands and one
  commit.

## 12. Out of scope

- Publishing `@tlwb/*` to npm.
- Any change to what the hosted service offers (plans, prices, quotas).
- A single-board or otherwise reduced public product.
- Preserving tlwb.io's existing accounts across the migration.
