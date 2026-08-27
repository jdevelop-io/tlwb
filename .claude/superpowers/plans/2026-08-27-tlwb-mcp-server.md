# tlwb MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount an MCP server on `/mcp` of the collaboration server so an AI agent, given a board's share link, can create boards, read them, draw on them, and see them as an image, appearing in the browser as a badged collaborator.

**Architecture:** A `src/mcp/` directory inside `apps/collab-server`. A per-request `McpServer` (stateless streamable HTTP through `@hono/mcp`) registers six tools. Every tool resolves the share URL to a board and a role with the existing `keys.ts`, then works through a virtual `RoomConnection` joined to the in-memory room: mutations travel as Yjs updates through `room.handleMessage`, so validation, persistence, relay, and awareness reuse the human path unchanged. Screenshots rasterize through the engine's `exportScenePng` on `@napi-rs/canvas`.

**Tech Stack:** Node >= 22, TypeScript, Hono 4, `@hono/mcp` 0.3, `@modelcontextprotocol/sdk` 1.30 (v1 import paths: `@modelcontextprotocol/sdk/server/mcp.js`), zod 4, yjs, y-protocols, `@tlwb/engine`, `@tlwb/store-yjs`, `@napi-rs/canvas`, `@fontsource/inter`, `@fontsource/caveat`, Vitest, Postgres (tests), Caddy 2.

**Spec:** `.claude/superpowers/specs/2026-08-27-tlwb-mcp-server-design.md`

## Global Constraints

- Node >= 22, pnpm 11 (root `packageManager`). Biome from the root: `pnpm check` must pass (single quotes, no semicolons, trailing commas, 80 columns, organized imports).
- Files, code, comments, commit messages in English; no em-dashes; gitmoji + Conventional Commits; never add Claude attribution; never cite the plan or the spec in a commit message.
- Tests in `apps/collab-server` run against Postgres: `docker compose up -d postgres` first; `DATABASE_URL` defaults to `postgres://tlwb:tlwb@localhost:5432/tlwb` in `vitest.config.ts`. Files run one after the other (`fileParallelism: false`).
- Run tests from the package: `pnpm --filter @tlwb/collab-server test -- <file>`; typecheck with `pnpm --filter @tlwb/collab-server typecheck`.
- Nothing in `src/mcp/` imports `y-indexeddb`, `y-websocket`, or touches IndexedDB; `@tlwb/store-yjs` is used for `createYjsBoardStore` only.
- Share keys travel only in the URL fragment (`#edit=<key>` or `#view=<key>`), never in a query string. Never log a key.
- Every anticipated failure is a tool result with `isError: true` and one explicit text (section 6 of the spec); unexpected failures answer `internal error` and leave one JSON log line.
- MCP SDK v1 accepts a zod v4 raw shape (`{ field: z.string() }`) as `inputSchema`; import zod as `import { z } from 'zod'` (zod 4 is what the workspace resolves).

## Existing code the tasks rely on (read before starting)

- `apps/collab-server/src/room.ts`: `Room` (`doc`, `join`, `leave`, `handleMessage`, `drain`, `connectionCount`, `closeAll`, `destroy`) and `RoomConnection` (`role`, `send(data)`, `close(code, reason)`). `join` sends a sync step 1 to the connection. A rejected update calls `connection.close(code, reason)` with `CLOSE.invalid` (4422, reason `element <id>`, `meta.name`, `meta.createdAt`, `malformed update`, `out-of-order update`), `CLOSE.readOnly` (4403, `read-only link`), `CLOSE.tooLarge` (4409, `document too large`), or `CLOSE.storage` (1011); it does NOT call `leave`.
- `apps/collab-server/src/protocol.ts`: `encodeSyncStep1(doc)`, `encodeUpdate(update)`, `encodeAwareness(awareness, clientIds)`, `decodeMessage(bytes)` (`sync-step1` | `sync-update` | `awareness` | `query-awareness` | `unknown`), `CLOSE`.
- `apps/collab-server/src/keys.ts`: `generateKey()`, `hashKey(key)`, `resolveRole(token, hashes): 'edit' | 'view' | null`, `type Role`.
- `apps/collab-server/src/db/boards.ts`: `createBoard(db, id, hashes)`, `findBoard(db, id): BoardRecord | undefined`; `src/db/assets.ts`: `getAsset(db, boardId, hash): { mime, bytes: Buffer } | undefined`.
- `apps/collab-server/src/rooms.ts`: `createRooms({ db, config }): RoomRegistry` with `acquire(boardId): Promise<Room | undefined>`, `release(boardId)`, `shutdown()`.
- `apps/collab-server/src/rate-limit.ts`: `createTokenBucket(capacity, refillMs, now)`, `sweepStale(entries, now, olderThanMs)`, `BucketEntry`.
- `apps/collab-server/src/http.ts`: `createApp({ db, config, now? })`, private `clientIp(c, trustProxy)`, the `POST /boards` creation bucket.
- `packages/engine`: `createElement(type, { index, id?, ...props })`, `indexAfter(index | null)`, `getElementBounds(element): Rect`, `exportBounds(elements): Rect`, `exportScenePng(elements, options, createCanvas): Promise<Blob>`, `type ImageResolver = (assetHash) => CanvasImageSource | null`, `BoardStore` (`getElement`, `listElements`, `getMeta`, `setMeta`, `applyChanges(changes, origin)`), `BoardChange`, `ElementProps`, `ElementType`.
- `packages/store-yjs`: `createYjsBoardStore(doc: Y.Doc): BoardStore`. Its `applyChanges` runs one `doc.transact` per call, so the document emits one `update` per `applyChanges` or `setMeta` call.
- `packages/store-yjs/src/presence.ts`: a peer's awareness state is `{ name, color, isAgent, cursor, selectedIds }`; the web derives `id` from the awareness client id.

## File map

| File | Responsibility |
| --- | --- |
| `src/config.ts` (modify) | four `MCP_*` variables and `PUBLIC_URL` |
| `src/rate-limit.ts` (modify) | `createIpLimiter`: per-IP token buckets with sweeping, shared by HTTP and MCP |
| `src/issue-board.ts` (create) | `issueBoard(db)`: id and keys for a new hosted board, shared by `POST /boards` and `create_board` |
| `src/http.ts` (modify) | use `createIpLimiter` and `issueBoard`; export `clientIp`; take `rooms`; mount `/mcp` |
| `src/mcp/tool-error.ts` (create) | `ToolError`, `jsonResult`, `guarded` |
| `src/mcp/board-ref.ts` (create) | share URL parsing, role resolution |
| `src/mcp/agent-client.ts` (create) | `withBoard`: the virtual room connection, `mutate`, `present` |
| `src/mcp/render.ts` (create) | fonts, `renderPng`, `loadImages` |
| `src/mcp/tools/elements.ts` (create) | zod schemas for element input and patch |
| `src/mcp/tools/*.ts` (create) | one `register<Tool>(server, deps, ip)` per tool |
| `src/mcp/server.ts` (create) | `createMcpServer(deps, ip)` |
| `src/mcp/index.ts` (create) | `createMcpApp(deps)`: Hono sub-application with the per-IP limit |
| `apps/web/Caddyfile` (modify) | proxy `/mcp` |
| `apps/collab-server/README.md`, root `README.md` (modify) | configuration and usage |

---

### Task 1: Configuration and dependencies

**Files:**
- Modify: `apps/collab-server/src/config.ts`
- Modify: `apps/collab-server/package.json`
- Test: `apps/collab-server/test/config.test.ts`

**Interfaces:**
- Produces: `Config.mcpLimitPerMin: number` (120), `Config.mcpPresenceMs: number` (5000), `Config.mcpMaxBatch: number` (200), `Config.mcpMaxImagePixels: number` (16_000_000), `Config.publicUrl: string` (defaults to `corsOrigin`).

- [ ] **Step 1: Add the dependencies**

Run from the repository root:

```bash
pnpm --filter @tlwb/collab-server add @modelcontextprotocol/sdk@^1.30.0 @hono/mcp@^0.3.2 @napi-rs/canvas@^1.0.8 @fontsource/inter@^5.3.0 @fontsource/caveat@^5.3.0 zod@^4.4.3
pnpm --filter @tlwb/collab-server remove --save-dev @tlwb/store-yjs
pnpm --filter @tlwb/collab-server add @tlwb/store-yjs@workspace:*
```

Expected: `apps/collab-server/package.json` lists the six new packages and `@tlwb/store-yjs` under `dependencies`, and `pnpm-lock.yaml` changed.

- [ ] **Step 2: Write the failing configuration test**

In `apps/collab-server/test/config.test.ts`, the first test (`applies the defaults`) compares the whole object with `toEqual`: add these five lines to its expected object, after `trustProxy: false,`:

```ts
      publicUrl: 'http://a',
      mcpLimitPerMin: 120,
      mcpPresenceMs: 5000,
      mcpMaxBatch: 200,
      mcpMaxImagePixels: 16_000_000,
```

Then append inside the `describe('loadConfig')` block (`minimal` is the module-level environment the other tests reuse):

```ts
  it('reads PUBLIC_URL and the MCP settings from the environment', () => {
    const config = loadConfig({
      ...minimal,
      PUBLIC_URL: 'https://tlwb.example',
      MCP_LIMIT_PER_MIN: '5',
      MCP_PRESENCE_MS: '100',
      MCP_MAX_BATCH: '3',
      MCP_MAX_IMAGE_PIXELS: '1000',
    })
    expect(config.publicUrl).toBe('https://tlwb.example')
    expect(config.mcpLimitPerMin).toBe(5)
    expect(config.mcpPresenceMs).toBe(100)
    expect(config.mcpMaxBatch).toBe(3)
    expect(config.mcpMaxImagePixels).toBe(1000)
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test -- test/config.test.ts`
Expected: FAIL, the defaults object lacks `publicUrl` and the `mcp*` fields.

- [ ] **Step 4: Implement the configuration**

In `apps/collab-server/src/config.ts`, add to the `Config` interface after `trustProxy: boolean`:

```ts
  /** Origin the share URLs returned by MCP are built on. */
  publicUrl: string
  mcpLimitPerMin: number
  mcpPresenceMs: number
  mcpMaxBatch: number
  mcpMaxImagePixels: number
```

In `loadConfig`, after the `trustProxy` line:

```ts
    publicUrl: env.PUBLIC_URL || corsOrigin,
    mcpLimitPerMin: integer(env, 'MCP_LIMIT_PER_MIN', 120),
    mcpPresenceMs: integer(env, 'MCP_PRESENCE_MS', 5000, 0),
    mcpMaxBatch: integer(env, 'MCP_MAX_BATCH', 200),
    mcpMaxImagePixels: integer(env, 'MCP_MAX_IMAGE_PIXELS', 16_000_000),
```

`corsOrigin` is currently read inline; hoist it so both fields share it:

```ts
export function loadConfig(env: Env): Config {
  const corsOrigin = required(env, 'CORS_ORIGIN')
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    port: integer(env, 'PORT', 3000, 0),
    corsOrigin,
    ...
```

Keep the existing comment above `corsOrigin` next to the hoisted line.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @tlwb/collab-server test -- test/config.test.ts && pnpm --filter @tlwb/collab-server typecheck && pnpm check`
Expected: PASS, no type errors, no Biome findings.

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/package.json pnpm-lock.yaml apps/collab-server/src/config.ts apps/collab-server/test/config.test.ts
git commit -m "🔧 chore(collab-server): configure the MCP endpoint and add its dependencies"
```

