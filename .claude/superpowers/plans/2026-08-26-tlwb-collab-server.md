# tlwb Collaboration Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/collab-server`: the Node process that creates hosted
boards and their share keys, relays Yjs updates and awareness between
collaborators, enforces read-only links, rejects malformed elements on a
staging document, persists every board in Postgres, and stores the image
blobs of hosted boards.

**Architecture:** One Hono application for HTTP (`POST /boards`, assets,
health) and one `ws` server on the same Node HTTP server for
`/ws/:boardId?token=...`. A room holds one `Y.Doc` per board plus a
staging `Y.Doc` kept in step with it: every incoming update is applied to
staging first, validated with the engine's `validateElement`, persisted,
then applied to the room document whose `update` event relays it. Rooms
load from a snapshot plus residual updates and compact back into a
snapshot. Drizzle over `postgres` for the three tables, migrations
applied at boot.

**Tech Stack:** TypeScript (strict), Vitest, `hono`, `@hono/node-server`,
`ws`, `yjs`, `y-protocols`, `lib0`, `drizzle-orm`, `drizzle-kit`,
`postgres`, `tsx`, `zod` (engine side); Postgres 17 in Docker Compose
and as a CI service container.

**Spec:** `.claude/superpowers/specs/2026-08-26-tlwb-collab-server-design.md`

## Global Constraints

- License: MIT, copyright JDevelop.
- All file content, code, comments, and commit messages in English.
- Commits: gitmoji + Conventional Commits (`<emoji> <type>(<scope>): <summary>`), scope `collab-server` (scope `engine` for Task 1, `ci` for the workflow change).
- TDD is mandatory: every behavior lands red first, then green.
- Node.js >= 22, pnpm 11, `"type": "module"` (ESM only), TypeScript `strict` plus `noUncheckedIndexedAccess` (inherited from `tsconfig.base.json`).
- `apps/collab-server` runtime dependencies are exactly `@tlwb/engine` (workspace), `@hono/node-server`, `drizzle-orm`, `hono`, `lib0`, `postgres`, `tsx`, `ws`, `y-protocols`, `yjs`. Development dependencies are exactly `@tlwb/store-yjs` (workspace), `@types/node`, `@types/ws`, `drizzle-kit`, `typescript`, `vitest`. Nothing else: no ORM helpers, no logging library, no test containers library.
- `packages/engine` gains exactly one module (`src/model/validate.ts`), one test file, and one export line; nothing else in the engine changes. `packages/store-yjs` is not modified.
- The server never validates awareness content and never persists awareness.
- Every accepted update is inserted in Postgres before it is relayed.
- Tests that need Postgres read `DATABASE_URL`; `vitest.config.ts` defaults it to the Compose database `postgres://tlwb:tlwb@localhost:5432/tlwb`. Run `docker compose up -d postgres` once before running the server tests locally. Test files run serially (`fileParallelism: false`) because they share one database and the migrator is not concurrency-safe.
- Test isolation is by identifier: every test creates its own boards with `crypto.randomUUID()` identifiers and never truncates tables.
- Every `Y.Doc`, `Awareness`, server, database connection, and WebSocket created in a test is closed or destroyed at the end of that test.
- Style: Biome (`pnpm check` must pass), single quotes, no semicolons, two-space indent, 80 columns.
- All commands run from the repository root.

---

## File Structure

Created:

- `packages/engine/src/model/validate.ts`: `validateElement(value): value is BoardElement`, a zod schema over the element union.
- `packages/engine/test/model/validate.test.ts`.
- `apps/collab-server/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`, `README.md`, `Dockerfile`.
- `apps/collab-server/src/config.ts`: environment variables to a `Config`.
- `apps/collab-server/src/log.ts`: JSON lines on stdout.
- `apps/collab-server/src/keys.ts`: key generation, hashing, role resolution.
- `apps/collab-server/src/rate-limit.ts`: token bucket.
- `apps/collab-server/src/db/schema.ts`, `db/client.ts`, `db/boards.ts`, `db/assets.ts`, `src/migrations/` (generated).
- `apps/collab-server/src/protocol.ts`: message encoding and decoding, close codes.
- `apps/collab-server/src/room.ts`: one board in memory.
- `apps/collab-server/src/rooms.ts`: registry, loading, compaction, eviction.
- `apps/collab-server/src/http.ts`: Hono application.
- `apps/collab-server/src/ws.ts`: upgrade handling and connection wiring.
- `apps/collab-server/src/server.ts`: composition root.
- `apps/collab-server/src/main.ts`: process entry point.
- `apps/collab-server/test/*.test.ts` as listed per task.
- `docker-compose.yml` and `.dockerignore` at the repository root.

Modified:

- `packages/engine/src/index.ts`: one export line.
- `.github/workflows/ci.yml`: Postgres service and `DATABASE_URL` on the `verify` job.
- `README.md` (repository root): one list entry.

Slice 1 is Tasks 1 to 5 (validator, scaffold, keys, database, board
creation over HTTP). Slice 2 is Tasks 6 and 7 (protocol, room, registry,
WebSocket, end to end). Slice 3 is Tasks 8 to 10 (assets, deployment,
verification).

---

### Task 1: Element validator in the engine

**Files:**
- Create: `packages/engine/src/model/validate.ts`
- Modify: `packages/engine/src/index.ts` (add one export after the `export * from './model/element'` line)
- Test: `packages/engine/test/model/validate.test.ts`

**Interfaces:**
- Consumes: `BoardElement` and `createElement` from the engine model.
- Produces: `validateElement(value: unknown): value is BoardElement`, exported from `@tlwb/engine`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/model/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createElement } from '../../src/model/create'
import type { ElementType } from '../../src/model/element'
import { validateElement } from '../../src/model/validate'

const types: ElementType[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'draw',
  'text',
  'image',
]

describe('validateElement', () => {
  it('accepts every element the factory produces', () => {
    for (const type of types) {
      expect(validateElement(createElement(type, { index: 'a0' }))).toBe(true)
    }
  })

  it('accepts variant properties with content', () => {
    expect(
      validateElement(
        createElement('arrow', {
          index: 'a0',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 5 },
          ],
          startBinding: { elementId: 'r1' },
          endBinding: null,
        }),
      ),
    ).toBe(true)
    expect(
      validateElement(
        createElement('text', {
          index: 'a0',
          text: 'hello',
          fontSize: 24,
          fontFamily: 'ui',
          textAlign: 'center',
          containerId: 'r1',
        }),
      ),
    ).toBe(true)
  })

  it('rejects a mistyped, missing, or non-finite property', () => {
    const good = createElement('rectangle', { index: 'a0' })
    expect(validateElement({ ...good, x: 'oops' })).toBe(false)
    expect(validateElement({ ...good, x: Number.NaN })).toBe(false)
    expect(validateElement({ ...good, strokeStyle: 'dotted' })).toBe(false)
    const { index: _index, ...missingIndex } = good
    expect(validateElement(missingIndex)).toBe(false)
  })

  it('rejects an unknown type, a variant missing its properties, and non-objects', () => {
    const good = createElement('rectangle', { index: 'a0' })
    expect(validateElement({ ...good, type: 'star' })).toBe(false)
    expect(validateElement({ ...good, type: 'line' })).toBe(false)
    expect(validateElement({ ...good, type: 'text' })).toBe(false)
    expect(validateElement(null)).toBe(false)
    expect(validateElement('rectangle')).toBe(false)
    expect(validateElement(undefined)).toBe(false)
  })

  it('rejects a non-finite point inside a stroke', () => {
    const line = createElement('line', {
      index: 'a0',
      points: [{ x: 0, y: Number.POSITIVE_INFINITY }],
    })
    expect(validateElement(line)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/engine exec vitest run test/model/validate.test.ts`

Expected: FAIL, cannot resolve `../../src/model/validate`.

- [ ] **Step 3: Write the validator**

`packages/engine/src/model/validate.ts`:

```ts
import { z } from 'zod'
import type { BoardElement } from './element'

// zod 4 numbers reject NaN and infinities by default, which is the
// guard a trust boundary needs against a malformed remote element.
const base = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  angle: z.number(),
  strokeColor: z.string(),
  fillColor: z.string().nullable(),
  strokeWidth: z.number(),
  strokeStyle: z.enum(['solid', 'dashed']),
  sketchiness: z.number(),
  opacity: z.number(),
  seed: z.number(),
  index: z.string().min(1),
  groupId: z.string().nullable(),
}

const point = z.object({ x: z.number(), y: z.number() })
const binding = z.object({ elementId: z.string() }).nullable()

const elementSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('rectangle') }),
  z.object({ ...base, type: z.literal('ellipse') }),
  z.object({ ...base, type: z.literal('diamond') }),
  z.object({ ...base, type: z.literal('line'), points: z.array(point) }),
  z.object({
    ...base,
    type: z.literal('arrow'),
    points: z.array(point),
    startBinding: binding,
    endBinding: binding,
  }),
  z.object({ ...base, type: z.literal('draw'), points: z.array(point) }),
  z.object({
    ...base,
    type: z.literal('text'),
    text: z.string(),
    fontSize: z.number(),
    fontFamily: z.enum(['hand', 'ui']),
    textAlign: z.enum(['left', 'center', 'right']),
    containerId: z.string().nullable(),
  }),
  z.object({ ...base, type: z.literal('image'), assetHash: z.string() }),
])

/**
 * Whether a value received from outside the engine (network, agent,
 * import) is a well-formed element. Extra properties are tolerated:
 * the engine ignores what it does not know.
 */
export function validateElement(value: unknown): value is BoardElement {
  return elementSchema.safeParse(value).success
}
```

Add to `packages/engine/src/index.ts`, right after the line
`export * from './model/element'`:

```ts
export { validateElement } from './model/validate'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/engine exec vitest run test/model/validate.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the engine suite, typecheck, and Biome**

Run: `pnpm --filter @tlwb/engine test && pnpm --filter @tlwb/engine typecheck && pnpm check`

