# tlwb accounts and freemium: design

Date: 2026-08-28
Status: approved
Parent specification: `2026-08-07-tlwb-product-design.md` (sections 3,
"Freemium and retention", and 5.3, "Dashboard")
Sibling specifications: `2026-08-26-tlwb-collab-server-design.md` (the
server the accounts module joins), `2026-08-26-tlwb-web-app-design.md`
(the client the dashboard joins), and
`2026-08-27-tlwb-mcp-server-design.md` (the MCP surface the API key and
quota extend)

## 1. Scope and goal

This specification covers accounts and the freemium layer of tlwb:
sign-in with GitHub or Google, ownership of boards, adoption of the
browser's anonymous boards into the account, the free-plan cap, the
Pro subscription through Stripe, the MCP API key with its monthly
quota, and the dashboard that surfaces all of it.

After this work, a visitor still draws without an account exactly as
today. Signing in adds a durable home for their boards: the boards
created in this browser attach to the account automatically, a
dashboard lists them with thumbnails, the free plan caps the account at
ten boards, and upgrading to Pro through Stripe lifts the cap. An agent
can present an account's API key to the MCP endpoint and draw against
the account's monthly quota instead of the anonymous IP limit.

Everything lands in the existing deployments: an `accounts` module and
a `billing` module inside `apps/collab-server`, and two new entries
(`/login`, `/dashboard`) inside `apps/web`. No new service, no new
database.

## 2. Decisions and rationale

- **OAuth only, GitHub and Google.** The audience is developers; both
  providers cover it with zero password handling and zero outbound
  email. Accounts are identified by the provider-verified email, and
  the same email through either provider lands on the same account.
- **Better Auth over hand-rolled OAuth.** Better Auth mounts on the
  existing Hono application, ships a Drizzle adapter for the existing
  Postgres, and owns the OAuth state, PKCE, session cookies, CSRF, and
  account linking. That is security code not written and not
  maintained here. The alternative (Arctic plus a homemade session
  table) buys control this project does not need.
- **Ownership grants the edit role through the session.** Share keys
  are stored hashed and cannot be shown again, so the dashboard cannot
  rebuild fragment links. Instead, `boards.owner_id` (nullable) names
  the owner, and role resolution accepts either a share key or a
  session whose user owns the board. Owners open `/b/<id>` bare; share
  links keep working unchanged for everyone else.