---

### Task 2: Tool errors and board references

**Files:**
- Create: `apps/collab-server/src/mcp/tool-error.ts`
- Create: `apps/collab-server/src/mcp/board-ref.ts`
- Test: `apps/collab-server/test/mcp/board-ref.test.ts`

**Interfaces:**
- Produces: `class ToolError extends Error`; `jsonResult(value: unknown): CallToolResult`; `guarded(context: { tool: string; boardId?: string }, run: () => Promise<CallToolResult>): Promise<CallToolResult>`; `interface BoardRef { boardId: string; key: string }`; `parseBoardRef(input: string): BoardRef` (throws `ToolError`); `resolveBoardRole(db: Db, ref: BoardRef): Promise<Role>` (throws `ToolError`); `BOARD_URL_HELP: string`.

- [ ] **Step 1: Write the failing tests**

Create `apps/collab-server/test/mcp/board-ref.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBoard } from '../../src/db/boards'
import { connectDatabase } from '../../src/db/client'
import { generateKey, hashKey } from '../../src/keys'
import {
  BOARD_URL_HELP,
  parseBoardRef,
  resolveBoardRole,
} from '../../src/mcp/board-ref'
import { ToolError } from '../../src/mcp/tool-error'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

describe('parseBoardRef', () => {
  it('reads the board id and the key from an edit or a view link', () => {
    expect(
      parseBoardRef('https://tlwb.example/b/abcdefgh12345678#edit=k1'),
    ).toEqual({ boardId: 'abcdefgh12345678', key: 'k1' })
    expect(parseBoardRef('http://localhost:8080/b/abcdefgh#view=k2')).toEqual(
      { boardId: 'abcdefgh', key: 'k2' },
    )
  })

  it('accepts any host', () => {
    expect(parseBoardRef('https://boards.acme.internal/b/abcdefgh#edit=k').boardId).toBe('abcdefgh')
  })

  it.each([
    'not a url',
    'https://tlwb.example/b/abcdefgh',
    'https://tlwb.example/b/abcdefgh#k=key',
    'https://tlwb.example/b/abcdefgh?edit=key',
    'https://tlwb.example/b/abcdefgh?x=1#edit=key',
    'https://tlwb.example/boards/abcdefgh#edit=key',
    'https://tlwb.example/b/short#edit=key',
  ])('refuses %s with the help text', (input) => {
    expect(() => parseBoardRef(input)).toThrow(new ToolError(BOARD_URL_HELP))
  })
})

describe('resolveBoardRole', () => {
  it('resolves edit and view keys against the stored hashes', async () => {
    const boardId = `ref${Date.now()}`
    const editKey = generateKey()
    const viewKey = generateKey()
    await createBoard(database.db, boardId, {
      editKeyHash: hashKey(editKey),
      viewKeyHash: hashKey(viewKey),
    })
    await expect(
      resolveBoardRole(database.db, { boardId, key: editKey }),
    ).resolves.toBe('edit')
    await expect(
      resolveBoardRole(database.db, { boardId, key: viewKey }),
    ).resolves.toBe('view')
  })

  it('names the board in the not-found and the wrong-key errors', async () => {
    await expect(
      resolveBoardRole(database.db, { boardId: 'missing1', key: 'k' }),
    ).rejects.toThrow(new ToolError('board missing1 not found'))
    const boardId = `wrong${Date.now()}`
    await createBoard(database.db, boardId, {
      editKeyHash: hashKey(generateKey()),
      viewKeyHash: hashKey(generateKey()),
    })
    await expect(
      resolveBoardRole(database.db, { boardId, key: 'nope' }),
    ).rejects.toThrow(new ToolError(`key does not match board ${boardId}`))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/board-ref.test.ts`
Expected: FAIL, cannot find module `../../src/mcp/board-ref`.

- [ ] **Step 3: Write `tool-error.ts`**

Create `apps/collab-server/src/mcp/tool-error.ts`:

```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { log } from '../log'

/** A failure the agent can act on: its message is the whole answer. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

/**
 * Runs a tool body: a ToolError becomes the tool's error text, anything
 * else becomes `internal error` with one log line, and every call logs
 * its outcome and duration. Never the key: `boardId` only.
 */
export async function guarded(
  context: { tool: string; boardId?: string },
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const started = Date.now()
  try {
    const result = await run()
    log({ event: 'mcp tool', ...context, ok: true, ms: Date.now() - started })
    return result
  } catch (error) {
    const ms = Date.now() - started
    if (error instanceof ToolError) {
      log({ event: 'mcp tool', ...context, ok: false, ms, reason: error.message })
      return errorResult(error.message)
    }
    log({ event: 'mcp tool failed', ...context, ms, error: String(error) })
    return errorResult('internal error')
  }
}
```

- [ ] **Step 4: Write `board-ref.ts`**

Create `apps/collab-server/src/mcp/board-ref.ts`:

```ts
import { findBoard } from '../db/boards'
import type { Db } from '../db/client'
import { type Role, resolveRole } from '../keys'
import { ToolError } from './tool-error'

export interface BoardRef {
  boardId: string
  key: string
}

export const BOARD_URL_HELP =
  'board must be a share URL like https://<host>/b/<id>#edit=<key> or #view=<key>'

// Same id alphabet and length bounds as the WebSocket path in ws.ts.
const BOARD_PATH = /^\/b\/([A-Za-z0-9_-]{8,64})$/
const FRAGMENT = /^(?:edit|view)=([A-Za-z0-9_-]+)$/

/**
 * Only the path and the fragment are read: a self-hosted deployment
 * accepts its own links. A key in the query string is refused rather
 * than tolerated, so nobody learns to put it there.
 */
export function parseBoardRef(input: string): BoardRef {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new ToolError(BOARD_URL_HELP)
  }
  const path = BOARD_PATH.exec(url.pathname)
  const fragment = FRAGMENT.exec(url.hash.slice(1))
  if (!path?.[1] || !fragment?.[1] || url.search !== '') {
    throw new ToolError(BOARD_URL_HELP)
  }
  return { boardId: path[1], key: fragment[1] }
}

export async function resolveBoardRole(db: Db, ref: BoardRef): Promise<Role> {
  const board = await findBoard(db, ref.boardId)
  if (!board) {
    throw new ToolError(`board ${ref.boardId} not found`)
  }
  const role = resolveRole(ref.key, board)
  if (!role) {
    throw new ToolError(`key does not match board ${ref.boardId}`)
  }
  return role
}
```

- [ ] **Step 5: Run the tests, the typecheck, and Biome**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/board-ref.test.ts && pnpm --filter @tlwb/collab-server typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/src/mcp/tool-error.ts apps/collab-server/src/mcp/board-ref.ts apps/collab-server/test/mcp/board-ref.test.ts
git commit -m "✨ feat(mcp): resolve a share link to a board and a role"
```

---

### Task 3: The agent client (virtual room connection)

**Files:**
- Create: `apps/collab-server/src/mcp/agent-client.ts`
- Test: `apps/collab-server/test/mcp/agent-client.test.ts`

**Interfaces:**
- Consumes: `BoardRef`, `resolveBoardRole`, `ToolError` (Task 2); `Room`, `RoomConnection`, `RoomRegistry`, protocol helpers.
- Produces:

```ts
export const AGENT_COLOR = '#7C3AED'
export interface AgentDeps { db: Db; rooms: RoomRegistry; presenceMs: number }
export interface AgentPresence { name: string; cursor: Point | null; selectedIds: string[] }
export interface AgentClient {
  readonly boardId: string
  readonly role: Role
  readonly store: BoardStore
  /** Applies `fn` to the mirror and submits what it produced to the room. */
  mutate(fn: (store: BoardStore) => void): Promise<void>
  /** Shows the agent for `presenceMs` after `withBoard` returns. */
  present(presence: AgentPresence): void
}
export function withBoard<T>(deps: AgentDeps, ref: BoardRef, needs: Role, run: (client: AgentClient) => Promise<T>): Promise<T>
```

- [ ] **Step 1: Write the failing tests**

Create `apps/collab-server/test/mcp/agent-client.test.ts`. The room registry is faked around a real `createRoom` so the test needs no database for the room; `resolveBoardRole` still needs one, so the board is created in Postgres.

```ts
import { createElement } from '@tlwb/engine'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createBoard } from '../../src/db/boards'
import { connectDatabase } from '../../src/db/client'
import { generateKey, hashKey } from '../../src/keys'
import { AGENT_COLOR, withBoard } from '../../src/mcp/agent-client'
import { ToolError } from '../../src/mcp/tool-error'
import { decodeMessage } from '../../src/protocol'
import { createRoom, type Room, type RoomConnection } from '../../src/room'
import type { RoomRegistry } from '../../src/rooms'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

interface FakeConnection extends RoomConnection {
  received: Uint8Array[]
}

function observer(room: Room): FakeConnection {
  const fake: FakeConnection = {
    role: 'view',
    received: [],
    send: (data) => fake.received.push(data),
    close: () => {},
  }
  room.join(fake)
  return fake
}

/** Awareness states an observer saw, decoded to their JSON. */
function awarenessStates(connection: FakeConnection): unknown[] {
  const doc = new Y.Doc()
  const { Awareness, applyAwarenessUpdate } = awarenessModule
  const awareness = new Awareness(doc)
  for (const data of connection.received) {
    const message = decodeMessage(data)
    if (message.kind === 'awareness') {
      applyAwarenessUpdate(awareness, message.update, null)
    }
  }
  const states = [...awareness.getStates().values()]
  awareness.destroy()
  doc.destroy()
  return states
}

const awarenessModule = await import('y-protocols/awareness')

async function setup(options: { maxDocBytes?: number } = {}) {
  const boardId = `agent${Date.now()}${Math.floor(Math.random() * 1000)}`
  const editKey = generateKey()
  const viewKey = generateKey()
  await createBoard(database.db, boardId, {
    editKeyHash: hashKey(editKey),
    viewKeyHash: hashKey(viewKey),
  })
  const doc = new Y.Doc()
  const persisted: Uint8Array[] = []
  const room = createRoom(doc, {
    maxMessageBytes: 1_000_000,
    maxDocBytes: options.maxDocBytes ?? 1_000_000,
    maxAwarenessBytes: 16_384,
    persist: async (update) => {
      persisted.push(update)
      return persisted.length
    },
    applied: async () => {},
  })
  const released: string[] = []
  const rooms: RoomRegistry = {
    acquire: async (id) => (id === boardId ? room : undefined),
    release: (id) => {
      released.push(id)
    },
    shutdown: async () => {},
  }
  const deps = { db: database.db, rooms, presenceMs: 0 }
  return { boardId, editKey, viewKey, doc, room, persisted, released, deps }
}