Expected: all pass. If Biome reports import order in `index.ts`, run `pnpm check:write` and re-run.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/model/validate.ts packages/engine/src/index.ts packages/engine/test/model/validate.test.ts
git commit -m "✨ feat(engine): validate an element received from outside the engine"
```

---

### Task 2: Package scaffold, configuration, logging, Compose database

**Files:**
- Create: `apps/collab-server/package.json`
- Create: `apps/collab-server/tsconfig.json`
- Create: `apps/collab-server/vitest.config.ts`
- Create: `apps/collab-server/src/config.ts`
- Create: `apps/collab-server/src/log.ts`
- Create: `docker-compose.yml`
- Test: `apps/collab-server/test/config.test.ts`

**Interfaces:**
- Produces: `Config` and `loadConfig(env: Record<string, string | undefined>): Config` (throws `ConfigError` naming the variable); `log(event: Record<string, unknown>): void`.

- [ ] **Step 1: Create the package files**

`apps/collab-server/package.json`:

```json
{
  "name": "@tlwb/collab-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts",
    "dev": "tsx watch src/main.ts",
    "db:generate": "drizzle-kit generate",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^2.1.1",
    "@tlwb/engine": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "hono": "^4.13.5",
    "lib0": "^0.2.117",
    "postgres": "^3.4.9",
    "tsx": "^4.20.0",
    "ws": "^8.21.3",
    "y-protocols": "^1.0.7",
    "yjs": "^13.6.32"
  },
  "devDependencies": {
    "@tlwb/store-yjs": "workspace:*",
    "@types/node": "^26.2.0",
    "@types/ws": "^8.18.1",
    "drizzle-kit": "^0.31.10",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

`apps/collab-server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "vitest.config.ts", "drizzle.config.ts"]
}
```

`apps/collab-server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // One shared database and a migrator that is not concurrency-safe:
    // files run one after the other.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb',
    },
  },
})
```

`docker-compose.yml` at the repository root:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: tlwb
      POSTGRES_PASSWORD: tlwb
      POSTGRES_DB: tlwb
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tlwb"]
      interval: 5s
      timeout: 5s
      retries: 10

  collab-server:
    build:
      context: .
      dockerfile: apps/collab-server/Dockerfile
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://tlwb:tlwb@postgres:5432/tlwb
      CORS_ORIGIN: http://localhost:5173
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres-data:
```

Run: `pnpm install`

Expected: the lockfile gains the new packages; `apps/collab-server/node_modules` exists.

- [ ] **Step 2: Write the failing configuration test**

`apps/collab-server/test/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config'

const minimal = { DATABASE_URL: 'postgres://x', CORS_ORIGIN: 'http://a' }

describe('loadConfig', () => {
  it('applies the defaults', () => {
    const config = loadConfig(minimal)
    expect(config).toEqual({
      databaseUrl: 'postgres://x',
      port: 3000,
      corsOrigin: 'http://a',
      maxMessageBytes: 1_048_576,
      maxDocBytes: 5_242_880,
      maxAssetBytes: 10_485_760,
      maxAwarenessBytes: 16_384,
      roomIdleMs: 60_000,
      compactAfterUpdates: 500,
      rateLimitPer10s: 200,
      createLimitPerMin: 10,
    })
  })

  it('reads overrides', () => {
    const config = loadConfig({ ...minimal, PORT: '8080', ROOM_IDLE_MS: '5' })
    expect(config.port).toBe(8080)
    expect(config.roomIdleMs).toBe(5)
    expect(loadConfig({ ...minimal, PORT: '0' }).port).toBe(0)
  })

  it('fails naming a missing DATABASE_URL', () => {
    expect(() => loadConfig({ CORS_ORIGIN: 'http://a' })).toThrow(
      new ConfigError('DATABASE_URL is required'),
    )
  })

  it('requires CORS_ORIGIN in production and allows any origin otherwise', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production' }),
    ).toThrow(new ConfigError('CORS_ORIGIN is required'))
    expect(loadConfig({ DATABASE_URL: 'postgres://x' }).corsOrigin).toBe('*')
  })

  it('fails naming a non-numeric limit', () => {
    expect(() => loadConfig({ ...minimal, MAX_DOC_BYTES: 'big' })).toThrow(
      new ConfigError('MAX_DOC_BYTES must be a positive integer'),
    )
    expect(() => loadConfig({ ...minimal, PORT: '-1' })).toThrow(
      new ConfigError('PORT must be a positive integer'),
    )
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server test`

Expected: FAIL, cannot resolve `../src/config`.

- [ ] **Step 4: Write the configuration and the logger**

`apps/collab-server/src/config.ts`:

```ts
export interface Config {
  databaseUrl: string
  port: number
  corsOrigin: string
  maxMessageBytes: number
  maxDocBytes: number
  maxAssetBytes: number
  maxAwarenessBytes: number
  roomIdleMs: number
  compactAfterUpdates: number
  rateLimitPer10s: number
  createLimitPerMin: number
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

type Env = Record<string, string | undefined>

function required(env: Env, name: string): string {
  const value = env[name]
  if (!value) {
    throw new ConfigError(`${name} is required`)
  }
  return value
}

function integer(
  env: Env,
  name: string,
  fallback: number,
  minimum = 1,
): number {
  const raw = env[name]
  if (raw === undefined) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum) {
    throw new ConfigError(`${name} must be a positive integer`)
  }
  return value
}

/** Reads and validates the environment; throws ConfigError on the first problem. */
export function loadConfig(env: Env): Config {
  const production = env.NODE_ENV === 'production'
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    // 0 asks the OS for an ephemeral port; the tests rely on it.
    port: integer(env, 'PORT', 3000, 0),
    corsOrigin: production
      ? required(env, 'CORS_ORIGIN')
      : (env.CORS_ORIGIN ?? '*'),
    maxMessageBytes: integer(env, 'MAX_MESSAGE_BYTES', 1_048_576),
    maxDocBytes: integer(env, 'MAX_DOC_BYTES', 5_242_880),
    maxAssetBytes: integer(env, 'MAX_ASSET_BYTES', 10_485_760),
    maxAwarenessBytes: integer(env, 'MAX_AWARENESS_BYTES', 16_384),
    roomIdleMs: integer(env, 'ROOM_IDLE_MS', 60_000),
    compactAfterUpdates: integer(env, 'COMPACT_AFTER_UPDATES', 500),
    rateLimitPer10s: integer(env, 'RATE_LIMIT_PER_10S', 200),
    createLimitPerMin: integer(env, 'CREATE_LIMIT_PER_MIN', 10),
  }
}
```

`apps/collab-server/src/log.ts`:

```ts
/** One JSON line per event on stdout; no logging library. */
export function log(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...event }))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/collab-server test`

Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck, Biome, start the database**

Run: `pnpm --filter @tlwb/collab-server typecheck && pnpm check && docker compose up -d postgres && docker compose ps`

Expected: typecheck and Biome pass; `postgres` shows `healthy` (wait a few seconds and re-run `docker compose ps` if it shows `starting`).

- [ ] **Step 7: Commit**

```bash
git add apps/collab-server docker-compose.yml pnpm-lock.yaml
git commit -m "🎉 feat(collab-server): scaffold the server package with its configuration"
```

---

### Task 3: Capability keys

**Files:**
- Create: `apps/collab-server/src/keys.ts`
- Test: `apps/collab-server/test/keys.test.ts`

**Interfaces:**
- Produces: `type Role = 'edit' | 'view'`; `generateKey(): string`; `hashKey(key: string): Buffer`; `resolveRole(token: string, hashes: { editKeyHash: Uint8Array; viewKeyHash: Uint8Array }): Role | null`.

- [ ] **Step 1: Write the failing test**

`apps/collab-server/test/keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generateKey, hashKey, resolveRole } from '../src/keys'

describe('keys', () => {
  it('generates distinct base64url keys of 32 bytes', () => {
    const a = generateKey()
    const b = generateKey()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(a, 'base64url')).toHaveLength(32)
  })

  it('hashes deterministically to 32 bytes', () => {
    const key = generateKey()
    expect(hashKey(key)).toHaveLength(32)
    expect(hashKey(key).equals(hashKey(key))).toBe(true)
    expect(hashKey(key).equals(hashKey(generateKey()))).toBe(false)
  })

  it('resolves the role from the presented token', () => {
    const editKey = generateKey()
    const viewKey = generateKey()
    const hashes = {
      editKeyHash: hashKey(editKey),
      viewKeyHash: hashKey(viewKey),
    }
    expect(resolveRole(editKey, hashes)).toBe('edit')
    expect(resolveRole(viewKey, hashes)).toBe('view')
    expect(resolveRole(generateKey(), hashes)).toBeNull()
    expect(resolveRole('', hashes)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/keys.test.ts`

Expected: FAIL, cannot resolve `../src/keys`.

- [ ] **Step 3: Write the keys module**

`apps/collab-server/src/keys.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export type Role = 'edit' | 'view'

export interface KeyHashes {
  editKeyHash: Uint8Array
  viewKeyHash: Uint8Array
}

/** 32 random bytes, base64url: the only time the clear key exists. */
export function generateKey(): string {
  return randomBytes(32).toString('base64url')
}

export function hashKey(key: string): Buffer {
  return createHash('sha256').update(key).digest()
}

function matches(presented: Buffer, stored: Uint8Array): boolean {
  return (
    presented.length === stored.length && timingSafeEqual(presented, stored)
  )
}

/** The role a token grants, or null when it matches neither key. */
export function resolveRole(token: string, hashes: KeyHashes): Role | null {
  if (token.length === 0) {
    return null
  }
  const presented = hashKey(token)
  if (matches(presented, hashes.editKeyHash)) {
    return 'edit'
  }
  if (matches(presented, hashes.viewKeyHash)) {
    return 'view'
  }
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/keys.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/collab-server/src/keys.ts apps/collab-server/test/keys.test.ts
git commit -m "✨ feat(collab-server): generate and resolve capability keys"
```

---

### Task 4: Database schema, migrations, board persistence, compaction

**Files:**
- Create: `apps/collab-server/drizzle.config.ts`
- Create: `apps/collab-server/src/db/schema.ts`
- Create: `apps/collab-server/src/db/client.ts`
- Create: `apps/collab-server/src/db/boards.ts`
- Create: `apps/collab-server/src/migrations/` (generated by drizzle-kit)
- Test: `apps/collab-server/test/boards-db.test.ts`

**Interfaces:**
- Consumes: `hashKey`, `generateKey` from Task 3.
- Produces from `db/client.ts`: `type Db = PostgresJsDatabase<typeof schema>`; `connectDatabase(url: string): Promise<{ db: Db; close(): Promise<void> }>` (runs migrations).
- Produces from `db/boards.ts`: `createBoard(db, id, hashes): Promise<'created' | 'exists'>`; `findBoard(db, id): Promise<{ id: string; editKeyHash: Buffer; viewKeyHash: Buffer } | undefined>`; `appendUpdate(db, boardId, update: Uint8Array): Promise<number>` (the new `seq`); `loadBoard(db, id): Promise<{ snapshot: Buffer | null; snapshotSeq: number; updates: { seq: number; update: Buffer }[] } | undefined>`; `compactBoard(db, boardId, snapshot: Uint8Array, upToSeq: number): Promise<void>`.

- [ ] **Step 1: Write the schema and the drizzle-kit configuration**

`apps/collab-server/src/db/schema.ts`:

```ts
import {
  bigint,
  bigserial,
  customType,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

export const boards = pgTable('boards', {
  id: text('id').primaryKey(),
  editKeyHash: bytea('edit_key_hash').notNull(),
  viewKeyHash: bytea('view_key_hash').notNull(),
  snapshot: bytea('snapshot'),
  snapshotSeq: bigint('snapshot_seq', { mode: 'number' })
    .notNull()
    .default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const boardUpdates = pgTable(
  'board_updates',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    update: bytea('update').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.seq] })],
)

export const assets = pgTable(
  'assets',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    hash: text('hash').notNull(),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.hash] })],
)
```

`apps/collab-server/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/migrations',
})
```

- [ ] **Step 2: Generate the first migration**

Run: `pnpm --filter @tlwb/collab-server db:generate`

Expected: `apps/collab-server/src/migrations/0000_<name>.sql` and `src/migrations/meta/` appear. Open the SQL file and check it creates `boards`, `board_updates`, and `assets` with the columns above.

- [ ] **Step 3: Write the failing database test**

`apps/collab-server/test/boards-db.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { connectDatabase } from '../src/db/client'
import {
  appendUpdate,
  compactBoard,
  createBoard,
  findBoard,
  loadBoard,
} from '../src/db/boards'
import { generateKey, hashKey } from '../src/keys'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function hashes() {
  return {
    editKeyHash: hashKey(generateKey()),
    viewKeyHash: hashKey(generateKey()),
  }
}