- **Adoption is automatic and provable.** A board created in this
  browser is recognizable: localStorage holds BOTH its keys (the
  `POST /boards` response), where a visitor of a shared link holds only
  one (the fragment's). Purely local boards (IndexedDB, never hosted)
  are the other adoptable kind. Adoption sends the edit key as proof of
  possession; no selection screen, and boards merely visited are never
  claimed.
- **The cap gates creation only.** At ten boards, a free account is
  refused further creation and adoption with an explicit message;
  nothing existing is ever frozen or degraded, so no shared board ever
  breaks under a collaborator. This is the common freemium model and
  needs no freeze machinery.
- **MCP API key, optional.** Without a key, MCP behaves exactly as
  today (share link plus IP limit). With `Authorization: Bearer
  tlwb_<key>`, calls attribute to the account and count against its
  monthly quota. The key authenticates and meters; it never authorizes:
  board access still comes from the share link or ownership, so a
  stolen key opens no board by itself.
- **Stripe Checkout and Billing Portal, webhook as truth.** One
  product, monthly and yearly prices, hosted Checkout and Portal, and a
  signed webhook as the only writer of `user.plan`. No payment UI is
  built here, and the Checkout return page grants nothing.
- **Everything degrades to self-hosting.** Without OAuth secrets the
  accounts routes are disabled and the product runs anonymous-only, as
  today. Without Stripe configuration billing is disabled and the
  Upgrade button hidden. The open-source server never requires a SaaS
  dependency to run.

## 3. Data model

Better Auth generates its standard tables through its CLI, delivered as
a Drizzle migration like the existing ones: `user`, `session`,
`account` (OAuth links), `verification`. Two columns extend `user`:

- `plan`: text, `'free' | 'pro'`, default `'free'`.
- `stripe_customer_id`: text, nullable.

Two tables are ours:

- `api_keys`: `user_id` (references `user`), `key_hash` (bytea, SHA-256,
  same hash-only model as board keys), `created_at`, `revoked_at`
  (nullable). One active key per account in v1; regenerating revokes
  the old row and inserts a new one.
- `mcp_usage`: `user_id`, `month` (text, `YYYY-MM`), `count` (bigint),
  primary key (`user_id`, `month`). Incremented per MCP tool call.

`boards` gains:

- `owner_id`: text, nullable, references `user`. Null means anonymous;
  every existing row is untouched.
- `thumbnail`: bytea, nullable, and `thumbnail_seq`: bigint, the
  `snapshot_seq` the thumbnail was rendered at.

Configuration (environment variables): `AUTH_SECRET`, `AUTH_URL`,
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`,
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`,
`FREE_BOARD_CAP` (default 10), `MCP_QUOTA_FREE` (default 1000),
`MCP_QUOTA_PRO` (default 50000). Missing OAuth variables disable the
accounts module; missing Stripe variables disable the billing module.

## 4. Ownership, adoption, and the cap

**Role resolution.** Today `resolveRole(token, hashes)` maps a fragment
key to `'edit' | 'view' | null`. It gains a sibling: a request (HTTP,
WebSocket upgrade, or MCP) carrying a valid session cookie whose user
is the board's `owner_id` resolves to `'edit'` with no key. Owner wins
over key; everything else is unchanged.

**Adoption.** On every login (idempotent, replayed each time), the
client collects the adoptable boards:

- hosted boards whose localStorage entry holds both `editKey` and
  `viewKey`;
- purely local boards (IndexedDB documents never hosted), which are
  first hosted through the existing flow (`POST /boards`, push the
  content) and then adopted.

It calls `POST /api/boards/adopt` with `[{ boardId, editKey }]`. For
each entry the server adopts when the key hash matches and the board is
unowned, via `UPDATE boards SET owner_id = $user WHERE id = $id AND
owner_id IS NULL` so concurrent adoptions race safely. Already-owned,
unknown, or wrong-key entries are skipped silently. Adoption stops at
the cap, most recently updated first; the surplus stays anonymous in
the browser and remains adoptable later.

**The cap.** `countBoards(ownerId)` runs before every creation and
adoption. A free account at `FREE_BOARD_CAP` receives an explicit
refusal ("board limit reached: upgrade or delete a board"). Pro is
unlimited. Existing boards are never degraded.

**Deletion.** The owner deletes a board from the dashboard:
definitive, the room is closed, the rows (board, updates, assets) are
purged, and the cap slot frees.

**Account deletion.** Boards are re-anonymized (`owner_id` null, share
links survive), the Stripe subscription is cancelled, the API key is
revoked, then the Better Auth user is deleted.

## 5. MCP API key and quota

The MCP endpoint reads an optional `Authorization: Bearer tlwb_<key>`
header. The key is `tlwb_` plus 32 random bytes base64url, shown once
at generation in the dashboard, stored as a SHA-256 hash.

- No header: today's behavior, share-link access under the existing IP
  limiter.
- Valid key: the call attributes to the key's user. Each tool call
  increments `mcp_usage` for the current month and is refused once the
  month's count reaches the plan's quota, as a tool result with
  `isError: true` and the text `monthly quota reached, resets on the
  1st` (the established error convention). The IP limiter no longer
  applies to keyed calls.
- Unknown or revoked key: a tool result with `isError: true` and
  `invalid API key`, not a fallback to anonymous.

Quotas are fair-use anti-abuse values, configurable:
`MCP_QUOTA_FREE` 1000 calls/month, `MCP_QUOTA_PRO` 50000. The
dashboard shows the current month's consumption.

## 6. Billing

One Stripe product, two prices (monthly, yearly), ids in environment
variables.

- `POST /api/billing/checkout` (signed-in): creates a Stripe Checkout
  session in subscription mode, creating the Stripe customer on first
  use and storing `stripe_customer_id`. Redirects to Stripe; returns
  to the dashboard, which shows "payment confirming" until the webhook
  lands.
- `POST /api/billing/webhook`: signature verified with
  `STRIPE_WEBHOOK_SECRET`, handles `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`.
  Each handler writes the absolute plan state derived from the event
  (`pro` while the subscription is active or in grace, `free`
  otherwise), so replayed events are idempotent. The webhook is the
  only writer of `user.plan`.
- `POST /api/billing/portal` (signed-in): opens the Stripe Billing
  Portal for card changes, cancellation, and invoices.

A lapsed or cancelled subscription returns the account to `free` at
period end. Boards above the cap remain intact and editable; only new
creation is refused (section 4).

## 7. Web interface

**`/login`.** A minimal page: two buttons (Continue with GitHub,
Continue with Google), redirecting back to the page that asked.

**`/dashboard`.** A React entry like the board. Signed-out visitors
are redirected to `/login`. Card grid per the product design:
thumbnail, inline-editable name, last-modified date, badges "shared"
and "agent connected", per-card menu with delete. A prominent "New
board" button. The free gauge ("7/10 boards") with an upgrade link,
hidden on Pro. A settings section: MCP API key (generate, revoke,
month's usage), plan with the Portal button, sign out, delete account.

**Thumbnails.** `GET /api/boards/:id/thumbnail`, owner only: the
engine's PNG export (the MCP screenshot path) rendered at ~400 px,
cached in `boards.thumbnail` with `thumbnail_seq`; re-rendered only
when the board changed since. A gray placeholder for empty boards.

**Editor.** The logo links to the dashboard when signed in. The
presence identity takes the account's name and avatar for signed-in
users, replacing the generated "Curious Otter" name. An anonymous
board opened by a signed-in user holding both keys offers "Add to my
account".

**Landing.** "Sign in" top right; the "Resume" list remains for
anonymous visitors, signed-in visitors get a dashboard link.

**Adoption on login.** The OAuth return passes through a silent
intermediate page that runs the adoption flow (section 4) before the
final redirect.

## 8. Error handling and security

- OAuth refused or no email from the provider: back to `/login` with a
  message.
- Expired session on a dashboard call: 401, the client redirects to
  `/login`.
- Adoption of a deleted or already-owned board: skipped silently.
- Concurrent adoption of one board: the conditional UPDATE lets exactly
  one win.
- Cookies are httpOnly, SameSite=Lax, Secure in production; CSRF is
  Better Auth's.
- The edit key remains the proof of possession at adoption and is never
  logged, as today. API keys and board keys are hash-only at rest.
- The owner role never applies to MCP calls: board access over MCP
  always comes from the share link, keyed or not (the key meters, it
  does not authorize).
- The existing IP limiter also covers `/api/auth/*` against brute
  force.

## 9. Testing

Unit tests (Vitest, per module, against Postgres as today):

- role resolution: owner session, key, both, neither, wrong owner;
- adoption: proof of possession, cap enforcement, concurrency, skips;
- quota: increment, month rollover, refusal at the limit, revoked key;
- webhook: signature rejection, plan transitions, replay idempotency
  (Stripe SDK mocked);
- thumbnail: cache hit by seq, re-render on change, owner-only.

End to end (Playwright, real server and Postgres, a fake OAuth
provider): sign in, an anonymous board adopted and visible on the
dashboard, the eleventh board refused on free. The webhook is
exercised with forged signed requests, no live Stripe.

## 10. Success criteria

- A visitor draws anonymously exactly as before this work.
- Signing in with GitHub or Google lands on the dashboard with the
  browser's created boards adopted, thumbnails included.
- An owner opens their board from any device with no fragment and gets
  the edit role; share links are unchanged.
- The eleventh board on free is refused with an explicit message;
  after a Stripe test-mode subscription, creation succeeds and the
  gauge disappears.
- An MCP call with a fresh API key draws on a board and shows up in
  the dashboard's usage counter; at the quota the tool answers
  `isError: true`.
- The server runs with no OAuth and no Stripe configuration, accounts
  and billing disabled, all existing tests green.

## 11. Out of scope

- Teams, workspaces, board sharing by invitation.
- Magic link or password authentication.
- Multiple API keys per account, per-key scopes, audit log.
- Prorations UI, coupons, tax handling beyond Stripe defaults.
- Adoption selection screen; boards merely visited are never adopted.
- Migrating the presence identity history; only the display source
  changes.

## 12. Amendments

None yet.