describe('withBoard', () => {
  it('mirrors a non-empty room and applies an accepted mutation to it', async () => {
    const { boardId, editKey, doc, room, persisted, released, deps } =
      await setup()
    doc
      .getMap('elements')
      .set(
        'r1',
        new Y.Map(
          Object.entries(createElement('rectangle', { index: 'a0', id: 'r1' })),
        ),
      )
    const watcher = observer(room)

    const seen = await withBoard(
      deps,
      { boardId, key: editKey },
      'edit',
      async (client) => {
        const before = client.store.listElements().map((e) => e.id)
        await client.mutate((store) =>
          store.applyChanges(
            [
              {
                kind: 'create',
                element: createElement('ellipse', { index: 'a1', id: 'e1' }),
              },
            ],
            'remote',
          ),
        )
        return before
      },
    )

    expect(seen).toEqual(['r1'])
    expect(persisted).toHaveLength(1)
    expect(doc.getMap('elements').has('e1')).toBe(true)
    expect(
      watcher.received.some((d) => decodeMessage(d).kind === 'sync-update'),
    ).toBe(true)
    expect(room.connectionCount()).toBe(1) // the watcher only
    expect(released).toEqual([boardId])
  })

  it('surfaces the room reason when the mutation is rejected', async () => {
    const { boardId, editKey, doc, room, deps } = await setup()
    await expect(
      withBoard(deps, { boardId, key: editKey }, 'edit', (client) =>
        client.mutate((store) =>
          store.applyChanges(
            [
              {
                kind: 'create',
                element: {
                  ...createElement('rectangle', { index: 'a0', id: 'bad' }),
                  width: Number.NaN,
                },
              },
            ],
            'remote',
          ),
        ),
      ),
    ).rejects.toThrow(new ToolError('elements rejected: element bad'))
    expect(doc.getMap('elements').has('bad')).toBe(false)
    expect(room.connectionCount()).toBe(0)
  })

  it('maps the size limit to its own message', async () => {
    const { boardId, editKey, deps } = await setup({ maxDocBytes: 10 })
    await expect(
      withBoard(deps, { boardId, key: editKey }, 'edit', (client) =>
        client.mutate((store) =>
          store.applyChanges(
            [
              {
                kind: 'create',
                element: createElement('rectangle', { index: 'a0', id: 'r' }),
              },
            ],
            'remote',
          ),
        ),
      ),
    ).rejects.toThrow(new ToolError(`board ${boardId} exceeds the size limit`))
  })

  it('refuses a view key when edit is needed, before joining', async () => {
    const { boardId, viewKey, room, deps } = await setup()
    await expect(
      withBoard(deps, { boardId, key: viewKey }, 'edit', async () => 1),
    ).rejects.toThrow(new ToolError(`board ${boardId} is view-only with this link`))
    expect(room.connectionCount()).toBe(0)
  })

  it('lets a view key read', async () => {
    const { boardId, viewKey, deps } = await setup()
    await expect(
      withBoard(deps, { boardId, key: viewKey }, 'view', async (client) =>
        client.role,
      ),
    ).resolves.toBe('view')
  })

  it('publishes the agent presence, then removes it after presenceMs', async () => {
    vi.useFakeTimers()
    try {
      const { boardId, editKey, room, released, deps } = await setup()
      const watcher = observer(room)
      await withBoard(
        { ...deps, presenceMs: 5000 },
        { boardId, key: editKey },
        'edit',
        async (client) => {
          client.present({
            name: 'Claude',
            cursor: { x: 10, y: 20 },
            selectedIds: ['r1'],
          })
        },
      )
      await room.drain()
      expect(awarenessStates(watcher)).toEqual([
        {
          name: 'Claude',
          color: AGENT_COLOR,
          isAgent: true,
          cursor: { x: 10, y: 20 },
          selectedIds: ['r1'],
        },
      ])
      expect(room.connectionCount()).toBe(2)
      expect(released).toEqual([])

      vi.advanceTimersByTime(5000)
      expect(room.connectionCount()).toBe(1)
      expect(released).toEqual([boardId])
      expect(awarenessStates(watcher)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/agent-client.test.ts`
Expected: FAIL, cannot find module `../../src/mcp/agent-client`.

- [ ] **Step 3: Write `agent-client.ts`**

Create `apps/collab-server/src/mcp/agent-client.ts`:

```ts
import type { BoardStore, Point } from '@tlwb/engine'
import { createYjsBoardStore } from '@tlwb/store-yjs'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { Db } from '../db/client'
import type { Role } from '../keys'
import {
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
} from '../protocol'
import type { RoomConnection } from '../room'
import type { RoomRegistry } from '../rooms'
import { type BoardRef, resolveBoardRole } from './board-ref'
import { ToolError } from './tool-error'

/** One fixed colour for every agent: the badge, not the colour, tells them apart. */
export const AGENT_COLOR = '#7C3AED'

export interface AgentDeps {
  db: Db
  rooms: RoomRegistry
  /** How long the agent stays visible after a mutation. */
  presenceMs: number
}

export interface AgentPresence {
  name: string
  cursor: Point | null
  selectedIds: string[]
}

export interface AgentClient {
  readonly boardId: string
  readonly role: Role
  /** The mirror: what the room holds, plus this call's own mutations. */
  readonly store: BoardStore
  /**
   * Runs `fn` on the mirror and submits every update it produced to the
   * room as one message. Resolves once the room accepted it; rejects
   * with a ToolError carrying the room's reason otherwise.
   */
  mutate(fn: (store: BoardStore) => void): Promise<void>
  /**
   * Publishes the agent on the awareness protocol. The connection then
   * outlives `withBoard` by `presenceMs`, and leaving removes the state.
   */
  present(presence: AgentPresence): void
}

function rejection(boardId: string, reason: string): ToolError {
  if (reason === 'document too large') {
    return new ToolError(`board ${boardId} exceeds the size limit`)
  }
  if (reason === 'read-only link') {
    return new ToolError(`board ${boardId} is view-only with this link`)
  }
  return new ToolError(`elements rejected: ${reason}`)
}

/**
 * A virtual connection to the in-memory room: the agent takes the exact
 * path a browser takes (sync, update, awareness through
 * `handleMessage`), so validation, persistence, and relay need nothing
 * agent-specific. One mirror per call; nothing survives between calls.
 */
export async function withBoard<T>(
  deps: AgentDeps,
  ref: BoardRef,
  needs: Role,
  run: (client: AgentClient) => Promise<T>,
): Promise<T> {
  const role = await resolveBoardRole(deps.db, ref)
  if (needs === 'edit' && role !== 'edit') {
    throw new ToolError(`board ${ref.boardId} is view-only with this link`)
  }
  const room = await deps.rooms.acquire(ref.boardId)
  if (!room) {
    throw new ToolError(`board ${ref.boardId} not found`)
  }

  const mirror = new Y.Doc()
  let closed: { code: number; reason: string } | null = null
  const connection: RoomConnection = {
    role,
    send(data) {
      const message = decodeMessage(data)
      if (message.kind === 'sync-update') {
        Y.applyUpdate(mirror, message.update, 'room')
      }
      // The room's own step 1 and awareness broadcasts need no answer.
    },
    close(code, reason) {
      closed = { code, reason }
    },
  }
  let hold = false
  const store = createYjsBoardStore(mirror)

  const client: AgentClient = {
    boardId: ref.boardId,
    role,
    store,
    async mutate(fn) {
      const emitted: Uint8Array[] = []
      const capture = (update: Uint8Array) => {
        emitted.push(update)
      }
      mirror.on('update', capture)
      try {
        fn(store)
      } finally {
        mirror.off('update', capture)
      }
      if (emitted.length === 0) {
        return
      }
      await room.handleMessage(
        connection,
        encodeUpdate(Y.mergeUpdates(emitted)),
      )
      if (closed) {
        throw rejection(ref.boardId, closed.reason)
      }
    },
    present(presence) {
      const awareness = new Awareness(mirror)
      awareness.setLocalState({
        ...presence,
        color: AGENT_COLOR,
        isAgent: true,
      })
      const message = encodeAwareness(awareness, [awareness.clientID])
      // Destroyed right away: the bytes are built, and a live Awareness
      // keeps a timer running.
      awareness.destroy()
      void room.handleMessage(connection, message)
      hold = true
    },
  }

  const leave = () => {
    room.leave(connection)
    deps.rooms.release(ref.boardId)
    mirror.destroy()
  }

  room.join(connection)
  try {
    // The room answers step 1 with step 2, applied to the mirror in `send`.
    await room.handleMessage(connection, encodeSyncStep1(mirror))
    return await run(client)
  } finally {
    if (hold && !closed) {
      setTimeout(leave, deps.presenceMs).unref()
    } else {
      leave()
    }
  }
}
```

Note on `hold && !closed`: a rejected connection has nothing to show; it leaves at once.

- [ ] **Step 4: Run the tests, the typecheck, and Biome**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/agent-client.test.ts && pnpm --filter @tlwb/collab-server typecheck && pnpm check`
Expected: PASS. If the `awarenessModule` top-level `await import` upsets Biome's import ordering, replace it with a static `import { Awareness, applyAwarenessUpdate } from 'y-protocols/awareness'` at the top and drop the destructuring line in `awarenessStates`.

- [ ] **Step 5: Commit**

```bash
git add apps/collab-server/src/mcp/agent-client.ts apps/collab-server/test/mcp/agent-client.test.ts
git commit -m "✨ feat(mcp): join a room as a virtual agent connection"
```

---

### Task 4: MCP server with `create_board` and `read_board`

**Files:**
- Create: `apps/collab-server/src/issue-board.ts`
- Modify: `apps/collab-server/src/rate-limit.ts`
- Modify: `apps/collab-server/src/http.ts`
- Create: `apps/collab-server/src/mcp/server.ts`
- Create: `apps/collab-server/src/mcp/tools/create-board.ts`
- Create: `apps/collab-server/src/mcp/tools/read-board.ts`
- Test: `apps/collab-server/test/mcp/tools.test.ts`
- Test: `apps/collab-server/test/rate-limit.test.ts` (extend)

**Interfaces:**
- Produces: `issueBoard(db): Promise<{ boardId, editKey, viewKey } | null>`; `createIpLimiter(capacity, windowMs, now?): IpLimiter` with `take(ip: string): boolean`; `interface McpDeps { db: Db; config: Config; rooms: RoomRegistry; createLimiter: IpLimiter; now?: () => number }`; `createMcpServer(deps: McpDeps, ip: string): McpServer`; `agentDeps(deps: McpDeps): AgentDeps`; `shareUrls(config, boardId, editKey, viewKey): { editUrl, viewUrl }`.
- Each tool file exports `register<Name>(server: McpServer, deps: McpDeps, ip: string): void`.

- [ ] **Step 1: Write the failing limiter test**

Append to `apps/collab-server/test/rate-limit.test.ts`:

```ts
describe('createIpLimiter', () => {
  it('gives every address its own bucket', () => {
    let now = 0
    const limiter = createIpLimiter(2, 60_000, () => now)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
    expect(limiter.take('b')).toBe(true)
    now = 60_000
    expect(limiter.take('a')).toBe(true)
  })
})
```

Add `createIpLimiter` to the existing import from `../src/rate-limit`.

- [ ] **Step 2: Write the failing tool tests**

Create `apps/collab-server/test/mcp/tools.test.ts`. The `Client` drives the server over `InMemoryTransport`; rooms are real (`createRooms` over Postgres) so persistence is exercised.

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { type Config, loadConfig } from '../../src/config'
import { connectDatabase } from '../../src/db/client'
import { createMcpServer, type McpDeps } from '../../src/mcp/server'
import { createIpLimiter } from '../../src/rate-limit'
import { createRooms, type RoomRegistry } from '../../src/rooms'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>
let rooms: RoomRegistry
let config: Config

beforeAll(async () => {
  database = await connectDatabase(url)
  config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://web.test',
    ROOM_IDLE_MS: '50',
    MCP_PRESENCE_MS: '0',
    MCP_MAX_BATCH: '3',
    MCP_MAX_IMAGE_PIXELS: '100000',
  })
  rooms = createRooms({ db: database.db, config })
})

afterAll(async () => {
  await rooms.shutdown()
  await database.close()
})

const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close()
  }
})

export async function connect(
  overrides: Partial<McpDeps> = {},
  ip = '10.0.0.1',
): Promise<Client> {
  const deps: McpDeps = {
    db: database.db,
    config,
    rooms,
    createLimiter: createIpLimiter(1000, 60_000),
    ...overrides,
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createMcpServer(deps, ip)
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientTransport)
  clients.push(client)
  return client
}

export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult
}