describe('boards', () => {
  it('creates once and reports the duplicate', async () => {
    const id = randomUUID()
    const keys = hashes()
    expect(await createBoard(database.db, id, keys)).toBe('created')
    expect(await createBoard(database.db, id, hashes())).toBe('exists')
    const found = await findBoard(database.db, id)
    expect(found?.editKeyHash.equals(keys.editKeyHash)).toBe(true)
    expect(found?.viewKeyHash.equals(keys.viewKeyHash)).toBe(true)
    expect(await findBoard(database.db, randomUUID())).toBeUndefined()
  })

  it('loads an empty board as no snapshot and no updates', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    expect(await loadBoard(database.db, id)).toEqual({
      snapshot: null,
      snapshotSeq: 0,
      updates: [],
    })
    expect(await loadBoard(database.db, randomUUID())).toBeUndefined()
  })

  it('appends updates in order and loads them back', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    const first = await appendUpdate(database.db, id, new Uint8Array([1, 2]))
    const second = await appendUpdate(database.db, id, new Uint8Array([3]))
    expect(second).toBeGreaterThan(first)
    const loaded = await loadBoard(database.db, id)
    expect(loaded?.updates.map((row) => row.seq)).toEqual([first, second])
    expect([...(loaded?.updates[0]?.update ?? [])]).toEqual([1, 2])
  })

  it('compacts into a snapshot and drops the covered updates', async () => {
    const id = randomUUID()
    await createBoard(database.db, id, hashes())
    const doc = new Y.Doc()
    const seqs: number[] = []
    for (const key of ['a', 'b', 'c']) {
      const before = Y.encodeStateVector(doc)
      doc.getMap('elements').set(key, key)
      seqs.push(
        await appendUpdate(database.db, id, Y.encodeStateAsUpdate(doc, before)),
      )
    }
    await compactBoard(
      database.db,
      id,
      Y.encodeStateAsUpdate(doc),
      seqs[1] as number,
    )
    const loaded = await loadBoard(database.db, id)
    expect(loaded?.snapshotSeq).toBe(seqs[1])
    expect(loaded?.updates.map((row) => row.seq)).toEqual([seqs[2]])
    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, loaded?.snapshot as Buffer)
    for (const row of loaded?.updates ?? []) {
      Y.applyUpdate(rebuilt, row.update)
    }
    expect(rebuilt.getMap('elements').toJSON()).toEqual({
      a: 'a',
      b: 'b',
      c: 'c',
    })
    doc.destroy()
    rebuilt.destroy()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/boards-db.test.ts`

Expected: FAIL, cannot resolve `../src/db/client`.

- [ ] **Step 5: Write the client and the board queries**

`apps/collab-server/src/db/client.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = PostgresJsDatabase<typeof schema>

export interface Database {
  db: Db
  close(): Promise<void>
}

/** Connects and applies pending migrations; the image is the deployment. */
export async function connectDatabase(url: string): Promise<Database> {
  const sql = postgres(url)
  const db = drizzle(sql, { schema })
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  })
  return {
    db,
    close: async () => {
      await sql.end()
    },
  }
}
```

`apps/collab-server/src/db/boards.ts`:

```ts
import { and, asc, eq, gt, lte } from 'drizzle-orm'
import type { KeyHashes } from '../keys'
import type { Db } from './client'
import { boardUpdates, boards } from './schema'

export interface BoardRecord {
  id: string
  editKeyHash: Buffer
  viewKeyHash: Buffer
}

export interface LoadedBoard {
  snapshot: Buffer | null
  snapshotSeq: number
  updates: { seq: number; update: Buffer }[]
}

export async function createBoard(
  db: Db,
  id: string,
  hashes: KeyHashes,
): Promise<'created' | 'exists'> {
  const rows = await db
    .insert(boards)
    .values({
      id,
      editKeyHash: Buffer.from(hashes.editKeyHash),
      viewKeyHash: Buffer.from(hashes.viewKeyHash),
    })
    .onConflictDoNothing()
    .returning({ id: boards.id })
  return rows.length > 0 ? 'created' : 'exists'
}

export async function findBoard(
  db: Db,
  id: string,
): Promise<BoardRecord | undefined> {
  const [row] = await db
    .select({
      id: boards.id,
      editKeyHash: boards.editKeyHash,
      viewKeyHash: boards.viewKeyHash,
    })
    .from(boards)
    .where(eq(boards.id, id))
  return row
}

/** Durability before relay: returns the sequence number once written. */
export async function appendUpdate(
  db: Db,
  boardId: string,
  update: Uint8Array,
): Promise<number> {
  const [row] = await db
    .insert(boardUpdates)
    .values({ boardId, update: Buffer.from(update) })
    .returning({ seq: boardUpdates.seq })
  if (!row) {
    throw new Error('insert returned no row')
  }
  return row.seq
}

export async function loadBoard(
  db: Db,
  id: string,
): Promise<LoadedBoard | undefined> {
  const [board] = await db
    .select({ snapshot: boards.snapshot, snapshotSeq: boards.snapshotSeq })
    .from(boards)
    .where(eq(boards.id, id))
  if (!board) {
    return undefined
  }
  const updates = await db
    .select({ seq: boardUpdates.seq, update: boardUpdates.update })
    .from(boardUpdates)
    .where(
      and(eq(boardUpdates.boardId, id), gt(boardUpdates.seq, board.snapshotSeq)),
    )
    .orderBy(asc(boardUpdates.seq))
  return { snapshot: board.snapshot, snapshotSeq: board.snapshotSeq, updates }
}

/** Replaces the snapshot and drops every update it covers, atomically. */
export async function compactBoard(
  db: Db,
  boardId: string,
  snapshot: Uint8Array,
  upToSeq: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(boards)
      .set({
        snapshot: Buffer.from(snapshot),
        snapshotSeq: upToSeq,
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId))
    await tx
      .delete(boardUpdates)
      .where(
        and(eq(boardUpdates.boardId, boardId), lte(boardUpdates.seq, upToSeq)),
      )
  })
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/boards-db.test.ts`

Expected: PASS, 4 tests. If the connection is refused, run `docker compose up -d postgres` and retry.

- [ ] **Step 7: Typecheck and Biome**

Run: `pnpm --filter @tlwb/collab-server typecheck && pnpm check`

Expected: both pass. Biome may flag the generated `src/migrations/meta/*.json` formatting: add `"apps/collab-server/src/migrations/**"` to a `files.includes` exclusion in `biome.json` as `"!apps/collab-server/src/migrations/**"` only if it does, and keep the change minimal.

- [ ] **Step 8: Commit**

```bash
git add apps/collab-server/drizzle.config.ts apps/collab-server/src/db apps/collab-server/src/migrations apps/collab-server/test/boards-db.test.ts biome.json
git commit -m "✨ feat(collab-server): persist boards as a snapshot plus residual updates"
```

---

### Task 5: Board creation over HTTP with rate limiting

**Files:**
- Create: `apps/collab-server/src/rate-limit.ts`
- Create: `apps/collab-server/src/http.ts`
- Test: `apps/collab-server/test/rate-limit.test.ts`
- Test: `apps/collab-server/test/http-boards.test.ts`

**Interfaces:**
- Consumes: `createBoard`, `Db` (Task 4); `generateKey`, `hashKey` (Task 3); `Config` (Task 2).
- Produces: `createTokenBucket(capacity: number, refillMs: number, now?: () => number): { take(): boolean }`; `createApp(deps: { db: Db; config: Config; now?: () => number }): Hono`.

- [ ] **Step 1: Write the failing rate-limit test**

`apps/collab-server/test/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createTokenBucket } from '../src/rate-limit'

describe('createTokenBucket', () => {
  it('allows the burst, refuses when empty, refills over time', () => {
    let clock = 0
    const bucket = createTokenBucket(3, 3_000, () => clock)
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
    ])
    expect(bucket.take()).toBe(false)
    clock = 1_000
    expect(bucket.take()).toBe(true)
    expect(bucket.take()).toBe(false)
    clock = 10_000
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual(
      [true, true, true, false],
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/rate-limit.test.ts`

Expected: FAIL, cannot resolve `../src/rate-limit`.

- [ ] **Step 3: Write the token bucket**

`apps/collab-server/src/rate-limit.ts`:

```ts
export interface TokenBucket {
  /** True when a token was available and consumed. */
  take(): boolean
}