export function textOf(result: CallToolResult): string {
  const block = result.content.find((c) => c.type === 'text')
  if (!block || block.type !== 'text') {
    throw new Error('no text block')
  }
  return block.text
}

export function jsonOf<T>(result: CallToolResult): T {
  return JSON.parse(textOf(result)) as T
}

export async function newBoard(client: Client, name?: string) {
  const result = await call(client, 'create_board', name ? { name } : {})
  expect(result.isError).toBeFalsy()
  return jsonOf<{ boardId: string; editUrl: string; viewUrl: string }>(result)
}

describe('tool listing', () => {
  it('advertises the six tools', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_elements',
      'create_board',
      'delete_elements',
      'get_board_screenshot',
      'read_board',
      'update_elements',
    ])
  })
})

describe('create_board', () => {
  it('returns share URLs on the public origin, with the key in the fragment', async () => {
    const client = await connect()
    const board = await newBoard(client)
    expect(board.editUrl).toMatch(
      new RegExp(`^http://web\\.test/b/${board.boardId}#edit=[A-Za-z0-9_-]{43}$`),
    )
    expect(board.viewUrl).toMatch(
      new RegExp(`^http://web\\.test/b/${board.boardId}#view=[A-Za-z0-9_-]{43}$`),
    )
  })

  it('names the board and stamps its creation time', async () => {
    const client = await connect({ now: () => 1_700_000_000_000 })
    const board = await newBoard(client, 'Architecture')
    const read = jsonOf<{ meta: { name: string; createdAt: number } }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.meta).toEqual({ name: 'Architecture', createdAt: 1_700_000_000_000 })
  })

  it('is bounded by the creation limiter of the calling address', async () => {
    const limiter = createIpLimiter(1, 60_000)
    const client = await connect({ createLimiter: limiter }, '10.9.9.9')
    await newBoard(client)
    const refused = await call(client, 'create_board', {})
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toBe(
      'too many boards created from this address, retry later',
    )
  })
})

describe('read_board', () => {
  it('returns meta and elements of an empty board', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const read = jsonOf<{ elements: unknown[] }>(
      await call(client, 'read_board', { board: board.editUrl }),
    )
    expect(read.elements).toEqual([])
  })

  it.each([
    ['not a url', 'board must be a share URL like https://<host>/b/<id>#edit=<key> or #view=<key>'],
    ['http://web.test/b/missing12#edit=k', 'board missing12 not found'],
  ])('answers %s with a tool error', async (board, message) => {
    const client = await connect()
    const result = await call(client, 'read_board', { board })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(message)
  })

  it('refuses a wrong key by name', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'read_board', {
      board: `http://web.test/b/${board.boardId}#edit=wrong`,
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(`key does not match board ${board.boardId}`)
  })

  it('answers a schema violation as an error result, not a crash', async () => {
    const client = await connect()
    const result = await call(client, 'read_board', { board: 42 })
    expect(result.isError).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/collab-server test -- test/rate-limit.test.ts test/mcp/tools.test.ts`
Expected: FAIL, `createIpLimiter` is not exported; cannot find module `../../src/mcp/server`.

- [ ] **Step 4: Add `createIpLimiter` to `rate-limit.ts`**

Append to `apps/collab-server/src/rate-limit.ts`:

```ts
export interface IpLimiter {
  /** True when the address still had a token; consumes it. */
  take(ip: string): boolean
}

const MAX_TRACKED_IPS = 10_000

/** One token bucket per address, swept when the table grows large. */
export function createIpLimiter(
  capacity: number,
  windowMs: number,
  now: () => number = Date.now,
): IpLimiter {
  let entries = new Map<string, BucketEntry>()
  return {
    take(ip) {
      const nowMs = now()
      if (entries.size > MAX_TRACKED_IPS) {
        // ponytail: sweeps only entries idle past the window, so an
        // address currently limited keeps its state. Remaining ceiling:
        // more than MAX_TRACKED_IPS distinct addresses all active within
        // one window still grow the map; a proper LRU is the upgrade.
        entries = sweepStale(entries, nowMs, windowMs)
      }
      let entry = entries.get(ip)
      if (!entry) {
        entry = {
          bucket: createTokenBucket(capacity, windowMs, now),
          seen: nowMs,
        }
        entries.set(ip, entry)
      } else {
        entry.seen = nowMs
      }
      return entry.bucket.take()
    },
  }
}
```

- [ ] **Step 5: Extract `issueBoard` and refactor `http.ts` onto the limiter**

Create `apps/collab-server/src/issue-board.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { createBoard } from './db/boards'
import type { Db } from './db/client'
import { generateKey, hashKey } from './keys'

export interface IssuedBoard {
  boardId: string
  editKey: string
  viewKey: string
}

/**
 * A new hosted board: a server-issued id (16 random bytes, base64url,
 * 22 characters) and two keys shown once and stored hashed. Null on the
 * one-in-2^128 id collision, which is not worth a retry loop.
 */
export async function issueBoard(db: Db): Promise<IssuedBoard | null> {
  const boardId = randomBytes(16).toString('base64url')
  const editKey = generateKey()
  const viewKey = generateKey()
  const outcome = await createBoard(db, boardId, {
    editKeyHash: hashKey(editKey),
    viewKeyHash: hashKey(viewKey),
  })
  return outcome === 'exists' ? null : { boardId, editKey, viewKey }
}
```

In `apps/collab-server/src/http.ts`:

1. Replace the imports of `randomBytes`, `createBoard`, `generateKey`, `type BucketEntry`, `createTokenBucket`, `sweepStale` by:

```ts
import { createHash } from 'node:crypto'
...
import { findBoard } from './db/boards'
import { issueBoard } from './issue-board'
import { type Role, resolveRole } from './keys'
import { createIpLimiter, type IpLimiter } from './rate-limit'
```

2. Delete the constants `CREATE_WINDOW_MS` and `MAX_TRACKED_IPS` and the `let creationBuckets` line; add inside `createApp` after `const now = ...`:

```ts
  const createLimiter: IpLimiter = createIpLimiter(
    config.createLimitPerMin,
    60_000,
    now,
  )
```

3. Export `clientIp` (change `function clientIp` to `export function clientIp`).

4. Replace the body of `app.post('/boards', ...)` with:

```ts
  app.post('/boards', async (c) => {
    if (!createLimiter.take(clientIp(c, config.trustProxy))) {
      return c.json({ error: 'too many boards created' }, 429)
    }
    const issued = await issueBoard(db)
    if (!issued) {
      return c.json({ error: 'internal error' }, 500)
    }
    return c.json(issued, 201)
  })
```

5. Return the limiter alongside the app so the MCP mount can share it. Change the signature to `export function createApp(deps: HttpDeps): Hono<Env>` unchanged for now; instead, expose the limiter through the deps: add to `HttpDeps`:

```ts
  /** Shared with the MCP `create_board` tool; created here when absent. */
  createLimiter?: IpLimiter
```

and use `const createLimiter = deps.createLimiter ?? createIpLimiter(config.createLimitPerMin, 60_000, now)`.

Run `pnpm --filter @tlwb/collab-server test -- test/http-boards.test.ts` and confirm the existing `POST /boards` tests still pass (they cover the limit and the response shape).

- [ ] **Step 6: Write `server.ts`**

Create `apps/collab-server/src/mcp/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Config } from '../config'
import type { Db } from '../db/client'
import type { IpLimiter } from '../rate-limit'
import type { RoomRegistry } from '../rooms'
import type { AgentDeps } from './agent-client'
import { registerCreateBoard } from './tools/create-board'
import { registerReadBoard } from './tools/read-board'

export interface McpDeps {
  db: Db
  config: Config
  rooms: RoomRegistry
  /** The board creation bucket, shared with `POST /boards`. */
  createLimiter: IpLimiter
  now?: () => number
}

export function agentDeps(deps: McpDeps): AgentDeps {
  return { db: deps.db, rooms: deps.rooms, presenceMs: deps.config.mcpPresenceMs }
}

export function shareUrls(
  config: Config,
  boardId: string,
  editKey: string,
  viewKey: string,
): { editUrl: string; viewUrl: string } {
  // `*` opens CORS to every origin but names none: fall back to a
  // relative link the operator's own host completes.
  const base = config.publicUrl === '*' ? '' : config.publicUrl
  return {
    editUrl: `${base}/b/${boardId}#edit=${editKey}`,
    viewUrl: `${base}/b/${boardId}#view=${viewKey}`,
  }
}

/**
 * One server per request: the transport is stateless, and the calling
 * address is captured here for the tools that limit per address.
 */
export function createMcpServer(deps: McpDeps, ip: string): McpServer {
  const server = new McpServer({ name: 'tlwb', version: '0.0.0' })
  registerCreateBoard(server, deps, ip)
  registerReadBoard(server, deps, ip)
  return server
}
```

- [ ] **Step 7: Write the `create_board` tool**

Create `apps/collab-server/src/mcp/tools/create-board.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { issueBoard } from '../../issue-board'
import { withBoard } from '../agent-client'
import { agentDeps, type McpDeps, shareUrls } from '../server'
import { guarded, jsonResult, ToolError } from '../tool-error'

export function registerCreateBoard(
  server: McpServer,
  deps: McpDeps,
  ip: string,
): void {
  const now = deps.now ?? Date.now
  server.registerTool(
    'create_board',
    {
      description:
        'Create a new hosted whiteboard. Returns its edit URL (share it to let others draw) and its view URL (read-only). Pass one of them as `board` to the other tools.',
      inputSchema: {
        name: z.string().trim().min(1).max(120).optional().describe('Board title'),
      },
    },
    ({ name }) =>
      guarded({ tool: 'create_board' }, async () => {
        if (!deps.createLimiter.take(ip)) {
          throw new ToolError(
            'too many boards created from this address, retry later',
          )
        }
        const issued = await issueBoard(deps.db)
        if (!issued) {
          throw new Error('board id collision')
        }
        await withBoard(
          agentDeps(deps),
          { boardId: issued.boardId, key: issued.editKey },
          'edit',
          (client) =>
            client.mutate((store) =>
              store.setMeta({ name: name ?? 'Untitled', createdAt: now() }),
            ),
        )
        return jsonResult({
          boardId: issued.boardId,
          ...shareUrls(deps.config, issued.boardId, issued.editKey, issued.viewKey),
        })
      }),
  )
}
```

- [ ] **Step 8: Write the `read_board` tool (text only; the image option comes in Task 7)**

Create `apps/collab-server/src/mcp/tools/read-board.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { agentDeps, type McpDeps } from '../server'
import { guarded, jsonResult } from '../tool-error'

export const boardParam = z
  .string()
  .describe('Share URL of the board: https://<host>/b/<id>#edit=<key> or #view=<key>')

export function registerReadBoard(
  server: McpServer,
  deps: McpDeps,
  _ip: string,
): void {
  server.registerTool(
    'read_board',
    {
      description:
        'Read a board: its meta (name, createdAt) and every element in stacking order, exactly as the editor holds them.',
      inputSchema: { board: boardParam },
    },
    ({ board }) => {
      const ref = parseBoardRef(board)
      return guarded({ tool: 'read_board', boardId: ref.boardId }, () =>
        withBoard(agentDeps(deps), ref, 'view', async (client) =>
          jsonResult({
            meta: client.store.getMeta(),
            elements: client.store.listElements(),
          }),
        ),
      )
    },
  )
}
```

`parseBoardRef` throws before `guarded` here, which would leak as an SDK-formatted error. Move it inside: every tool must call `parseBoardRef` inside the `guarded` body. Use this exact shape instead:

```ts
    ({ board }) =>
      guarded({ tool: 'read_board' }, async () => {
        const ref = parseBoardRef(board)
        return withBoard(agentDeps(deps), ref, 'view', async (client) =>
          jsonResult({
            meta: client.store.getMeta(),
            elements: client.store.listElements(),
          }),
        )
      }),
```

The log line then carries no board id for a malformed URL, which is correct: there is none.

- [ ] **Step 9: Run the tests, the typecheck, and Biome**

Run: `pnpm --filter @tlwb/collab-server test -- test/rate-limit.test.ts test/http-boards.test.ts test/mcp/tools.test.ts && pnpm --filter @tlwb/collab-server typecheck && pnpm check`
Expected: PASS except the `tool listing` test, which lists two tools for now: change its expected array to `['create_board', 'read_board']` temporarily and restore the six names in Task 7.

- [ ] **Step 10: Commit**

```bash
git add apps/collab-server/src apps/collab-server/test
git commit -m "✨ feat(mcp): create and read a board through MCP tools"
```

---

### Task 5: Element schemas and `add_elements`

**Files:**
- Create: `apps/collab-server/src/mcp/tools/elements.ts`
- Create: `apps/collab-server/src/mcp/tools/add-elements.ts`
- Modify: `apps/collab-server/src/mcp/server.ts`
- Test: `apps/collab-server/test/mcp/tools.test.ts` (extend)

**Interfaces:**
- Produces: `elementInputSchema(maxBatch): ZodArray`, `elementPatchSchema(maxBatch): ZodArray`, `idsSchema(maxBatch): ZodArray<string>`, `agentNameParam: ZodOptional<ZodString>`, `presenceFor(elements: BoardElement[], name: string | undefined): AgentPresence`, `registerAddElements(server, deps, ip)`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/collab-server/test/mcp/tools.test.ts`:

```ts
describe('add_elements', () => {
  it('creates elements with engine defaults, in input order, and returns their ids', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [
        { type: 'rectangle', id: 'box', x: 0, y: 0, width: 100, height: 50 },
        { type: 'text', x: 10, y: 10, width: 80, height: 30, text: 'Hello' },
        {
          type: 'arrow',
          x: 100,
          y: 25,
          width: 50,
          height: 0,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
          ],
          startBinding: { elementId: 'box' },
        },
      ],
    })
    expect(result.isError).toBeFalsy()
    const { ids } = jsonOf<{ ids: string[] }>(result)
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe('box')

    const read = jsonOf<{
      elements: { id: string; type: string; index: string; strokeColor: string; text?: string; startBinding?: unknown }[]
    }>(await call(client, 'read_board', { board: board.viewUrl }))
    expect(read.elements.map((e) => e.id)).toEqual(ids)
    expect(read.elements[0]?.strokeColor).toBe('#1A1A1A')
    expect(read.elements[1]?.text).toBe('Hello')
    expect(read.elements[2]?.startBinding).toEqual({ elementId: 'box' })
    expect(read.elements[0]?.index < (read.elements[1]?.index ?? '')).toBe(true)
  })

  it('refuses a view link', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.viewUrl,
      elements: [{ type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(`board ${board.boardId} is view-only with this link`)
  })

  it('refuses image elements with its own message', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [{ type: 'image', x: 0, y: 0, width: 1, height: 1 }],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('image elements cannot be added over MCP')
  })

  it('refuses a batch over MCP_MAX_BATCH at the schema', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: Array.from({ length: 4 }, () => ({
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      })),
    })
    expect(result.isError).toBe(true)
  })
})
```

The tool schema and the room's `validateElement` accept the same value space (both are zod 4 numbers and the same enums), so a room rejection cannot be provoked from a well-typed tool call; that path is covered by the `agent-client` tests of Task 3, which inject an invalid element straight into the mirror.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/tools.test.ts`
Expected: FAIL, `add_elements` tool not found.

- [ ] **Step 3: Write `elements.ts`**

Create `apps/collab-server/src/mcp/tools/elements.ts`:

```ts
import { type BoardElement, getElementBounds } from '@tlwb/engine'
import { z } from 'zod'
import type { AgentPresence } from '../agent-client'

const point = z.object({ x: z.number(), y: z.number() })
const binding = z.object({ elementId: z.string() }).nullable()

const style = {
  angle: z.number().optional().describe('Radians'),
  strokeColor: z.string().optional(),
  fillColor: z.string().nullable().optional(),
  strokeWidth: z.number().optional(),
  strokeStyle: z.enum(['solid', 'dashed']).optional(),
  sketchiness: z.number().optional().describe('0 clean, 1 hand-drawn, 2 rough'),
  opacity: z.number().optional().describe('0 to 1'),
  groupId: z.string().nullable().optional(),
}

const box = {
  id: z
    .string()
    .min(1)
    .optional()
    .describe('Optional: set it to bind an arrow to this element in the same batch'),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  ...style,
}

const textProps = {
  fontSize: z.number().optional(),
  fontFamily: z.enum(['hand', 'ui']).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  containerId: z.string().nullable().optional(),
}

const points = z
  .array(point)
  .describe('Relative to x and y, in world units')

/**
 * The engine's element variants with a required core and optional style;
 * `createElement` fills the rest. `image` is accepted here so the tool
 * can refuse it with its own message instead of a schema error.
 */
export const elementInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rectangle'), ...box }),
  z.object({ type: z.literal('ellipse'), ...box }),
  z.object({ type: z.literal('diamond'), ...box }),
  z.object({ type: z.literal('line'), ...box, points }),
  z.object({
    type: z.literal('arrow'),
    ...box,
    points,
    startBinding: binding.optional(),
    endBinding: binding.optional(),
  }),
  z.object({ type: z.literal('draw'), ...box, points }),
  z.object({ type: z.literal('text'), ...box, text: z.string(), ...textProps }),
  z.object({ type: z.literal('image'), ...box }),
])
export type ElementInput = z.infer<typeof elementInput>

export const elementPatch = z.object({
  id: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  ...style,
  points: points.optional(),
  startBinding: binding.optional(),
  endBinding: binding.optional(),
  text: z.string().optional(),
  ...textProps,
})
export type ElementPatch = z.infer<typeof elementPatch>

export function elementInputSchema(maxBatch: number) {
  return z.array(elementInput).min(1).max(maxBatch)
}

export function elementPatchSchema(maxBatch: number) {
  return z.array(elementPatch).min(1).max(maxBatch)
}

export function idsSchema(maxBatch: number) {
  return z.array(z.string()).min(1).max(maxBatch)
}

export const agentNameParam = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .optional()
  .describe('Name shown on the agent avatar; defaults to "Agent"')

/** Cursor on the last touched element, selection on all of them. */
export function presenceFor(
  touched: readonly BoardElement[],
  name: string | undefined,
): AgentPresence {
  const last = touched.at(-1)
  const cursor = last
    ? (() => {
        const bounds = getElementBounds(last)
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()
    : null
  return {
    name: name ?? 'Agent',
    cursor,
    selectedIds: touched.map((element) => element.id),
  }
}
```

- [ ] **Step 4: Write `add-elements.ts`**

Create `apps/collab-server/src/mcp/tools/add-elements.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type BoardChange,
  type BoardElement,
  createElement,
  type ElementProps,
  type ElementType,
  indexAfter,
} from '@tlwb/engine'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { agentDeps, type McpDeps } from '../server'
import { guarded, jsonResult, ToolError } from '../tool-error'
import {
  agentNameParam,
  type ElementInput,
  elementInputSchema,
  presenceFor,
} from './elements'
import { boardParam } from './read-board'

function build(input: ElementInput, index: string): BoardElement {
  const { type, id, ...props } = input
  return createElement(type as ElementType, {
    index,
    id,
    ...(props as ElementProps),
  })
}

export function registerAddElements(
  server: McpServer,
  deps: McpDeps,
  _ip: string,
): void {
  server.registerTool(
    'add_elements',
    {
      description:
        'Add elements to a board (rectangle, ellipse, diamond, line, arrow, draw, text). Unspecified style takes the editor defaults. Set `id` on a shape to bind an arrow to it in the same batch. The whole batch is refused if one element is invalid.',
      inputSchema: {
        board: boardParam,
        elements: elementInputSchema(deps.config.mcpMaxBatch),
        agentName: agentNameParam,
      },
    },
    ({ board, elements, agentName }) =>
      guarded({ tool: 'add_elements' }, async () => {
        const ref = parseBoardRef(board)
        if (elements.some((element) => element.type === 'image')) {
          throw new ToolError('image elements cannot be added over MCP')
        }
        return withBoard(agentDeps(deps), ref, 'edit', async (client) => {
          let index = client.store.listElements().at(-1)?.index ?? null
          const created = elements.map((input) => {
            index = indexAfter(index)
            return build(input, index)
          })
          const changes: BoardChange[] = created.map((element) => ({
            kind: 'create',
            element,
          }))
          await client.mutate((store) => store.applyChanges(changes, 'remote'))
          client.present(presenceFor(created, agentName))
          return jsonResult({ ids: created.map((element) => element.id) })
        })
      }),
  )
}
```

Register it in `server.ts`: import `registerAddElements` from `./tools/add-elements` and call `registerAddElements(server, deps, ip)` after `registerReadBoard`.

- [ ] **Step 5: Run the tests, the typecheck, and Biome**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/tools.test.ts && pnpm --filter @tlwb/collab-server typecheck && pnpm check`
Expected: PASS (update the `tool listing` expectation to `['add_elements', 'create_board', 'read_board']` for now).

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/src/mcp apps/collab-server/test/mcp/tools.test.ts
git commit -m "✨ feat(mcp): add elements to a board as a badged agent"
```

---

### Task 6: `update_elements` and `delete_elements`

**Files:**
- Create: `apps/collab-server/src/mcp/tools/update-elements.ts`
- Create: `apps/collab-server/src/mcp/tools/delete-elements.ts`
- Modify: `apps/collab-server/src/mcp/server.ts`
- Test: `apps/collab-server/test/mcp/tools.test.ts` (extend)

**Interfaces:**
- Consumes: `elementPatchSchema`, `idsSchema`, `agentNameParam`, `presenceFor` (Task 5); `withBoard` (Task 3).
- Produces: `registerUpdateElements(server, deps, ip)`, `registerDeleteElements(server, deps, ip)`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/collab-server/test/mcp/tools.test.ts`:

```ts
async function boardWithBox(client: Client) {
  const board = await newBoard(client)
  await call(client, 'add_elements', {
    board: board.editUrl,
    elements: [
      { type: 'rectangle', id: 'box', x: 0, y: 0, width: 100, height: 50 },
      { type: 'text', id: 'label', x: 0, y: 0, width: 50, height: 20, text: 'a' },
    ],
  })
  return board
}

describe('update_elements', () => {
  it('patches the named properties and keeps the others', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'update_elements', {
      board: board.editUrl,
      updates: [
        { id: 'box', x: 40, fillColor: '#FFEE00' },
        { id: 'label', text: 'b' },
      ],
    })
    expect(result.isError).toBeFalsy()
    expect(jsonOf(result)).toEqual({ updated: ['box', 'label'] })
    const read = jsonOf<{ elements: Record<string, unknown>[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    const box = read.elements.find((e) => e.id === 'box')
    expect(box).toMatchObject({ x: 40, width: 100, fillColor: '#FFEE00' })
    expect(read.elements.find((e) => e.id === 'label')).toMatchObject({ text: 'b' })
  })

  it('refuses the batch when an id is unknown', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'update_elements', {
      board: board.editUrl,
      updates: [{ id: 'box', x: 1 }, { id: 'ghost', x: 1 }],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('element ghost not found')
    const read = jsonOf<{ elements: Record<string, unknown>[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.elements.find((e) => e.id === 'box')).toMatchObject({ x: 0 })
  })

  it('refuses a view link', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'update_elements', {
      board: board.viewUrl,
      updates: [{ id: 'box', x: 1 }],
    })
    expect(textOf(result)).toBe(`board ${board.boardId} is view-only with this link`)
  })
})

describe('delete_elements', () => {
  it('deletes the named elements', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'delete_elements', {
      board: board.editUrl,
      ids: ['label'],
    })
    expect(jsonOf(result)).toEqual({ deleted: ['label'] })
    const read = jsonOf<{ elements: { id: string }[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.elements.map((e) => e.id)).toEqual(['box'])
  })

  it('refuses the batch when an id is unknown', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'delete_elements', {
      board: board.editUrl,
      ids: ['box', 'ghost'],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('element ghost not found')
    const read = jsonOf<{ elements: { id: string }[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.elements).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/tools.test.ts`
Expected: FAIL, `update_elements` tool not found.

- [ ] **Step 3: Write `update-elements.ts`**

Create `apps/collab-server/src/mcp/tools/update-elements.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BoardChange, BoardElement, ElementProps } from '@tlwb/engine'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { agentDeps, type McpDeps } from '../server'
import { guarded, jsonResult, ToolError } from '../tool-error'
import { agentNameParam, elementPatchSchema, presenceFor } from './elements'
import { boardParam } from './read-board'

export function registerUpdateElements(
  server: McpServer,
  deps: McpDeps,
  _ip: string,
): void {
  server.registerTool(
    'update_elements',
    {
      description:
        'Update properties of existing elements. Each entry names an id and only the properties to change; `type` cannot change. The whole batch is refused if an id is unknown or a value is invalid.',
      inputSchema: {
        board: boardParam,
        updates: elementPatchSchema(deps.config.mcpMaxBatch),
        agentName: agentNameParam,
      },
    },
    ({ board, updates, agentName }) =>
      guarded({ tool: 'update_elements' }, async () => {
        const ref = parseBoardRef(board)
        return withBoard(agentDeps(deps), ref, 'edit', async (client) => {
          for (const { id } of updates) {
            if (!client.store.getElement(id)) {
              throw new ToolError(`element ${id} not found`)
            }
          }
          const changes: BoardChange[] = updates.map(({ id, ...props }) => ({
            kind: 'update',
            id,
            props: props as ElementProps,
          }))
          await client.mutate((store) => store.applyChanges(changes, 'remote'))
          const touched = updates
            .map(({ id }) => client.store.getElement(id))
            .filter((element): element is BoardElement => element !== undefined)
          client.present(presenceFor(touched, agentName))
          return jsonResult({ updated: updates.map(({ id }) => id) })
        })
      }),
  )
}
```

- [ ] **Step 4: Write `delete-elements.ts`**

Create `apps/collab-server/src/mcp/tools/delete-elements.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BoardChange, BoardElement } from '@tlwb/engine'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { agentDeps, type McpDeps } from '../server'
import { guarded, jsonResult, ToolError } from '../tool-error'
import { agentNameParam, idsSchema, presenceFor } from './elements'
import { boardParam } from './read-board'

export function registerDeleteElements(
  server: McpServer,
  deps: McpDeps,
  _ip: string,
): void {
  server.registerTool(
    'delete_elements',
    {
      description:
        'Delete elements by id. The whole batch is refused if an id is unknown.',
      inputSchema: {
        board: boardParam,
        ids: idsSchema(deps.config.mcpMaxBatch),
        agentName: agentNameParam,
      },
    },
    ({ board, ids, agentName }) =>
      guarded({ tool: 'delete_elements' }, async () => {
        const ref = parseBoardRef(board)
        return withBoard(agentDeps(deps), ref, 'edit', async (client) => {
          const targets: BoardElement[] = []
          for (const id of ids) {
            const element = client.store.getElement(id)
            if (!element) {
              throw new ToolError(`element ${id} not found`)
            }
            targets.push(element)
          }
          const changes: BoardChange[] = ids.map((id) => ({ kind: 'delete', id }))
          await client.mutate((store) => store.applyChanges(changes, 'remote'))
          // Bounds read before the deletion: the cursor lands where the
          // last element was.
          const presence = presenceFor(targets, agentName)
          client.present({ ...presence, selectedIds: [] })
          return jsonResult({ deleted: ids })
        })
      }),
  )
}
```

Register both in `server.ts` after `registerAddElements`.

- [ ] **Step 5: Run the tests, the typecheck, and Biome**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/tools.test.ts && pnpm --filter @tlwb/collab-server typecheck && pnpm check`
Expected: PASS (update the `tool listing` expectation to the five names for now).

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/src/mcp apps/collab-server/test/mcp/tools.test.ts
git commit -m "✨ feat(mcp): update and delete board elements through MCP"
```

---

### Task 7: PNG rendering, `get_board_screenshot`, and `read_board` with image

**Files:**
- Create: `apps/collab-server/src/mcp/render.ts`
- Create: `apps/collab-server/src/mcp/tools/get-board-screenshot.ts`
- Modify: `apps/collab-server/src/mcp/tools/read-board.ts`
- Modify: `apps/collab-server/src/mcp/server.ts`
- Test: `apps/collab-server/test/mcp/render.test.ts`
- Test: `apps/collab-server/test/mcp/tools.test.ts` (extend)

**Interfaces:**
- Produces: `FONTS = { hand: 'Caveat', ui: 'Inter' }`; `renderPng(elements, options: { scale: number; maxPixels: number; resolveImage?: ImageResolver }): Promise<Uint8Array | null>` (null when over `maxPixels`); `loadImages(db, boardId, elements): Promise<ImageResolver>`; `imageBlock(png: Uint8Array): ImageContent`; `registerGetBoardScreenshot(server, deps, ip)`.

- [ ] **Step 1: Write the failing render test**

Create `apps/collab-server/test/mcp/render.test.ts`:

```ts
import { loadImage } from '@napi-rs/canvas'
import { createElement, EXPORT_MARGIN } from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import { renderPng } from '../../src/mcp/render'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

const scene = [
  createElement('rectangle', { index: 'a0', id: 'r', seed: 1, x: 10, y: 10, width: 200, height: 100 }),
  createElement('text', { index: 'a1', id: 't', seed: 1, x: 20, y: 20, width: 100, height: 30, text: 'Hello', fontFamily: 'ui' }),
]

describe('renderPng', () => {
  it('renders a PNG framed on the bounds plus the margin, scaled', async () => {
    const png = await renderPng(scene, { scale: 2, maxPixels: 10_000_000 })
    expect(png).not.toBeNull()
    expect([...(png as Uint8Array).slice(0, 4)]).toEqual(PNG_SIGNATURE)
    const image = await loadImage(Buffer.from(png as Uint8Array))
    expect(image.width).toBe((200 + 2 * EXPORT_MARGIN) * 2)
    expect(image.height).toBe((100 + 2 * EXPORT_MARGIN) * 2)
  })

  it('renders an empty board as one background pixel', async () => {
    const png = await renderPng([], { scale: 1, maxPixels: 10 })
    const image = await loadImage(Buffer.from(png as Uint8Array))
    expect(image.width).toBe(1)
    expect(image.height).toBe(1)
  })

  it('returns null over the pixel bound', async () => {
    await expect(renderPng(scene, { scale: 1, maxPixels: 100 })).resolves.toBeNull()
  })
})
```

If `exportBounds([])` yields a 1 by 1 image in the engine (the spec of the editor says so), the second test holds; otherwise read `packages/engine/src/export/bounds.ts` and assert the actual empty-board size it produces.

- [ ] **Step 2: Write the failing tool tests**

Append to `apps/collab-server/test/mcp/tools.test.ts`:

```ts
function imageOf(result: CallToolResult): { data: string; mimeType: string } {
  const block = result.content.find((c) => c.type === 'image')
  if (!block || block.type !== 'image') {
    throw new Error('no image block')
  }
  return block
}

describe('get_board_screenshot', () => {
  it('returns a PNG image block', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'get_board_screenshot', { board: board.viewUrl })
    expect(result.isError).toBeFalsy()
    const image = imageOf(result)
    expect(image.mimeType).toBe('image/png')
    expect(Buffer.from(image.data, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    )
  })

  it('refuses a render over MCP_MAX_IMAGE_PIXELS', async () => {
    const client = await connect()
    const board = await newBoard(client)
    await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [{ type: 'rectangle', x: 0, y: 0, width: 1000, height: 1000 }],
    })
    const result = await call(client, 'get_board_screenshot', { board: board.viewUrl, scale: 1 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(`board ${board.boardId} is too large to render; lower scale`)
  })

  it('bounds scale at the schema', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'get_board_screenshot', { board: board.viewUrl, scale: 9 })
    expect(result.isError).toBe(true)
  })
})