/** `capacity` tokens, refilled continuously over `refillMs`. */
export function createTokenBucket(
  capacity: number,
  refillMs: number,
  now: () => number = Date.now,
): TokenBucket {
  let tokens = capacity
  let last = now()
  return {
    take() {
      const current = now()
      tokens = Math.min(capacity, tokens + ((current - last) * capacity) / refillMs)
      last = current
      if (tokens < 1) {
        return false
      }
      tokens -= 1
      return true
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/rate-limit.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Write the failing HTTP test**

`apps/collab-server/test/http-boards.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { connectDatabase } from '../src/db/client'
import { findBoard } from '../src/db/boards'
import { createApp } from '../src/http'
import { hashKey } from '../src/keys'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function app(overrides: Record<string, string> = {}, now?: () => number) {
  return createApp({
    db: database.db,
    config: loadConfig({ DATABASE_URL: url, CORS_ORIGIN: 'http://a', ...overrides }),
    now,
  })
}

function post(body: unknown, ip = '10.0.0.1') {
  return new Request('http://server/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

describe('POST /boards', () => {
  it('creates a board and returns two distinct keys stored hashed', async () => {
    const boardId = randomUUID()
    const response = await app().request(post({ boardId }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.boardId).toBe(boardId)
    expect(body.editKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.viewKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.editKey).not.toBe(body.viewKey)
    const stored = await findBoard(database.db, boardId)
    expect(stored?.editKeyHash.equals(hashKey(body.editKey))).toBe(true)
    expect(stored?.viewKeyHash.equals(hashKey(body.viewKey))).toBe(true)
  })

  it('answers 409 without keys on an existing board', async () => {
    const boardId = randomUUID()
    await app().request(post({ boardId }))
    const response = await app().request(post({ boardId }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'board already exists' })
  })

  it('answers 400 on a malformed identifier or body', async () => {
    expect((await app().request(post({ boardId: 'short' }))).status).toBe(400)
    expect((await app().request(post({ boardId: 'has space in it' }))).status).toBe(
      400,
    )
    expect((await app().request(post({}))).status).toBe(400)
    const notJson = new Request('http://server/boards', {
      method: 'POST',
      body: 'nope',
    })
    expect((await app().request(notJson)).status).toBe(400)
  })

  it('rate limits creations per IP', async () => {
    const limited = app({ CREATE_LIMIT_PER_MIN: '2' }, () => 0)
    expect((await limited.request(post({ boardId: randomUUID() }, '1.1.1.1'))).status).toBe(201)
    expect((await limited.request(post({ boardId: randomUUID() }, '1.1.1.1'))).status).toBe(201)
    expect((await limited.request(post({ boardId: randomUUID() }, '1.1.1.1'))).status).toBe(429)
    expect((await limited.request(post({ boardId: randomUUID() }, '2.2.2.2'))).status).toBe(201)
  })

  it('serves health and CORS headers', async () => {
    const health = await app().request('http://server/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true })
    const preflight = await app().request('http://server/boards', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://a',
        'access-control-request-method': 'POST',
      },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://a')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/http-boards.test.ts`

Expected: FAIL, cannot resolve `../src/http`.

- [ ] **Step 7: Write the Hono application**

`apps/collab-server/src/http.ts`:

```ts
import type { HttpBindings } from '@hono/node-server'
import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Config } from './config'
import { createBoard } from './db/boards'
import type { Db } from './db/client'
import { generateKey, hashKey } from './keys'
import { createTokenBucket, type TokenBucket } from './rate-limit'

export interface HttpDeps {
  db: Db
  config: Config
  now?: () => number
}

const BOARD_ID = /^[A-Za-z0-9_-]{8,64}$/

type Env = { Bindings: HttpBindings }

/**
 * The reverse proxy sets X-Forwarded-For; without one, the socket
 * address is the client. Trusting the header is the deployment's
 * choice: the container is meant to sit behind a proxy.
 */
function clientIp(c: Context<Env>): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  // `env` is undefined when the app is driven by `app.request()` in tests.
  return forwarded || c.env?.incoming?.socket?.remoteAddress || 'unknown'
}

export function createApp(deps: HttpDeps): Hono<Env> {
  const { db, config } = deps
  const now = deps.now ?? Date.now
  const app = new Hono<Env>()
  const creationBuckets = new Map<string, TokenBucket>()

  app.use('/boards', cors({ origin: config.corsOrigin }))
  app.use('/boards/*', cors({ origin: config.corsOrigin }))

  app.get('/health', (c) => c.json({ ok: true }))

  app.post('/boards', async (c) => {
    // ponytail: unbounded map of buckets; reset wholesale past 10k IPs.
    // Per-entry expiry when memory shows up in a profile.
    if (creationBuckets.size > 10_000) {
      creationBuckets.clear()
    }
    const ip = clientIp(c)
    let bucket = creationBuckets.get(ip)
    if (!bucket) {
      bucket = createTokenBucket(config.createLimitPerMin, 60_000, now)
      creationBuckets.set(ip, bucket)
    }
    if (!bucket.take()) {
      return c.json({ error: 'too many boards created' }, 429)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'body must be JSON' }, 400)
    }
    const boardId =
      typeof body === 'object' && body !== null && 'boardId' in body
        ? body.boardId
        : undefined
    if (typeof boardId !== 'string' || !BOARD_ID.test(boardId)) {
      return c.json({ error: 'boardId must match ^[A-Za-z0-9_-]{8,64}$' }, 400)
    }

    const editKey = generateKey()
    const viewKey = generateKey()
    const outcome = await createBoard(db, boardId, {
      editKeyHash: hashKey(editKey),
      viewKeyHash: hashKey(viewKey),
    })
    if (outcome === 'exists') {
      return c.json({ error: 'board already exists' }, 409)
    }
    return c.json({ boardId, editKey, viewKey }, 201)
  })

  return app
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/http-boards.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 9: Typecheck and Biome**

Run: `pnpm --filter @tlwb/collab-server typecheck && pnpm check`

Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add apps/collab-server/src/rate-limit.ts apps/collab-server/src/http.ts apps/collab-server/test/rate-limit.test.ts apps/collab-server/test/http-boards.test.ts
git commit -m "✨ feat(collab-server): create hosted boards over HTTP with per-IP rate limiting"
```

---

### Task 6: Protocol encoding and the room with staging validation

**Files:**
- Create: `apps/collab-server/src/protocol.ts`
- Create: `apps/collab-server/src/room.ts`
- Test: `apps/collab-server/test/protocol.test.ts`
- Test: `apps/collab-server/test/room.test.ts`

**Interfaces:**
- Consumes: `validateElement` from `@tlwb/engine` (Task 1); `Role` (Task 3).
- Produces from `protocol.ts`: `CLOSE` code table; `encodeSyncStep1(doc)`, `encodeSyncStep2(doc, stateVector?)`, `encodeUpdate(update)`, `encodeAwareness(awareness, clients)`, `decodeMessage(data): DecodedMessage`, `awarenessClientIds(update): number[]`.
- Produces from `room.ts`: `RoomConnection { role: Role; send(data: Uint8Array): void; close(code: number, reason: string): void }`; `RoomOptions { maxMessageBytes; maxDocBytes; maxAwarenessBytes; persist(update: Uint8Array): Promise<void> }`; `Room { doc; join(connection); leave(connection); handleMessage(connection, data): Promise<void>; connectionCount(): number; closeAll(code, reason): void; destroy(): void }`; `createRoom(doc: Y.Doc, options: RoomOptions): Room`.

- [ ] **Step 1: Write the failing protocol test**

`apps/collab-server/test/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  awarenessClientIds,
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
} from '../src/protocol'

describe('protocol', () => {
  it('round-trips a sync step 1 and answers it with a step 2', () => {
    const server = new Y.Doc()
    server.getMap('elements').set('a', 1)
    const client = new Y.Doc()

    const step1 = decodeMessage(encodeSyncStep1(client))
    expect(step1.kind).toBe('sync-step1')
    if (step1.kind !== 'sync-step1') {
      throw new Error('unreachable')
    }
    const step2 = decodeMessage(encodeSyncStep2(server, step1.stateVector))
    expect(step2.kind).toBe('sync-update')
    if (step2.kind !== 'sync-update') {
      throw new Error('unreachable')
    }
    Y.applyUpdate(client, step2.update)
    expect(client.getMap('elements').get('a')).toBe(1)
    server.destroy()
    client.destroy()
  })

  it('round-trips an update message', () => {
    const doc = new Y.Doc()
    doc.getMap('elements').set('a', 1)
    const message = decodeMessage(encodeUpdate(Y.encodeStateAsUpdate(doc)))
    expect(message.kind).toBe('sync-update')
    doc.destroy()
  })

  it('round-trips awareness and lists its client ids', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    awareness.setLocalState({ name: 'Ada' })
    const message = decodeMessage(encodeAwareness(awareness, [doc.clientID]))
    expect(message.kind).toBe('awareness')
    if (message.kind !== 'awareness') {
      throw new Error('unreachable')
    }
    expect(awarenessClientIds(message.update)).toEqual([doc.clientID])
    awareness.destroy()
    doc.destroy()
  })

  it('reports garbage and unknown types as unknown', () => {
    expect(decodeMessage(new Uint8Array([9, 9, 9])).kind).toBe('unknown')
    expect(decodeMessage(new Uint8Array([])).kind).toBe('unknown')
    expect(decodeMessage(new Uint8Array([3])).kind).toBe('query-awareness')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/protocol.test.ts`

Expected: FAIL, cannot resolve `../src/protocol`.

- [ ] **Step 3: Write the protocol module**

`apps/collab-server/src/protocol.ts`:

```ts
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import {
  type Awareness,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import type * as Y from 'yjs'

// Outer message types of the y-websocket wire format.
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3

/** WebSocket close codes the server uses; 4xxx are application codes. */
export const CLOSE = {
  shuttingDown: 1001,
  storage: 1011,
  unauthorized: 4401,
  readOnly: 4403,
  unknownBoard: 4404,
  tooLarge: 4409,
  invalid: 4422,
  rateLimited: 4429,
} as const

export type DecodedMessage =
  | { kind: 'sync-step1'; stateVector: Uint8Array }
  | { kind: 'sync-update'; update: Uint8Array }
  | { kind: 'awareness'; update: Uint8Array }
  | { kind: 'query-awareness' }
  | { kind: 'unknown' }

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

export function encodeSyncStep2(
  doc: Y.Doc,
  stateVector?: Uint8Array,
): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep2(encoder, doc, stateVector)
  return encoding.toUint8Array(encoder)
}

export function encodeUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

export function encodeAwareness(
  awareness: Awareness,
  clients: number[],
): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, clients))
  return encoding.toUint8Array(encoder)
}

/** Never throws: anything unreadable is `unknown` and gets ignored. */
export function decodeMessage(data: Uint8Array): DecodedMessage {
  try {
    const decoder = decoding.createDecoder(data)
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        const type = decoding.readVarUint(decoder)
        const payload = decoding.readVarUint8Array(decoder)
        if (type === syncProtocol.messageYjsSyncStep1) {
          return { kind: 'sync-step1', stateVector: payload }
        }
        if (
          type === syncProtocol.messageYjsSyncStep2 ||
          type === syncProtocol.messageYjsUpdate
        ) {
          return { kind: 'sync-update', update: payload }
        }
        return { kind: 'unknown' }
      }
      case MESSAGE_AWARENESS:
        return { kind: 'awareness', update: decoding.readVarUint8Array(decoder) }
      case MESSAGE_QUERY_AWARENESS:
        return { kind: 'query-awareness' }
      default:
        return { kind: 'unknown' }
    }
  } catch {
    return { kind: 'unknown' }
  }
}

/** The client ids an awareness update carries, to clean up on close. */
export function awarenessClientIds(update: Uint8Array): number[] {
  const decoder = decoding.createDecoder(update)
  const count = decoding.readVarUint(decoder)
  const ids: number[] = []
  for (let i = 0; i < count; i += 1) {
    ids.push(decoding.readVarUint(decoder))
    decoding.readVarUint(decoder) // clock
    decoding.readVarString(decoder) // state
  }
  return ids
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/protocol.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing room test**

`apps/collab-server/test/room.test.ts`:

```ts
import { createElement } from '@tlwb/engine'
import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  CLOSE,
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
} from '../src/protocol'
import { createRoom, type RoomConnection } from '../src/room'

interface FakeConnection extends RoomConnection {
  received: Uint8Array[]
  closed: { code: number; reason: string } | null
}

function connection(role: 'edit' | 'view'): FakeConnection {
  const fake: FakeConnection = {
    role,
    received: [],
    closed: null,
    send: (data) => fake.received.push(data),
    close: (code, reason) => {
      fake.closed = { code, reason }
    },
  }
  return fake
}

/** What a throwaway client document sends after `mutate`. */
function clientUpdate(mutate: (elements: Y.Map<unknown>) => void): Uint8Array {
  const doc = new Y.Doc()
  const before = Y.encodeStateVector(doc)
  doc.transact(() => mutate(doc.getMap('elements')))
  const update = Y.encodeStateAsUpdate(doc, before)
  doc.destroy()
  return update
}

/** A fresh empty document, destroyed right away: only its bytes matter. */
function emptyDoc(): Y.Doc {
  const doc = new Y.Doc()
  doc.destroy()
  return doc
}

function elementMap(overrides: Record<string, unknown> = {}): Y.Map<unknown> {
  const element = createElement('rectangle', { index: 'a0', id: 'r1' })
  return new Y.Map(Object.entries({ ...element, ...overrides }))
}

function setup(overrides: Partial<Parameters<typeof createRoom>[1]> = {}) {
  const persisted: Uint8Array[] = []
  const doc = new Y.Doc()
  const room = createRoom(doc, {
    maxMessageBytes: 1_000_000,
    maxDocBytes: 1_000_000,
    maxAwarenessBytes: 16_384,
    persist: async (update) => {
      persisted.push(update)
    },
    ...overrides,
  })
  return { doc, room, persisted }
}

describe('createRoom', () => {
  it('answers a sync step 1 with the room state and relays a valid update', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    const bob = connection('edit')
    room.join(alice)
    room.join(bob)
    // Joining sends a step 1 so the client answers with its state.
    expect(decodeMessage(alice.received[0] as Uint8Array).kind).toBe('sync-step1')

    await room.handleMessage(
      alice,
      encodeUpdate(clientUpdate((elements) => elements.set('r1', elementMap()))),
    )
    expect(persisted).toHaveLength(1)
    expect(doc.getMap('elements').has('r1')).toBe(true)
    const relayed = bob.received.filter(
      (data) => decodeMessage(data).kind === 'sync-update',
    )
    expect(relayed).toHaveLength(1)
    expect(alice.received.filter((data) => decodeMessage(data).kind === 'sync-update')).toHaveLength(0)

    const late = connection('view')
    room.join(late)
    await room.handleMessage(late, encodeSyncStep1(emptyDoc()))
    const step2 = late.received.map(decodeMessage).find((m) => m.kind === 'sync-update')
    expect(step2).toBeDefined()
    room.destroy()
  })

  it('rejects a malformed element without relaying or persisting, then accepts the next valid one', async () => {
    const { room, persisted, doc } = setup()
    const alice = connection('edit')
    const bob = connection('edit')
    const carol = connection('edit')
    room.join(alice)
    room.join(bob)
    room.join(carol)

    await room.handleMessage(
      alice,
      encodeUpdate(clientUpdate((elements) => elements.set('r1', elementMap({ x: 'oops' })))),
    )
    expect(alice.closed).toEqual({ code: CLOSE.invalid, reason: 'element r1' })
    expect(persisted).toHaveLength(0)
    expect(doc.getMap('elements').has('r1')).toBe(false)
    expect(bob.received.filter((d) => decodeMessage(d).kind === 'sync-update')).toHaveLength(0)
    room.leave(alice)

    await room.handleMessage(
      carol,
      encodeUpdate(clientUpdate((elements) => elements.set('r2', elementMap({ id: 'r2' })))),
    )
    expect(persisted).toHaveLength(1)
    expect(doc.getMap('elements').has('r2')).toBe(true)
    expect(bob.received.filter((d) => decodeMessage(d).kind === 'sync-update')).toHaveLength(1)
    room.destroy()
  })

  it('rejects a value that is not an element map, a bad meta, and an unparsable update', async () => {
    const { room, persisted } = setup()
    const alice = connection('edit')
    room.join(alice)
    await room.handleMessage(
      alice,
      encodeUpdate(clientUpdate((elements) => elements.set('junk', 'not a map'))),
    )
    expect(alice.closed?.code).toBe(CLOSE.invalid)

    const bob = connection('edit')
    room.join(bob)
    const badMeta = new Y.Doc()
    badMeta.getMap('meta').set('name', 42)
    await room.handleMessage(bob, encodeUpdate(Y.encodeStateAsUpdate(badMeta)))
    badMeta.destroy()
    expect(bob.closed).toEqual({ code: CLOSE.invalid, reason: 'meta.name' })

    const carol = connection('edit')
    room.join(carol)
    await room.handleMessage(carol, encodeUpdate(new Uint8Array([255, 1, 2, 3])))
    expect(carol.closed?.code).toBe(CLOSE.invalid)
    expect(persisted).toHaveLength(0)
    room.destroy()
  })

  it('closes a read-only connection that sends a change, and accepts its empty step 2', async () => {
    const { room, persisted } = setup()
    const viewer = connection('view')
    room.join(viewer)
    // An empty client answering the server's step 1 sends a step 2 with
    // nothing in it: not a write.
    await room.handleMessage(viewer, encodeUpdate(Y.encodeStateAsUpdate(emptyDoc())))
    expect(viewer.closed).toBeNull()

    await room.handleMessage(
      viewer,
      encodeUpdate(clientUpdate((elements) => elements.set('r1', elementMap()))),
    )
    expect(viewer.closed).toEqual({ code: CLOSE.readOnly, reason: 'read-only link' })
    expect(persisted).toHaveLength(0)
    room.destroy()
  })

  it('enforces the message and document size limits', async () => {
    const { room } = setup({ maxMessageBytes: 16, maxDocBytes: 200 })
    const alice = connection('edit')
    room.join(alice)
    await room.handleMessage(alice, new Uint8Array(17))
    expect(alice.closed).toEqual({ code: CLOSE.tooLarge, reason: 'message too large' })

    const { room: small } = setup({ maxDocBytes: 200 })
    const bob = connection('edit')
    small.join(bob)
    await small.handleMessage(
      bob,
      encodeUpdate(clientUpdate((elements) => {
        for (let i = 0; i < 20; i += 1) {
          elements.set(`r${i}`, elementMap({ id: `r${i}` }))
        }
      })),
    )
    expect(bob.closed).toEqual({ code: CLOSE.tooLarge, reason: 'document too large' })
    room.destroy()
    small.destroy()
  })

  it('closes with a storage code when persistence fails and keeps the document clean', async () => {
    const { room, doc } = setup({
      persist: async () => {
        throw new Error('down')
      },
    })
    const alice = connection('edit')
    room.join(alice)
    await room.handleMessage(
      alice,
      encodeUpdate(clientUpdate((elements) => elements.set('r1', elementMap()))),
    )
    expect(alice.closed).toEqual({ code: CLOSE.storage, reason: 'storage failure' })
    expect(doc.getMap('elements').has('r1')).toBe(false)
    room.destroy()
  })

  it('relays awareness to everyone and removes a peer on leave', async () => {
    const { room } = setup()
    const alice = connection('edit')
    const bob = connection('view')
    room.join(alice)
    room.join(bob)
    const client = new Y.Doc()
    const awareness = new Awareness(client)
    awareness.setLocalState({ name: 'Ada' })
    await room.handleMessage(alice, encodeAwareness(awareness, [client.clientID]))
    expect(bob.received.filter((d) => decodeMessage(d).kind === 'awareness')).toHaveLength(1)

    const before = bob.received.length
    room.leave(alice)
    expect(bob.received.length).toBe(before + 1)
    expect(decodeMessage(bob.received[before] as Uint8Array).kind).toBe('awareness')
    expect(room.connectionCount()).toBe(1)
    awareness.destroy()
    client.destroy()
    room.destroy()
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/room.test.ts`

Expected: FAIL, cannot resolve `../src/room`.

- [ ] **Step 7: Write the room**

`apps/collab-server/src/room.ts`:

```ts
import { validateElement } from '@tlwb/engine'
import {
  Awareness,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { Role } from './keys'
import {
  awarenessClientIds,
  CLOSE,
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
} from './protocol'

export interface RoomConnection {
  role: Role
  send(data: Uint8Array): void
  close(code: number, reason: string): void
}

export interface RoomOptions {
  maxMessageBytes: number
  maxDocBytes: number
  maxAwarenessBytes: number
  /** Resolves once the update is durable; rejects on a storage failure. */
  persist(update: Uint8Array): Promise<void>
}

export interface Room {
  readonly doc: Y.Doc
  join(connection: RoomConnection): void
  leave(connection: RoomConnection): void
  handleMessage(connection: RoomConnection, data: Uint8Array): Promise<void>
  connectionCount(): number
  closeAll(code: number, reason: string): void
  destroy(): void
}

function metaProblem(meta: Y.Map<unknown>): string | null {
  const name = meta.get('name')
  if (name !== undefined && typeof name !== 'string') {
    return 'meta.name'
  }
  const createdAt = meta.get('createdAt')
  if (createdAt !== undefined && !Number.isFinite(createdAt)) {
    return 'meta.createdAt'
  }
  return null
}

/**
 * One board in memory. Every incoming update lands on a staging
 * document first; only a validated update reaches the room document,
 * whose own `update` event relays it. Messages are processed one at a
 * time per room so staging always equals the room document plus the
 * update under examination.
 */
export function createRoom(doc: Y.Doc, options: RoomOptions): Room {
  const connections = new Set<RoomConnection>()
  const awarenessIds = new Map<RoomConnection, Set<number>>()
  const awareness = new Awareness(doc)
  awareness.setLocalState(null)
  let staging = new Y.Doc()
  Y.applyUpdate(staging, Y.encodeStateAsUpdate(doc))
  let queue: Promise<void> = Promise.resolve()

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const message = encodeUpdate(update)
    for (const connection of connections) {
      if (connection !== origin) {
        connection.send(message)
      }
    }
  })

  awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const message = encodeAwareness(awareness, [...added, ...updated, ...removed])
      for (const connection of connections) {
        connection.send(message)
      }
    },
  )

  function rebuildStaging(): void {
    staging.destroy()
    staging = new Y.Doc()
    Y.applyUpdate(staging, Y.encodeStateAsUpdate(doc))
  }

  function reject(connection: RoomConnection, code: number, reason: string): void {
    rebuildStaging()
    connection.close(code, reason)
  }

  /** Null when every touched element and the meta are well-formed. */
  function findProblem(touched: Set<string>): string | null {
    const elements = staging.getMap('elements')
    for (const id of touched) {
      const raw = elements.get(id)
      if (raw === undefined) {
        continue // deleted
      }
      if (!(raw instanceof Y.Map) || !validateElement(raw.toJSON())) {
        return `element ${id}`
      }
    }
    return metaProblem(staging.getMap('meta'))
  }

  async function processUpdate(connection: RoomConnection, update: Uint8Array): Promise<void> {
    const elements = staging.getMap('elements')
    const touched = new Set<string>()
    let changed = false
    const onElements = (events: Y.YEvent<Y.Map<unknown>>[]) => {
      for (const event of events) {
        if (event.target === elements) {
          for (const key of event.keysChanged) {
            touched.add(key)
          }
        } else {
          touched.add(String(event.path[0]))
        }
      }
    }
    const onUpdate = () => {
      changed = true
    }
    elements.observeDeep(onElements)
    staging.on('update', onUpdate)
    let applied = true
    try {
      Y.applyUpdate(staging, update)
    } catch {
      applied = false
    } finally {
      elements.unobserveDeep(onElements)
      staging.off('update', onUpdate)
    }
    if (!applied) {
      reject(connection, CLOSE.invalid, 'malformed update')
      return
    }
    if (!changed) {
      return // nothing new: an empty step 2 or a replay
    }
    if (connection.role === 'view') {
      reject(connection, CLOSE.readOnly, 'read-only link')
      return
    }
    const problem = findProblem(touched)
    if (problem) {
      reject(connection, CLOSE.invalid, problem)
      return
    }
    if (Y.encodeStateAsUpdate(staging).byteLength > options.maxDocBytes) {
      reject(connection, CLOSE.tooLarge, 'document too large')
      return
    }
    try {
      await options.persist(update)
    } catch {
      reject(connection, CLOSE.storage, 'storage failure')
      return
    }
    Y.applyUpdate(doc, update, connection)
  }

  async function process(connection: RoomConnection, data: Uint8Array): Promise<void> {
    if (!connections.has(connection)) {
      return
    }
    if (data.byteLength > options.maxMessageBytes) {
      connection.close(CLOSE.tooLarge, 'message too large')
      return
    }
    const message = decodeMessage(data)
    switch (message.kind) {
      case 'sync-step1':
        connection.send(encodeSyncStep2(doc, message.stateVector))
        return
      case 'sync-update':
        await processUpdate(connection, message.update)
        return
      case 'awareness': {
        if (data.byteLength > options.maxAwarenessBytes) {
          connection.close(CLOSE.tooLarge, 'awareness too large')
          return
        }
        let ids: number[]
        try {
          ids = awarenessClientIds(message.update)
        } catch {
          return
        }
        const owned = awarenessIds.get(connection) ?? new Set<number>()
        for (const id of ids) {
          owned.add(id)
        }
        awarenessIds.set(connection, owned)
        applyAwarenessUpdate(awareness, message.update, connection)
        return
      }
      case 'query-awareness':
        connection.send(encodeAwareness(awareness, [...awareness.getStates().keys()]))
        return
      case 'unknown':
        return
    }
  }

  function leave(connection: RoomConnection): void {
    connections.delete(connection)
    const owned = awarenessIds.get(connection)
    awarenessIds.delete(connection)
    if (owned && owned.size > 0) {
      removeAwarenessStates(awareness, [...owned], null)
    }
  }

  return {
    doc,
    join(connection) {
      connections.add(connection)
      connection.send(encodeSyncStep1(doc))
      const states = [...awareness.getStates().keys()]
      if (states.length > 0) {
        connection.send(encodeAwareness(awareness, states))
      }
    },
    leave,
    handleMessage(connection, data) {
      // ponytail: one queue per room serializes every message; per-board
      // throughput is bounded by persistence latency. Batch inserts if
      // it shows.
      queue = queue.then(() => process(connection, data))
      return queue
    },
    connectionCount: () => connections.size,
    closeAll(code, reason) {
      for (const connection of [...connections]) {
        connection.close(code, reason)
        leave(connection)
      }
    },
    destroy() {
      awareness.destroy()
      staging.destroy()
      connections.clear()
      awarenessIds.clear()
    },
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/room.test.ts`

Expected: PASS, 7 tests. If the "not an element map" case does not close the connection, check that `findProblem` runs `raw instanceof Y.Map` on the staging map (a plain string value is `'not a map'`). If Yjs swallows `[255, 1, 2, 3]` without throwing and without changing anything, the "unparsable" assertion sees no close: replace the bytes with `new Uint8Array([1, 0, 200])` (one struct announced, none readable), which `Y.applyUpdate` rejects.

- [ ] **Step 9: Typecheck and Biome**

Run: `pnpm --filter @tlwb/collab-server typecheck && pnpm check`

Expected: both pass. Long lines in the test files are reformatted by `pnpm check:write`; re-run `pnpm check` afterwards.

- [ ] **Step 10: Commit**

```bash
git add apps/collab-server/src/protocol.ts apps/collab-server/src/room.ts apps/collab-server/test/protocol.test.ts apps/collab-server/test/room.test.ts
git commit -m "✨ feat(collab-server): relay validated updates and awareness through a room"
```

---

### Task 7: Room registry, WebSocket wiring, server, end to end

**Files:**
- Create: `apps/collab-server/src/rooms.ts`
- Create: `apps/collab-server/src/ws.ts`
- Create: `apps/collab-server/src/server.ts`
- Create: `apps/collab-server/src/main.ts`
- Test: `apps/collab-server/test/e2e.test.ts`

**Interfaces:**
- Consumes: `createRoom`, `Room`, `RoomConnection` (Task 6); `loadBoard`, `appendUpdate`, `compactBoard`, `findBoard`, `Db` (Task 4); `resolveRole` (Task 3); `createApp` (Task 5); `createTokenBucket` (Task 5); `Config`, `loadConfig` (Task 2); `log` (Task 2).
- Produces from `rooms.ts`: `RoomRegistry { acquire(boardId): Promise<Room | undefined>; release(boardId): void; shutdown(): Promise<void> }`; `createRooms(deps: { db: Db; config: Config }): RoomRegistry`.
- Produces from `ws.ts`: `attachWebSocket(server: HttpServer, deps: { db: Db; config: Config; rooms: RoomRegistry }): WebSocketServer`.
- Produces from `server.ts`: `startServer(config: Config): Promise<{ port: number; close(): Promise<void> }>`.

- [ ] **Step 1: Write the failing end-to-end test**

`apps/collab-server/test/e2e.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { createElement } from '@tlwb/engine'
import { connectBoard, createYjsBoardStore } from '@tlwb/store-yjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { loadConfig } from '../src/config'
import { CLOSE, decodeMessage, encodeSyncStep1, encodeUpdate } from '../src/protocol'
import { startServer } from '../src/server'

let server: Awaited<ReturnType<typeof startServer>>
let base: string

beforeAll(async () => {
  server = await startServer(
    loadConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      CORS_ORIGIN: 'http://a',
      PORT: '0',
      ROOM_IDLE_MS: '50',
      COMPACT_AFTER_UPDATES: '2',
    }),
  )
  base = `localhost:${server.port}`
})

afterAll(async () => {
  await server.close()
})

async function createBoard() {
  const boardId = randomUUID()
  const response = await fetch(`http://${base}/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId }),
  })
  expect(response.status).toBe(201)
  const keys = (await response.json()) as { editKey: string; viewKey: string }
  return { boardId, ...keys }
}

function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (check()) {
        resolve()
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out'))
      } else {
        setTimeout(tick, 20)
      }
    }
    tick()
  })
}

/** A bare socket speaking the wire format, for close-code assertions. */
function rawClient(boardId: string, token: string) {
  const socket = new WebSocket(`ws://${base}/ws/${boardId}?token=${token}`)
  socket.binaryType = 'arraybuffer'
  const received: Uint8Array[] = []
  let closeCode: number | null = null
  socket.addEventListener('message', (event) => {
    received.push(new Uint8Array(event.data as ArrayBuffer))
  })
  socket.addEventListener('close', (event) => {
    closeCode = event.code
  })
  const open = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('socket error')))
  })
  return {
    socket,
    received,
    open,
    closeCode: () => closeCode,
    send: (data: Uint8Array) => socket.send(data),
    close: () => socket.close(),
  }
}

/** An update creating one rectangle under its own id (default `r1`). */
function elementUpdate(overrides: Record<string, unknown> = {}): Uint8Array {
  const doc = new Y.Doc()
  const element = createElement('rectangle', { index: 'a0', id: 'r1' })
  const merged = { ...element, ...overrides }
  doc.getMap('elements').set(String(merged.id), new Y.Map(Object.entries(merged)))
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

/**
 * Asks the server for its state until every id is there. Re-sending
 * step 1 on each poll makes the check independent of how fast a
 * previous write landed.
 */
async function waitForElements(
  client: ReturnType<typeof rawClient>,
  ids: string[],
): Promise<void> {
  const doc = new Y.Doc()
  let seen = 0
  try {
    await waitFor(() => {
      for (const data of client.received.slice(seen)) {
        const message = decodeMessage(data)
        if (message.kind === 'sync-update') {
          Y.applyUpdate(doc, message.update)
        }
      }
      seen = client.received.length
      if (ids.every((id) => doc.getMap('elements').has(id))) {
        return true
      }
      const probe = new Y.Doc()
      client.send(encodeSyncStep1(probe))
      probe.destroy()
      return false
    })
  } finally {
    doc.destroy()
  }
}

describe('collaboration server', () => {
  it('converges two editors through connectBoard', async () => {
    const { boardId, editKey } = await createBoard()
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const storeA = createYjsBoardStore(docA)
    const storeB = createYjsBoardStore(docB)
    const a = connectBoard(docA, { url: `ws://${base}/ws`, boardId, token: editKey })
    const b = connectBoard(docB, { url: `ws://${base}/ws`, boardId, token: editKey })
    await waitFor(() => a.getStatus() === 'connected' && b.getStatus() === 'connected')

    storeA.applyChanges([
      { kind: 'create', element: createElement('ellipse', { index: 'a0', id: 'e1', x: 5 }) },
    ])
    await waitFor(() => storeB.getElement('e1')?.x === 5)
    storeB.applyChanges([{ kind: 'update', id: 'e1', props: { x: 9 } }])
    await waitFor(() => storeA.getElement('e1')?.x === 9)

    a.destroy()
    b.destroy()
    a.awareness.destroy()
    b.awareness.destroy()
    docA.destroy()
    docB.destroy()
  })

  it('closes a read-only client that writes, after it received the state', async () => {
    const { boardId, editKey, viewKey } = await createBoard()
    const editor = rawClient(boardId, editKey)
    await editor.open
    editor.send(encodeUpdate(elementUpdate()))

    const viewer = rawClient(boardId, viewKey)
    await viewer.open
    await waitForElements(viewer, ['r1'])
    viewer.send(encodeUpdate(elementUpdate({ id: 'r2' })))
    await waitFor(() => viewer.closeCode() === CLOSE.readOnly)
    editor.close()
  })

  it('closes a client sending a malformed element and never relays it', async () => {
    const { boardId, editKey } = await createBoard()
    const bad = rawClient(boardId, editKey)
    const good = rawClient(boardId, editKey)
    await Promise.all([bad.open, good.open])
    const before = good.received.length
    bad.send(encodeUpdate(elementUpdate({ x: 'oops' })))
    await waitFor(() => bad.closeCode() === CLOSE.invalid)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(
      good.received.slice(before).filter((d) => decodeMessage(d).kind === 'sync-update'),
    ).toHaveLength(0)
    good.close()
  })

  it('rejects an unknown board and a wrong token with close codes', async () => {
    const { boardId } = await createBoard()
    const unknown = rawClient(randomUUID(), 'whatever')
    await unknown.open
    await waitFor(() => unknown.closeCode() === CLOSE.unknownBoard)
    const wrong = rawClient(boardId, 'not-a-key')
    await wrong.open
    await waitFor(() => wrong.closeCode() === CLOSE.unauthorized)
  })

  it('compacts, evicts the idle room, and reloads the persisted state', async () => {
    const { boardId, editKey } = await createBoard()
    const writer = rawClient(boardId, editKey)
    await writer.open
    for (const id of ['r1', 'r2', 'r3']) {
      writer.send(encodeUpdate(elementUpdate({ id })))
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    writer.close()
    await waitFor(() => writer.closeCode() !== null)
    await new Promise((resolve) => setTimeout(resolve, 150)) // past ROOM_IDLE_MS

    const reader = rawClient(boardId, editKey)
    await reader.open
    await waitForElements(reader, ['r1', 'r2', 'r3'])
    reader.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/e2e.test.ts`

Expected: FAIL, cannot resolve `../src/server`.

- [ ] **Step 3: Write the registry**

`apps/collab-server/src/rooms.ts`:

```ts
import * as Y from 'yjs'
import type { Config } from './config'
import { appendUpdate, compactBoard, loadBoard } from './db/boards'
import type { Db } from './db/client'
import { log } from './log'
import { CLOSE } from './protocol'
import { createRoom, type Room } from './room'

export interface RoomRegistry {
  /** The room for a board, loaded on first use; undefined if the board does not exist. */
  acquire(boardId: string): Promise<Room | undefined>
  /** Called when a connection left; starts the idle timer on an empty room. */
  release(boardId: string): void
  shutdown(): Promise<void>
}

interface Entry {
  room: Room
  compact(): Promise<void>
  idleTimer: NodeJS.Timeout | null
}

export function createRooms(deps: { db: Db; config: Config }): RoomRegistry {
  const { db, config } = deps
  const entries = new Map<string, Promise<Entry | undefined>>()

  async function load(boardId: string): Promise<Entry | undefined> {
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
    let lastSeq = loaded.updates.at(-1)?.seq ?? loaded.snapshotSeq
    let residual = loaded.updates.length

    const compact = async () => {
      if (residual === 0) {
        return
      }
      const upToSeq = lastSeq
      await compactBoard(db, boardId, Y.encodeStateAsUpdate(doc), upToSeq)
      residual = 0
      log({ event: 'compacted', boardId, upToSeq })
    }

    const room = createRoom(doc, {
      maxMessageBytes: config.maxMessageBytes,
      maxDocBytes: config.maxDocBytes,
      maxAwarenessBytes: config.maxAwarenessBytes,
      persist: async (update) => {
        lastSeq = await appendUpdate(db, boardId, update)
        residual += 1
        if (residual >= config.compactAfterUpdates) {
          await compact()
        }
      },
    })
    log({ event: 'room loaded', boardId, residual })
    return { room, compact, idleTimer: null }
  }

  async function evict(boardId: string, entry: Entry): Promise<void> {
    // Removed first so a connection arriving now loads a fresh room; the
    // compaction below only writes state that room also loaded.
    entries.delete(boardId)
    try {
      await entry.compact()
    } catch (error) {
      log({ event: 'compaction failed', boardId, error: String(error) })
    }
    entry.room.destroy()
    entry.room.doc.destroy()
    log({ event: 'room evicted', boardId })
  }

  return {
    async acquire(boardId) {
      let pending = entries.get(boardId)
      if (!pending) {
        pending = load(boardId)
        entries.set(boardId, pending)
        const entry = await pending
        if (!entry) {
          entries.delete(boardId)
        }
        return entry?.room
      }
      const entry = await pending
      if (entry?.idleTimer) {
        clearTimeout(entry.idleTimer)
        entry.idleTimer = null
      }
      return entry?.room
    },
    release(boardId) {
      entries.get(boardId)?.then((entry) => {
        if (!entry || entry.room.connectionCount() > 0 || entry.idleTimer) {
          return
        }
        entry.idleTimer = setTimeout(() => {
          entry.idleTimer = null
          if (entry.room.connectionCount() === 0) {
            void evict(boardId, entry)
          }
        }, config.roomIdleMs)
      })
    },
    async shutdown() {
      const pending = [...entries.entries()]
      entries.clear()
      for (const [boardId, promise] of pending) {
        const entry = await promise
        if (!entry) {
          continue
        }
        if (entry.idleTimer) {
          clearTimeout(entry.idleTimer)
        }
        entry.room.closeAll(CLOSE.shuttingDown, 'server shutting down')
        try {
          await entry.compact()
        } catch (error) {
          log({ event: 'compaction failed', boardId, error: String(error) })
        }
        entry.room.destroy()
        entry.room.doc.destroy()
      }
    },
  }
}
```

- [ ] **Step 4: Write the WebSocket wiring**

`apps/collab-server/src/ws.ts`:

```ts
import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Config } from './config'
import { findBoard } from './db/boards'
import type { Db } from './db/client'
import { resolveRole, type Role } from './keys'
import { log } from './log'
import { CLOSE } from './protocol'
import { createTokenBucket } from './rate-limit'
import type { RoomConnection } from './room'
import type { RoomRegistry } from './rooms'

export interface WsDeps {
  db: Db
  config: Config
  rooms: RoomRegistry
}

const PATH = /^\/ws\/([A-Za-z0-9_-]{8,64})$/

interface Upgrade {
  boardId: string
  token: string
}

function parseUpgrade(request: IncomingMessage): Upgrade | null {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const match = PATH.exec(url.pathname)
  if (!match?.[1]) {
    return null
  }
  return { boardId: match[1], token: url.searchParams.get('token') ?? '' }
}

/**
 * Accepts every upgrade on /ws/:boardId, then closes with an
 * application code when the board or the token is wrong: a close code
 * needs a completed handshake, and the client reads it.
 */
export function attachWebSocket(server: HttpServer, deps: WsDeps): WebSocketServer {
  const { db, config, rooms } = deps
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })

  async function resolve(upgrade: Upgrade): Promise<Role | number> {
    const board = await findBoard(db, upgrade.boardId)
    if (!board) {
      return CLOSE.unknownBoard
    }
    return resolveRole(upgrade.token, board) ?? CLOSE.unauthorized
  }

  async function connect(ws: WebSocket, upgrade: Upgrade, role: Role): Promise<void> {
    const room = await rooms.acquire(upgrade.boardId)
    if (!room) {
      ws.close(CLOSE.unknownBoard, 'unknown board')
      return
    }
    const bucket = createTokenBucket(config.rateLimitPer10s, 10_000)
    const connection: RoomConnection = {
      role,
      send: (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data)
        }
      },
      close: (code, reason) => ws.close(code, reason),
    }
    room.join(connection)
    log({ event: 'connection open', boardId: upgrade.boardId, role })
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        return
      }
      if (!bucket.take()) {
        ws.close(CLOSE.rateLimited, 'rate limit exceeded')
        return
      }
      const bytes = Array.isArray(data)
        ? new Uint8Array(Buffer.concat(data))
        : new Uint8Array(data as ArrayBuffer | Buffer)
      void room.handleMessage(connection, bytes)
    })
    ws.on('close', (code) => {
      room.leave(connection)
      rooms.release(upgrade.boardId)
      log({ event: 'connection closed', boardId: upgrade.boardId, code })
    })
    ws.on('error', (error) => {
      log({ event: 'connection error', boardId: upgrade.boardId, error: String(error) })
    })
  }

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const upgrade = parseUpgrade(request)
    if (!upgrade) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      void resolve(upgrade).then((outcome) => {
        if (typeof outcome === 'number') {
          ws.close(outcome, outcome === CLOSE.unknownBoard ? 'unknown board' : 'unauthorized')
          return
        }
        return connect(ws, upgrade, outcome)
      })
    })
  })

  return wss
}
```

- [ ] **Step 5: Write the composition root and the entry point**

`apps/collab-server/src/server.ts`:

```ts
import type { Server as HttpServer } from 'node:http'
import { serve } from '@hono/node-server'
import type { Config } from './config'
import { connectDatabase } from './db/client'
import { createApp } from './http'
import { log } from './log'
import { CLOSE } from './protocol'
import { createRooms } from './rooms'
import { attachWebSocket } from './ws'