describe('read_board with image', () => {
  it('adds a PNG block after the JSON text', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'read_board', { board: board.viewUrl, image: true })
    expect(result.content.map((c) => c.type)).toEqual(['text', 'image'])
    expect(jsonOf<{ elements: unknown[] }>(result).elements).toHaveLength(2)
  })
})
```

Restore the `tool listing` expectation to the six names.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/render.test.ts test/mcp/tools.test.ts`
Expected: FAIL, cannot find module `../../src/mcp/render`; `get_board_screenshot` not found.

- [ ] **Step 4: Write `render.ts`**

Create `apps/collab-server/src/mcp/render.ts`:

```ts
import { fileURLToPath } from 'node:url'
import {
  createCanvas,
  GlobalFonts,
  type Image,
  loadImage,
  Path2D,
} from '@napi-rs/canvas'
import {
  type BoardElement,
  exportBounds,
  exportScenePng,
  type ImageResolver,
} from '@tlwb/engine'
import type { ImageContent } from '@modelcontextprotocol/sdk/types.js'
import { getAsset } from '../db/assets'
import type { Db } from '../db/client'

// The engine references the DOM Path2D global; napi provides it here.
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D
}

/** The web application's faces, from the same packages it loads. */
export const FONTS = { hand: 'Caveat', ui: 'Inter' }
const BACKGROUND = '#FFFFFF'

function register(specifier: string, family: string): void {
  GlobalFonts.registerFromPath(
    fileURLToPath(import.meta.resolve(specifier)),
    family,
  )
}
register('@fontsource/inter/files/inter-latin-400-normal.woff2', FONTS.ui)
register('@fontsource/caveat/files/caveat-latin-500-normal.woff2', FONTS.hand)

/** A napi canvas with the browser's `toBlob`, which napi lacks. */
function canvasFactory(): () => HTMLCanvasElement {
  return () => {
    const canvas = createCanvas(1, 1)
    return Object.assign(canvas, {
      toBlob(callback: (blob: Blob | null) => void, type?: string) {
        callback(
          new Blob([new Uint8Array(canvas.toBuffer('image/png'))], { type }),
        )
      },
    }) as unknown as HTMLCanvasElement
  }
}

export interface RenderOptions {
  scale: number
  /** Output pixels (width times height) above which nothing is rendered. */
  maxPixels: number
  resolveImage?: ImageResolver
}

/** Null when the output would exceed `maxPixels`. */
export async function renderPng(
  elements: readonly BoardElement[],
  options: RenderOptions,
): Promise<Uint8Array | null> {
  const bounds = exportBounds(elements)
  const pixels =
    Math.ceil(bounds.width) * Math.ceil(bounds.height) * options.scale ** 2
  if (pixels > options.maxPixels) {
    return null
  }
  const blob = await exportScenePng(
    elements,
    {
      scale: options.scale,
      fonts: FONTS,
      background: BACKGROUND,
      resolveImage: options.resolveImage,
    },
    canvasFactory(),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Decodes every asset the board's image elements reference, so the
 * synchronous resolver the renderer wants can answer from memory. An
 * asset that is missing or undecodable renders as nothing.
 */
export async function loadImages(
  db: Db,
  boardId: string,
  elements: readonly BoardElement[],
): Promise<ImageResolver> {
  const images = new Map<string, Image>()
  for (const element of elements) {
    if (element.type !== 'image' || images.has(element.assetHash)) {
      continue
    }
    const asset = await getAsset(db, boardId, element.assetHash)
    if (!asset) {
      continue
    }
    try {
      images.set(element.assetHash, await loadImage(asset.bytes))
    } catch {
      // Not decodable: skipped, like a broken image in the browser.
    }
  }
  return (assetHash) =>
    (images.get(assetHash) as unknown as CanvasImageSource | undefined) ?? null
}

export function imageBlock(png: Uint8Array): ImageContent {
  return {
    type: 'image',
    data: Buffer.from(png).toString('base64'),
    mimeType: 'image/png',
  }
}
```