export interface RunningServer {
  port: number
  close(): Promise<void>
}

export async function startServer(config: Config): Promise<RunningServer> {
  const database = await connectDatabase(config.databaseUrl)
  const rooms = createRooms({ db: database.db, config })
  const app = createApp({ db: database.db, config })

  const { server, port } = await new Promise<{ server: HttpServer; port: number }>(
    (resolve) => {
      const instance = serve({ fetch: app.fetch, port: config.port }, (info) => {
        resolve({ server: instance as HttpServer, port: info.port })
      })
    },
  )
  const wss = attachWebSocket(server, { db: database.db, config, rooms })
  log({ event: 'listening', port })

  return {
    port,
    async close() {
      for (const client of wss.clients) {
        client.close(CLOSE.shuttingDown, 'server shutting down')
      }
      await rooms.shutdown()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      await database.close()
      log({ event: 'stopped' })
    },
  }
}
```

`apps/collab-server/src/main.ts`:

```ts
import { ConfigError, loadConfig } from './config'
import { log } from './log'
import { startServer } from './server'

let config: ReturnType<typeof loadConfig>
try {
  config = loadConfig(process.env)
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}

const server = await startServer(config).catch((error: unknown) => {
  log({ event: 'boot failed', error: String(error) })
  process.exit(1)
})

let closing = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (closing) {
      return
    }
    closing = true
    log({ event: 'signal', signal })
    void server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        log({ event: 'shutdown failed', error: String(error) })
        process.exit(1)
      },
    )
  })
}
```

- [ ] **Step 6: Run the end-to-end test to verify it passes**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/e2e.test.ts`

Expected: PASS, 5 tests. Known pitfalls:

- `serve()` from `@hono/node-server` returns the Node server synchronously; if the typecheck rejects the cast, type the promise as `{ server: ServerType; port: number }` with `import type { ServerType } from '@hono/node-server'` and pass it to `attachWebSocket` as `server as HttpServer`.
- Node's global `WebSocket` (used by `connectBoard` and `rawClient`) exists from Node 22 without a flag; if `WebSocket` is undefined, the Node version is below 22.
- If the compaction test is flaky because the idle eviction has not fired yet, raise the second `setTimeout` in that test to 300 ms.

- [ ] **Step 7: Run the whole server suite, typecheck, Biome**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck && pnpm check`

Expected: all pass.

- [ ] **Step 8: Smoke-run the entry point**

Run: `DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb PORT=3999 timeout 5 pnpm --filter @tlwb/collab-server start; echo "exit $?"`

Expected: one JSON `listening` line with `"port":3999`, then `exit 124` (killed by `timeout`; on macOS without `timeout`, use `gtimeout` from coreutils or start it in the background and `kill` it).

- [ ] **Step 9: Commit**

```bash
git add apps/collab-server/src/rooms.ts apps/collab-server/src/ws.ts apps/collab-server/src/server.ts apps/collab-server/src/main.ts apps/collab-server/test/e2e.test.ts
git commit -m "✨ feat(collab-server): serve boards over WebSocket with persistence and eviction"
```

---

### Task 8: Image assets over HTTP

**Files:**
- Create: `apps/collab-server/src/db/assets.ts`
- Modify: `apps/collab-server/src/http.ts` (add the two routes)
- Test: `apps/collab-server/test/http-assets.test.ts`

**Interfaces:**
- Consumes: `findBoard`, `Db` (Task 4); `resolveRole` (Task 3); `createApp` (Task 5).
- Produces from `db/assets.ts`: `putAsset(db, { boardId, hash, mime, bytes: Uint8Array }): Promise<'created' | 'exists'>`; `getAsset(db, boardId, hash): Promise<{ mime: string; bytes: Buffer } | undefined>`.

- [ ] **Step 1: Write the failing test**

`apps/collab-server/test/http-assets.test.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { connectDatabase } from '../src/db/client'
import { createApp } from '../src/http'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  database = await connectDatabase(url)
  app = createApp({
    db: database.db,
    config: loadConfig({ DATABASE_URL: url, CORS_ORIGIN: 'http://a', MAX_ASSET_BYTES: '64' }),
  })
})

afterAll(async () => {
  await database.close()
})

async function board() {
  const response = await app.request('http://server/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId: randomUUID() }),
  })
  return (await response.json()) as { boardId: string; editKey: string; viewKey: string }
}

const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
const hash = createHash('sha256').update(bytes).digest('hex')

function put(boardId: string, key: string, body: Uint8Array, type = 'image/png', at = hash) {
  return app.request(`http://server/boards/${boardId}/assets/${at}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, 'content-type': type },
    body,
  })
}

function get(boardId: string, key: string, at = hash) {
  return app.request(`http://server/boards/${boardId}/assets/${at}`, {
    headers: { authorization: `Bearer ${key}` },
  })
}