If `exportBounds` of an empty list does not produce a 1 by 1 image, keep the engine's behaviour and fix the test; do not special-case here.

- [ ] **Step 5: Write `get-board-screenshot.ts`**

Create `apps/collab-server/src/mcp/tools/get-board-screenshot.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { withBoard } from '../agent-client'
import { parseBoardRef } from '../board-ref'
import { imageBlock, loadImages, renderPng } from '../render'
import { agentDeps, type McpDeps } from '../server'
import { guarded, ToolError } from '../tool-error'
import { boardParam } from './read-board'

export const scaleParam = z
  .number()
  .min(0.25)
  .max(3)
  .default(1)
  .describe('Pixels per world unit; 2 for a sharper image')

export function registerGetBoardScreenshot(
  server: McpServer,
  deps: McpDeps,
  _ip: string,
): void {
  server.registerTool(
    'get_board_screenshot',
    {
      description:
        'Render the whole board as a PNG, as the editor exports it, for visual verification.',
      inputSchema: { board: boardParam, scale: scaleParam },
    },
    ({ board, scale }) =>
      guarded({ tool: 'get_board_screenshot' }, async () => {
        const ref = parseBoardRef(board)
        return withBoard(agentDeps(deps), ref, 'view', async (client) => {
          const elements = client.store.listElements()
          const png = await renderPng(elements, {
            scale,
            maxPixels: deps.config.mcpMaxImagePixels,
            resolveImage: await loadImages(deps.db, ref.boardId, elements),
          })
          if (!png) {
            throw new ToolError(
              `board ${ref.boardId} is too large to render; lower scale`,
            )
          }
          return { content: [imageBlock(png)] }
        })
      }),
  )
}
```

- [ ] **Step 6: Add the `image` option to `read_board`**

In `apps/collab-server/src/mcp/tools/read-board.ts`, add `image: z.boolean().default(false).describe('Also return a PNG of the board')` to `inputSchema`, import `imageBlock`, `loadImages`, `renderPng` from `../render` and `ToolError` from `../tool-error`, and replace the `withBoard` body with:

```ts
        return withBoard(agentDeps(deps), ref, 'view', async (client) => {
          const elements = client.store.listElements()
          const result = jsonResult({ meta: client.store.getMeta(), elements })
          if (!image) {
            return result
          }
          const png = await renderPng(elements, {
            scale: 1,
            maxPixels: deps.config.mcpMaxImagePixels,
            resolveImage: await loadImages(deps.db, ref.boardId, elements),
          })
          if (!png) {
            throw new ToolError(
              `board ${ref.boardId} is too large to render; lower scale`,
            )
          }
          return { content: [...result.content, imageBlock(png)] }
        })
```

with `({ board, image })` as the handler's destructured argument. Register `registerGetBoardScreenshot` in `server.ts`.

- [ ] **Step 7: Run the tests, the typecheck, and Biome**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/render.test.ts test/mcp/tools.test.ts && pnpm --filter @tlwb/collab-server typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/collab-server/src/mcp apps/collab-server/test/mcp
git commit -m "✨ feat(mcp): render a board to PNG for the agent"
```

---

### Task 8: Mount `/mcp` in the HTTP application

**Files:**
- Create: `apps/collab-server/src/mcp/index.ts`
- Modify: `apps/collab-server/src/http.ts`
- Modify: `apps/collab-server/src/server.ts`
- Modify: `apps/collab-server/test/http-boards.test.ts`, `apps/collab-server/test/http-assets.test.ts` (add `rooms` to the `createApp` call)
- Test: `apps/collab-server/test/mcp/http.test.ts`

**Interfaces:**
- Consumes: `createMcpServer`, `McpDeps` (Task 4); `clientIp` (exported in Task 4).
- Produces: `createMcpApp(deps: McpDeps & { trustProxy: boolean }): Hono<Env>`; `HttpDeps.rooms: RoomRegistry` (required).

- [ ] **Step 1: Write the failing HTTP test**

Create `apps/collab-server/test/mcp/http.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config'
import { connectDatabase } from '../../src/db/client'
import { createApp } from '../../src/http'
import { createRooms, type RoomRegistry } from '../../src/rooms'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>
let rooms: RoomRegistry

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await rooms?.shutdown()
  await database.close()
})

function app(overrides: Record<string, string> = {}, now?: () => number) {
  const config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    ROOM_IDLE_MS: '50',
    ...overrides,
  })
  rooms = createRooms({ db: database.db, config })
  return createApp({ db: database.db, config, rooms, now })
}

function rpc(method: string, params: Record<string, unknown> = {}, ip = '10.0.0.1') {
  return new Request('http://server/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}

/** The first JSON-RPC result of a JSON or SSE-framed response. */
async function resultOf(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  const line = text
    .split('\n')
    .find((l) => l.startsWith('data:')) ?? text
  return JSON.parse(line.replace(/^data:\s*/, '')).result
}

describe('POST /mcp', () => {
  it('answers a tools/list through the streamable HTTP transport', async () => {
    const response = await app({ TRUST_PROXY: 'true' }).request(rpc('tools/list'))
    expect(response.status).toBe(200)
    const result = await resultOf(response)
    const names = (result.tools as { name: string }[]).map((t) => t.name)
    expect(names).toContain('create_board')
    expect(names).toHaveLength(6)
  })

  it('limits requests per address', async () => {
    let now = 0
    const limited = app({ TRUST_PROXY: 'true', MCP_LIMIT_PER_MIN: '2' }, () => now)
    expect((await limited.request(rpc('tools/list', {}, '10.1.1.1'))).status).toBe(200)
    expect((await limited.request(rpc('tools/list', {}, '10.1.1.1'))).status).toBe(200)
    const refused = await limited.request(rpc('tools/list', {}, '10.1.1.1'))
    expect(refused.status).toBe(429)
    expect((await limited.request(rpc('tools/list', {}, '10.1.1.2'))).status).toBe(200)
    now = 60_000
    expect((await limited.request(rpc('tools/list', {}, '10.1.1.1'))).status).toBe(200)
  })

  it('runs a tool call end to end over HTTP', async () => {
    const response = await app({ TRUST_PROXY: 'true' }).request(
      rpc('tools/call', { name: 'create_board', arguments: {} }),
    )
    expect(response.status).toBe(200)
    const result = await resultOf(response)
    const text = (result.content as { text: string }[])[0]?.text ?? ''
    expect(JSON.parse(text).editUrl).toMatch(/^http:\/\/a\/b\/.+#edit=/)
  })
})
```

The stateless transport may require an `initialize` before `tools/list`; if the first test answers with a JSON-RPC error saying so, prepend an `initialize` request in each test (`rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })`) and read the `mcp-session-id` header; in stateless mode there is none and the following calls need no header.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test -- test/mcp/http.test.ts`
Expected: FAIL, `createApp` rejects `rooms` at typecheck, or `/mcp` answers 404.

- [ ] **Step 3: Write `mcp/index.ts`**

Create `apps/collab-server/src/mcp/index.ts`:

```ts
import type { HttpBindings } from '@hono/node-server'
import { StreamableHTTPTransport } from '@hono/mcp'
import { Hono } from 'hono'
import { clientIp } from '../http'
import { createIpLimiter } from '../rate-limit'
import { createMcpServer, type McpDeps } from './server'

type Env = { Bindings: HttpBindings }

/**
 * The MCP endpoint, stateless: one transport and one McpServer per
 * request, nothing kept between two. Mounted under `/mcp` by the HTTP
 * application, so the route here is `/`.
 */
export function createMcpApp(deps: McpDeps & { trustProxy: boolean }): Hono<Env> {
  const app = new Hono<Env>()
  const limiter = createIpLimiter(
    deps.config.mcpLimitPerMin,
    60_000,
    deps.now ?? Date.now,
  )
  app.all('/', async (c) => {
    const ip = clientIp(c, deps.trustProxy)
    if (c.req.method === 'POST' && !limiter.take(ip)) {
      return c.json({ error: 'too many requests' }, 429)
    }
    const server = createMcpServer(deps, ip)
    const transport = new StreamableHTTPTransport()
    await server.connect(transport)
    return transport.handleRequest(c)
  })
  return app
}
```

If `clientIp` importing from `../http` creates a circular import with `http.ts` importing `./mcp`, move `clientIp` into a new `apps/collab-server/src/client-ip.ts` (same body, exported) and import it from both files.

- [ ] **Step 4: Wire it in `http.ts` and `server.ts`**

In `apps/collab-server/src/http.ts`:

- Add `import type { RoomRegistry } from './rooms'` and `import { createMcpApp } from './mcp'`.
- Add `rooms: RoomRegistry` to `HttpDeps` (required).
- After the asset routes, before `return app`:

```ts
  app.route(
    '/mcp',
    createMcpApp({
      db,
      config,
      rooms: deps.rooms,
      createLimiter,
      now,
      trustProxy: config.trustProxy,
    }),
  )
```

In `apps/collab-server/src/server.ts`, pass the registry: `const app = createApp({ db: database.db, config, rooms })`.

In `test/http-boards.test.ts` and `test/http-assets.test.ts`, add `rooms: createRooms({ db: database.db, config })` to the `createApp` call (build `config` first, then pass it to both), and `await rooms.shutdown()` in `afterAll` if the helper keeps a reference; a registry with no acquired room has nothing to shut down, so a module-level `const rooms = ...` created once per file after `connectDatabase` is enough.

- [ ] **Step 5: Run the whole package suite, the typecheck, and Biome**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/src apps/collab-server/test
git commit -m "✨ feat(collab-server): serve the MCP endpoint on /mcp"
```

---

### Task 9: Caddy, documentation, and specification amendment

**Files:**
- Modify: `apps/web/Caddyfile`
- Modify: `apps/collab-server/README.md`
- Modify: `README.md`
- Modify: `.claude/superpowers/specs/2026-08-27-tlwb-mcp-server-design.md`

- [ ] **Step 1: Proxy `/mcp` in Caddy**

In `apps/web/Caddyfile`, after the `@ws` handle:

```
	@mcp path /mcp
	handle @mcp {
		reverse_proxy collab-server:3000
	}
```

Check the Vite development proxy in `apps/web/vite.config.ts`: if it proxies `/api` and `/ws`, add `'/mcp': { target: 'http://localhost:3000' }` next to them so `http://localhost:5173/mcp` works in development too.

- [ ] **Step 2: Document the server**

In `apps/collab-server/README.md`:

- Configuration table, after `TRUST_PROXY`:

```
| `PUBLIC_URL`            | `CORS_ORIGIN` | Origin the MCP `create_board` share URLs are built on |
| `MCP_LIMIT_PER_MIN`     | `120`      | MCP requests per IP per minute         |
| `MCP_PRESENCE_MS`       | `5000`     | How long an agent stays visible after an edit |
| `MCP_MAX_BATCH`         | `200`      | Elements or ids per MCP call           |
| `MCP_MAX_IMAGE_PIXELS`  | `16000000` | Largest PNG an MCP render produces     |
```

- A new `## MCP` section before `## Deployment`:

```markdown
## MCP

`POST /mcp` is a stateless Model Context Protocol endpoint (streamable
HTTP). Paste into any MCP client:

```json
{ "mcpServers": { "tlwb": { "url": "http://localhost:8080/mcp" } } }
```

The credential is the board's share link, passed as `board` to every
tool: an edit link allows mutations, a view link allows reading only.

- `create_board({ name? })`: `{ boardId, editUrl, viewUrl }`.
- `read_board({ board, image? })`: `{ meta, elements }`, plus a PNG when
  `image` is true.
- `add_elements({ board, elements, agentName? })`: `{ ids }`.
- `update_elements({ board, updates, agentName? })`: `{ updated }`.
- `delete_elements({ board, ids, agentName? })`: `{ deleted }`.
- `get_board_screenshot({ board, scale? })`: a PNG.

After a mutation the agent appears in the board's avatar stack, badged,
for `MCP_PRESENCE_MS`. Mutations go through the same validation and
persistence as a browser's; an invalid batch is refused whole.
```

- [ ] **Step 3: Document the product**

In the root `README.md`, after the "Running the product" paragraph, add:

```markdown
### Letting an agent draw

The stack serves an MCP endpoint at `http://localhost:8080/mcp`. Add it
to Claude Code (`claude mcp add --transport http tlwb http://localhost:8080/mcp`)
or any MCP client, share a board's edit link with the agent, and ask it
to draw: it appears on the board as a badged collaborator. See
`apps/collab-server/README.md` for the tools.
```

- [ ] **Step 4: Amend the specification**

Append to `.claude/superpowers/specs/2026-08-27-tlwb-mcp-server-design.md` a section `## 10. Amendments` with the date and these points:

- `PUBLIC_URL` (default `CORS_ORIGIN`) added to the configuration: the server needs an origin to build the share URLs `create_board` returns; with `*`, the URLs are relative.
- A mutation tool returns as soon as the room accepted the update; the five-second presence window runs after the response, not before it, so an agent's loop is not slowed by its own avatar.
- The virtual connection's mirror is synchronized through the room's real step 1 / step 2 exchange rather than seeded from the room document.

Also update section 6's configuration list to include `PUBLIC_URL`.

- [ ] **Step 5: Run the checks and commit**

Run: `pnpm check`
Expected: PASS (Biome formats markdown tables it can reach; keep the table aligned with the existing rows).

```bash
git add apps/web/Caddyfile apps/web/vite.config.ts apps/collab-server/README.md README.md .claude/superpowers/specs/2026-08-27-tlwb-mcp-server-design.md
git commit -m "📝 docs(mcp): expose /mcp through Caddy and document the agent tools"
```

Omit `apps/web/vite.config.ts` from the `git add` if it was not changed.

---

### Task 10: End-to-end tests

**Files:**
- Test: `apps/collab-server/test/e2e.test.ts` (extend)

**Interfaces:**
- Consumes: the running `startServer` of the existing file (`base` is `localhost:<port>`), `connectBoard` and `createYjsBoardStore` from `@tlwb/store-yjs`, `createPresence` from `@tlwb/store-yjs`.

- [ ] **Step 1: Write the failing tests**

In `apps/collab-server/test/e2e.test.ts`, add to the `loadConfig` call in `beforeAll`: `MCP_PRESENCE_MS: '300'`. Add imports:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { connectBoard, createPresence, createYjsBoardStore } from '@tlwb/store-yjs'
```

Append a new `describe`:

```ts
describe('MCP over HTTP', () => {
  async function mcpClient(): Promise<Client> {
    const client = new Client({ name: 'e2e', version: '0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://${base}/mcp`)),
    )
    return client
  }

  function textOf(result: CallToolResult): string {
    const block = result.content.find((c) => c.type === 'text')
    return block?.type === 'text' ? block.text : ''
  }

  it('lets an agent create a board, draw on it, and be seen by a browser', async () => {
    const agent = await mcpClient()
    const created = (await agent.callTool({
      name: 'create_board',
      arguments: { name: 'Agents' },
    })) as CallToolResult
    const { boardId, editUrl } = JSON.parse(textOf(created)) as {
      boardId: string
      editUrl: string
    }
    const editKey = editUrl.split('#edit=')[1] as string

    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const browser = connectBoard(doc, { url: `ws://${base}/ws`, boardId, token: editKey })
    const presence = createPresence(browser.awareness, {
      name: 'Human',
      color: '#000000',
      isAgent: false,
    })
    await waitFor(() => browser.getStatus() === 'connected')

    const added = (await agent.callTool({
      name: 'add_elements',
      arguments: {
        board: editUrl,
        agentName: 'Claude',
        elements: [
          { type: 'rectangle', id: 'box', x: 0, y: 0, width: 120, height: 60 },
          { type: 'text', x: 10, y: 10, width: 100, height: 20, text: 'API' },
        ],
      },
    })) as CallToolResult
    expect(added.isError).toBeFalsy()

    await waitFor(() => store.getElement('box') !== undefined)
    await waitFor(() =>
      presence.getPeers().some((peer) => peer.isAgent && peer.name === 'Claude'),
    )
    const agentPeer = presence.getPeers().find((peer) => peer.isAgent)
    expect(agentPeer?.selectedIds).toContain('box')
    expect(agentPeer?.cursor).not.toBeNull()
    await waitFor(() => !presence.getPeers().some((peer) => peer.isAgent))

    const shot = (await agent.callTool({
      name: 'get_board_screenshot',
      arguments: { board: editUrl },
    })) as CallToolResult
    const image = shot.content.find((c) => c.type === 'image')
    expect(image?.type).toBe('image')

    presence.destroy()
    browser.destroy()
    browser.awareness.destroy()
    doc.destroy()
    await agent.close()
  })

  it('persists agent edits across room eviction', async () => {
    const agent = await mcpClient()
    const created = (await agent.callTool({ name: 'create_board', arguments: {} })) as CallToolResult
    const { editUrl } = JSON.parse(textOf(created)) as { editUrl: string }
    await agent.callTool({
      name: 'add_elements',
      arguments: {
        board: editUrl,
        elements: [{ type: 'ellipse', id: 'e', x: 0, y: 0, width: 10, height: 10 }],
      },
    })
    // ROOM_IDLE_MS is 50 in this file and MCP_PRESENCE_MS 300: the room
    // is evicted after the presence window, so the next read reloads it
    // from Postgres.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const read = (await agent.callTool({
      name: 'read_board',
      arguments: { board: editUrl },
    })) as CallToolResult
    const { elements } = JSON.parse(textOf(read)) as { elements: { id: string }[] }
    expect(elements.map((e) => e.id)).toEqual(['e'])
    await agent.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails or passes for the right reason**

Run: `pnpm --filter @tlwb/collab-server test -- test/e2e.test.ts`
Expected: PASS if Tasks 1 to 8 are complete. If it fails, the failure is a real integration defect (transport framing, presence not relayed, eviction timing); fix the source, not the test, and rerun.

- [ ] **Step 3: Run the full workspace verification**

Run from the root: `pnpm check && pnpm typecheck && pnpm test`
Expected: PASS across every package.

- [ ] **Step 4: Verify manually against the built stack**

```bash
docker compose up --build -d
claude mcp add --transport http tlwb http://localhost:8080/mcp
```

Then in a Claude Code session: ask for a new board, open the returned edit URL in a browser, ask the agent to draw three labelled boxes joined by arrows, and check the avatar stack shows the badged agent while it draws. Note the outcome in the pull request description. Remove the MCP entry afterwards with `claude mcp remove tlwb`.

- [ ] **Step 5: Commit**

```bash
git add apps/collab-server/test/e2e.test.ts
git commit -m "✅ test(mcp): drive a board through MCP and watch it from a browser"
```

---

## Self-review

- Spec coverage: section 3 (architecture, virtual connection, data flow) by Tasks 3, 4, 5, 8; section 4 (six tools, schemas, image refusal, batch bound, PNG) by Tasks 4 to 7; section 5 (presence) by Tasks 3, 5, 6; section 6 (every error row, rate limit, configuration, logging) by Tasks 1, 2, 3, 4, 7, 8; section 7 (tests) by the test files of each task and Task 10; section 8 (Caddy, documentation, manual check) by Tasks 9 and 10.
- Deviations recorded as spec amendments in Task 9: `PUBLIC_URL`, presence window after the response, mirror synchronized through the step 1 / step 2 exchange.
- Type consistency: `McpDeps` (`db`, `config`, `rooms`, `createLimiter`, `now?`) is defined in Task 4 and consumed unchanged by Tasks 5 to 8; `AgentDeps` (`db`, `rooms`, `presenceMs`) by Task 3 and `agentDeps()` in Task 4; `presenceFor(elements, name)` returns `AgentPresence` (`name`, `cursor`, `selectedIds`); `renderPng` returns `Uint8Array | null`; every tool registers as `register<Name>(server, deps, ip)`.