describe('assets', () => {
  it('stores with the edit key, serves with either key, immutable', async () => {
    const { boardId, editKey, viewKey } = await board()
    expect((await put(boardId, editKey, bytes)).status).toBe(201)
    expect((await put(boardId, editKey, bytes)).status).toBe(200)
    const response = await get(boardId, viewKey)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect((await get(boardId, editKey)).status).toBe(200)
  })

  it('refuses the view key on PUT and a wrong key on GET', async () => {
    const { boardId, editKey, viewKey } = await board()
    expect((await put(boardId, viewKey, bytes)).status).toBe(401)
    await put(boardId, editKey, bytes)
    expect((await get(boardId, 'nope')).status).toBe(401)
    const missing = await app.request(`http://server/boards/${boardId}/assets/${hash}`)
    expect(missing.status).toBe(401)
  })

  it('answers 400 on a hash mismatch, 415 on a non-image, 413 past the limit, 404 when absent', async () => {
    const { boardId, editKey } = await board()
    expect((await put(boardId, editKey, bytes, 'image/png', 'a'.repeat(64))).status).toBe(400)
    expect((await put(boardId, editKey, bytes, 'text/plain')).status).toBe(415)
    const big = new Uint8Array(65)
    const bigHash = createHash('sha256').update(big).digest('hex')
    expect((await put(boardId, editKey, big, 'image/png', bigHash)).status).toBe(413)
    expect((await get(boardId, editKey)).status).toBe(404)
    expect((await get(randomUUID(), editKey)).status).toBe(401)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/http-assets.test.ts`

Expected: FAIL, the PUT answers 404 (route missing).

- [ ] **Step 3: Write the asset queries and the routes**

`apps/collab-server/src/db/assets.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import type { Db } from './client'
import { assets } from './schema'

export async function putAsset(
  db: Db,
  input: { boardId: string; hash: string; mime: string; bytes: Uint8Array },
): Promise<'created' | 'exists'> {
  const rows = await db
    .insert(assets)
    .values({ ...input, bytes: Buffer.from(input.bytes) })
    .onConflictDoNothing()
    .returning({ hash: assets.hash })
  return rows.length > 0 ? 'created' : 'exists'
}

export async function getAsset(
  db: Db,
  boardId: string,
  hash: string,
): Promise<{ mime: string; bytes: Buffer } | undefined> {
  const [row] = await db
    .select({ mime: assets.mime, bytes: assets.bytes })
    .from(assets)
    .where(and(eq(assets.boardId, boardId), eq(assets.hash, hash)))
  return row
}
```

In `apps/collab-server/src/http.ts`, add these imports:

```ts
import { createHash } from 'node:crypto'
import { bodyLimit } from 'hono/body-limit'
import { getAsset, putAsset } from './db/assets'
import { findBoard } from './db/boards'
import { resolveRole, type Role } from './keys'
```

and, before `return app`, the two routes:

```ts
  const HASH = /^[a-f0-9]{64}$/

  async function roleFromBearer(
    c: Context<Env>,
    boardId: string,
  ): Promise<Role | null> {
    const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
    if (!token) {
      return null
    }
    const board = await findBoard(db, boardId)
    return board ? resolveRole(token, board) : null
  }

  app.put(
    '/boards/:boardId/assets/:hash',
    bodyLimit({
      maxSize: config.maxAssetBytes,
      onError: (c) => c.json({ error: 'asset too large' }, 413),
    }),
    async (c) => {
      const { boardId, hash } = c.req.param()
      if ((await roleFromBearer(c, boardId)) !== 'edit') {
        return c.json({ error: 'edit key required' }, 401)
      }
      const mime = c.req.header('content-type') ?? ''
      if (!mime.startsWith('image/')) {
        return c.json({ error: 'only images are accepted' }, 415)
      }
      const bytes = new Uint8Array(await c.req.arrayBuffer())
      if (bytes.byteLength > config.maxAssetBytes) {
        return c.json({ error: 'asset too large' }, 413)
      }
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (!HASH.test(hash) || actual !== hash) {
        return c.json({ error: 'hash does not match the content' }, 400)
      }
      const outcome = await putAsset(db, { boardId, hash, mime, bytes })
      return c.json({ hash }, outcome === 'created' ? 201 : 200)
    },
  )

  app.get('/boards/:boardId/assets/:hash', async (c) => {
    const { boardId, hash } = c.req.param()
    if ((await roleFromBearer(c, boardId)) === null) {
      return c.json({ error: 'a board key is required' }, 401)
    }
    const asset = await getAsset(db, boardId, hash)
    if (!asset) {
      return c.json({ error: 'unknown asset' }, 404)
    }
    return c.body(new Uint8Array(asset.bytes), 200, {
      'Content-Type': asset.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
  })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @tlwb/collab-server exec vitest run test/http-assets.test.ts`

Expected: PASS, 3 tests. If the 413 case answers 201, `bodyLimit` did not see a `Content-Length` (the `Request` built in the test streams the body); the explicit `bytes.byteLength` check after reading covers it, so check that check runs before hashing.

- [ ] **Step 5: Run the server suite, typecheck, Biome**

Run: `pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck && pnpm check`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/src/db/assets.ts apps/collab-server/src/http.ts apps/collab-server/test/http-assets.test.ts
git commit -m "✨ feat(collab-server): store and serve image assets by content hash"
```

---

### Task 9: Docker image, documentation, CI

**Files:**
- Create: `apps/collab-server/Dockerfile`
- Create: `.dockerignore`
- Create: `apps/collab-server/README.md`
- Modify: `README.md` (repository root, the "Monorepo packages" list)
- Modify: `.github/workflows/ci.yml` (the `verify` job)

- [ ] **Step 1: Write the Dockerfile and the ignore file**

`apps/collab-server/Dockerfile`:

```dockerfile
# ponytail: single stage, whole monorepo, sources run through tsx. A
# multi-stage build with a bundler is the upgrade when image size or
# cold start matters.
FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile --prod

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@tlwb/collab-server", "start"]
```

`.dockerignore` at the repository root:

```
.git
.claude
.superpowers
.github
node_modules
**/node_modules
**/dist
**/coverage
**/__diffs__
```

- [ ] **Step 2: Build and run the image against Compose**

Run: `docker compose build collab-server && docker compose up -d && sleep 5 && curl -s localhost:3000/health; docker compose logs collab-server | tail -5; docker compose down`

Expected: `{"ok":true}` from `curl`; the logs show a `listening` line and no error. If `pnpm install --prod` fails on the `@napi-rs/canvas` postinstall, it means a development dependency was installed: check the `--prod` flag is present.

- [ ] **Step 3: Write the package README**

`apps/collab-server/README.md`:

```markdown
# @tlwb/collab-server

The collaboration server: hosted boards, share keys, real-time relay of
Yjs updates and awareness, read-only enforcement, element validation,
Postgres persistence, and image assets.

## Running

```bash
docker compose up -d postgres
DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb pnpm --filter @tlwb/collab-server dev
```

Or the whole stack: `docker compose up`.

## Configuration

| Variable                | Default    | Meaning                                |
| ----------------------- | ---------- | -------------------------------------- |
| `DATABASE_URL`          | required   | Postgres connection string             |
| `PORT`                  | `3000`     | HTTP and WebSocket port                |
| `CORS_ORIGIN`           | required in production, `*` otherwise | Allowed origin |
| `MAX_MESSAGE_BYTES`     | `1048576`  | WebSocket message limit                |
| `MAX_DOC_BYTES`         | `5242880`  | Encoded document state limit           |
| `MAX_ASSET_BYTES`       | `10485760` | Asset upload limit                     |
| `MAX_AWARENESS_BYTES`   | `16384`    | One awareness message limit            |
| `ROOM_IDLE_MS`          | `60000`    | Idle time before a room leaves memory  |
| `COMPACT_AFTER_UPDATES` | `500`      | Residual updates before compaction     |
| `RATE_LIMIT_PER_10S`    | `200`      | Messages per connection per 10 seconds |
| `CREATE_LIMIT_PER_MIN`  | `10`       | Board creations per IP per minute      |

## API

- `POST /boards` with `{ "boardId": "<8 to 64 of [A-Za-z0-9_-]>" }`:
  `201 { boardId, editKey, viewKey }`, `409` if it exists. Keys are shown
  once and stored hashed.
- `PUT /boards/:boardId/assets/:sha256` with the image bytes as the body
  and `Authorization: Bearer <editKey>`: `201` or `200` if present.
- `GET /boards/:boardId/assets/:sha256` with either key.
- `GET /health`.
- WebSocket `/ws/:boardId?token=<key>`: the y-websocket wire format, as
  `connectBoard` from `@tlwb/store-yjs` speaks it.

WebSocket close codes: `4401` bad token, `4403` write on a view link,
`4404` unknown board, `4409` too large, `4422` malformed element, `4429`
rate limit, `1011` storage failure, `1001` shutdown.

## Tests

```bash
docker compose up -d postgres
pnpm --filter @tlwb/collab-server test
```
```

Add to the root `README.md` list under "Monorepo packages", after the
`packages/store-yjs` entry:

```markdown
- `apps/collab-server`: the collaboration server. Creates hosted boards
  and their share keys, relays Yjs updates and awareness between the
  collaborators of a board, enforces read-only links, validates every
  incoming element on a staging document, persists boards in Postgres
  as a snapshot plus residual updates, and stores image assets. One
  Docker image plus Postgres (`docker compose up`).
```

- [ ] **Step 4: Add Postgres to CI**

In `.github/workflows/ci.yml`, inside the `verify` job, add after
`runs-on: ubuntu-latest`:

```yaml
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: tlwb
          POSTGRES_PASSWORD: tlwb
          POSTGRES_DB: tlwb
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://tlwb:tlwb@localhost:5432/tlwb
```

- [ ] **Step 5: Check formatting**

Run: `pnpm check`

Expected: pass (Biome does not format markdown or YAML; the check covers the JSON and TypeScript files).

- [ ] **Step 6: Commit**

```bash
git add apps/collab-server/Dockerfile .dockerignore apps/collab-server/README.md README.md
git commit -m "📦 build(collab-server): ship the server as one Docker image over Compose"
git add .github/workflows/ci.yml
git commit -m "👷 ci: run the server tests against a Postgres service"
```

---

### Task 10: Verification

**Files:** none created; read-only checks plus any fix they call for.

- [ ] **Step 1: Run the full workspace verification**

Run: `docker compose up -d postgres && pnpm install --frozen-lockfile && pnpm check && pnpm typecheck && pnpm test`

Expected: every command exits 0; the engine, store-yjs, and collab-server suites all pass.

- [ ] **Step 2: Check the dependency lists against the Global Constraints**

Run: `node -e "const p=require('./apps/collab-server/package.json');console.log(Object.keys(p.dependencies).sort().join(' '));console.log(Object.keys(p.devDependencies).sort().join(' '))"`

Expected:

```
@hono/node-server @tlwb/engine drizzle-orm hono lib0 postgres tsx ws y-protocols yjs
@tlwb/store-yjs @types/node @types/ws drizzle-kit typescript vitest
```

- [ ] **Step 3: Check the engine and store-yjs footprints**

Run: `git diff --stat 02f6e25 -- packages/engine packages/store-yjs`

Expected: exactly three engine files (`src/model/validate.ts`, `src/index.ts`, `test/model/validate.test.ts`) and nothing under `packages/store-yjs`.

- [ ] **Step 4: Check durability before relay**

Run: `grep -n "await options.persist" apps/collab-server/src/room.ts && grep -n "Y.applyUpdate(doc, update, connection)" apps/collab-server/src/room.ts`

Expected: the `persist` line number is smaller than the `applyUpdate(doc, ...)` line number.

- [ ] **Step 5: Fix and commit anything the checks surfaced**

If a step above failed, fix it in the file it names and rerun the step. Commit with a message naming the fix, for example:

```bash
git commit -am "🐛 fix(collab-server): <what was wrong>"
```

If nothing failed, there is nothing to commit; the plan is complete.
