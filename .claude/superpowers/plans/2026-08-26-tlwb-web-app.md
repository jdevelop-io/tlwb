# tlwb Web Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/web`: the landing page and the board editor that turn the engine, the Yjs store, and the collaboration server into a product a person can open, draw on, share by link, and collaborate on in real time.

**Architecture:** One Vite application with two HTML pages: a static landing (`index.html`) and a React 19 editor (`board.html`, served on `/b/:id`). A React-free `session/` layer composes the `@tlwb/store-yjs` primitives and `createEditor`; React owns only the chrome and reads state by subscription. Boards are local-first (IndexedDB); Share migrates a board to a server-issued id and connects it over WebSocket. Caddy serves the build and proxies `/api` and `/ws` to the collaboration server on the same origin.

**Tech Stack:** Vite 7, React 19, TypeScript, plain CSS with custom properties, `@fontsource/inter` and `@fontsource/caveat`, `lucide-react`, `nanoid`, Vitest + happy-dom + Testing Library + fake-indexeddb, Playwright, Caddy 2, Biome (workspace root).

**Spec:** `.claude/superpowers/specs/2026-08-26-tlwb-web-app-design.md`

## Global Constraints

- Node >= 22, pnpm 11 (root `packageManager`), Biome from the root: `pnpm check` must pass (single quotes, no semicolons, trailing commas, 80 columns, organized imports).
- Files, code, comments, commit messages in English; no em-dashes; gitmoji + Conventional Commits; never add Claude attribution.
- `apps/web` never imports `yjs` or `y-protocols`; the document and the awareness are opaque handles from `@tlwb/store-yjs`.
- `session/` never imports React.
- Every request to the server is relative: `/api/...` over HTTP, `/ws` over WebSocket. No `VITE_*` variable.
- Share keys travel only in the URL fragment: `/b/<id>#edit=<editKey>` or `/b/<id>#view=<viewKey>`. Never in a query string.
- localStorage keys: `tlwb:keys:<id>` (JSON `{ editKey?, viewKey? }`), `tlwb:alias:<oldId>` (new id string), `tlwb:recents` (JSON array, cap 50), `tlwb:identity` (JSON `{ name, color }`).
- IndexedDB names come from `@tlwb/store-yjs`: `tlwb:board:<id>` and `tlwb:assets:<id>`.
- Tokens: paper `#F7F7F5`, surface `#FFFFFF`, border `#E5E4E0`, ink `#1A1A1A`, muted `#6B6B6B`, accent `#FF6B4A`, agent `#8B7CF6`; UI font Inter 14 px; hand font Caveat; 8 px grid; radius 8 px (12 px dialogs).
- Drawing palette: strokes `#1A1A1A #E03131 #F76707 #2F9E44 #1971C2 #7048E8 #F59F00`; fills `null #FFC9C9 #FFD8A8 #B2F2BB #A5D8FF #D0BFFF #FFEC99`.
- Tests: `pnpm --filter @tlwb/web test` (Vitest) and `pnpm --filter @tlwb/web e2e` (Playwright). The server tests need `docker compose up -d postgres` and `DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb`.
- Commit after every task with the message given in the task.

---

## File Structure

Created:

```
apps/web/
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts,
  playwright.config.ts, Dockerfile, Caddyfile
  index.html                         landing
  board.html                         editor page (noindex)
  public/favicon.svg, public/editor-preview.svg
  src/styles/tokens.css              shared tokens, reset
  src/landing/landing.css
  src/landing/recents.ts             "Resume" list on the landing
  src/board/main.tsx                 URL resolution, mounts <BoardApp>
  src/board/session/keys.ts          share keys, aliases, fragment, links
  src/board/session/recents.ts       recent boards index
  src/board/session/identity.ts      presence name and color
  src/board/session/server.ts        HTTP client
  src/board/session/image-cache.ts   decoded images for the renderer
  src/board/session/board-session.ts open a board, presence, connection
  src/board/session/share.ts         local to hosted migration
  src/board/session/board-actions.ts duplicate, remove, download
  src/board/session/palette.ts       stroke and fill colors, fonts
  src/board/hooks/use-session.ts, use-editor-state.ts, use-peers.ts
  src/board/components/*.tsx + *.css (board-app, toolbar, context-panel,
    top-bar, board-menu, presence-stack, share-dialog, zoom-controls,
    help-button, text-editor, notice, not-found)
  src/board/board.css
  test/setup.ts, test/**/*.test.ts(x)
  e2e/board.spec.ts
```

Modified:

- `apps/collab-server/src/http.ts`: server-issued board ids.
- `apps/collab-server/test/http-boards.test.ts`, `http-assets.test.ts`, `e2e.test.ts`: no body on `POST /boards`.
- `apps/collab-server/README.md`, `.claude/superpowers/specs/2026-08-26-tlwb-collab-server-design.md`: amended.
- `packages/store-yjs/src/persistence.ts`, `assets.ts`, `sync.ts`, `index.ts`, `README.md`: `clear`, `delete`, `subscribeClose`, `reconnect`.
- `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`.

---

### Task 1: The server issues board ids

**Files:**
- Modify: `apps/collab-server/src/http.ts:113-136`
- Modify: `apps/collab-server/test/http-boards.test.ts`
- Modify: `apps/collab-server/test/http-assets.test.ts:31-36`
- Modify: `apps/collab-server/test/e2e.test.ts:38-47, 344-350`
- Modify: `apps/collab-server/README.md:43-45`
- Modify: `.claude/superpowers/specs/2026-08-26-tlwb-collab-server-design.md` (section 4 "Creation", section 11)

**Interfaces:**
- Produces: `POST /boards` with no body answers `201 { boardId, editKey, viewKey }`; `boardId` is 22 characters of `[A-Za-z0-9_-]`.

- [ ] **Step 1: Rewrite the creation tests**

In `apps/collab-server/test/http-boards.test.ts`, replace the `post` helper and the first three tests:

```ts
function post(ip = '10.0.0.1') {
  return new Request('http://server/boards', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  })
}

describe('POST /boards', () => {
  it('creates a board under a server-issued id and returns two distinct keys stored hashed', async () => {
    const response = await app().request(post())
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.boardId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(body.editKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.viewKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.editKey).not.toBe(body.viewKey)
    const stored = await findBoard(database.db, body.boardId)
    expect(stored?.editKeyHash.equals(hashKey(body.editKey))).toBe(true)
    expect(stored?.viewKeyHash.equals(hashKey(body.viewKey))).toBe(true)
  })

  it('issues a different id on every call and ignores any body', async () => {
    const first = await (await app().request(post())).json()
    const withBody = new Request('http://server/boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boardId: first.boardId }),
    })
    const second = await app().request(withBody)
    expect(second.status).toBe(201)
    expect((await second.json()).boardId).not.toBe(first.boardId)
  })
```

Then replace every remaining `post({ boardId: randomUUID() }, ip)` with `post(ip)` and `post({ boardId: randomUUID() })` with `post()`. Remove the `randomUUID` import if nothing else uses it.

- [ ] **Step 2: Run the file to verify it fails**

Run: `docker compose up -d postgres && DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb pnpm --filter @tlwb/collab-server test -- test/http-boards.test.ts`
Expected: FAIL, the first test gets `400` (body must be JSON).

- [ ] **Step 3: Generate the id in the handler**

In `apps/collab-server/src/http.ts`, import `randomBytes` next to `createHash` from `node:crypto`, delete the now-unused `const BOARD_ID = ...` line (Biome flags an unused constant), then replace the block from `let body: unknown` through the `409` return with:

```ts
    // 16 random bytes in base64url: 22 characters inside BOARD_ID's
    // alphabet, unguessable, and never chosen by a client.
    const boardId = randomBytes(16).toString('base64url')
    const editKey = generateKey()
    const viewKey = generateKey()
    const outcome = await createBoard(db, boardId, {
      editKeyHash: hashKey(editKey),
      viewKeyHash: hashKey(viewKey),
    })
    if (outcome === 'exists') {
      // 128 random bits colliding is not a case worth a retry loop.
      return c.json({ error: 'internal error' }, 500)
    }
    return c.json({ boardId, editKey, viewKey }, 201)
```

- [ ] **Step 4: Update the other tests' helpers**

`apps/collab-server/test/http-assets.test.ts`, the `board()` helper:

```ts
async function board() {
  const response = await app.request('http://server/boards', { method: 'POST' })
  return (await response.json()) as {
    boardId: string
    editKey: string
    viewKey: string
  }
}
```

`apps/collab-server/test/e2e.test.ts`, the `createBoard()` helper and the isolated-server block:

```ts
async function createBoard() {
  const response = await fetch(`http://${base}/boards`, { method: 'POST' })
  expect(response.status).toBe(201)
  return (await response.json()) as {
    boardId: string
    editKey: string
    viewKey: string
  }
}
```

```ts
    const response = await fetch(`http://${isolatedBase}/boards`, {
      method: 'POST',
    })
    const { boardId, editKey } = (await response.json()) as {
      boardId: string
      editKey: string
    }
```

Remove the now-unused `randomUUID` imports and the local `const boardId = randomUUID()` lines those helpers replaced.

- [ ] **Step 5: Run the whole server suite**

Run: `DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb pnpm --filter @tlwb/collab-server test && pnpm --filter @tlwb/collab-server typecheck`
Expected: PASS.

- [ ] **Step 6: Amend the README and the specification**

`apps/collab-server/README.md` line 43 to 45 becomes:

```md
- `POST /boards`, no body: `201 { boardId, editKey, viewKey }`. The
  server issues the id (22 characters of `[A-Za-z0-9_-]`). Keys are
  shown once and stored hashed.
```

In the specification, section 4 "Creation": replace the first paragraph and the `409`/`400` bullets with "`POST /boards` takes no body. The server issues the identifier (16 random bytes, base64url, 22 characters within `^[A-Za-z0-9_-]{8,64}$`), so a client never chooses an id and a local id never leaves the browser." Keep the `201` and `429` bullets, and drop the sentence about the pattern being enforced elsewhere: no other route validates the id shape, the database lookup does. In section 11 add a dated entry (2026-08-26): "Board ids moved from client-chosen to server-issued when the web application was designed; see `2026-08-26-tlwb-web-app-design.md` section 2."

- [ ] **Step 7: Commit**

```bash
git add apps/collab-server .claude/superpowers/specs/2026-08-26-tlwb-collab-server-design.md
git commit -m "♻️ refactor(collab-server): issue board ids on the server instead of accepting them"
```

---

### Task 2: store-yjs teardown and close-code primitives

**Files:**
- Modify: `packages/store-yjs/src/persistence.ts`
- Modify: `packages/store-yjs/src/assets.ts`
- Modify: `packages/store-yjs/src/sync.ts`
- Modify: `packages/store-yjs/README.md` (sections "Tearing a board down", "Assets")
- Test: `packages/store-yjs/test/persistence.test.ts`, `assets.test.ts`, `sync.test.ts`

**Interfaces:**
- Produces: `BoardPersistence.clear(): Promise<void>` (destroys and deletes the database); `AssetStore.delete(): Promise<void>` (closes and deletes the database); `BoardConnection.subscribeClose(listener: (code: number | null) => void): () => void` (every socket closure, `null` when closed locally) and `BoardConnection.reconnect(): void`. The provider stops reconnecting on `4401`, `4403`, `4404` and keeps reconnecting on every other code.

- [ ] **Step 1: Write the failing tests**

Append to `packages/store-yjs/test/persistence.test.ts`:

```ts
  it('clear deletes the database so a reopen starts empty', async () => {
    const boardId = 'persist-clear'
    const doc = new Y.Doc()
    const store = createYjsBoardStore(doc)
    const persistence = persistBoard(doc, boardId)
    await persistence.whenLoaded
    store.setMeta({ name: 'gone' })
    await persistence.clear()

    const again = new Y.Doc()
    const reopened = persistBoard(again, boardId)
    await reopened.whenLoaded
    expect(createYjsBoardStore(again).getMeta().name).toBe('Untitled')
    await reopened.clear()
  })
```

Append to `packages/store-yjs/test/assets.test.ts`:

```ts
  it('delete removes the blobs of the board', async () => {
    const assets = createAssetStore('assets-delete')
    const hash = await assets.put(new Blob([new Uint8Array([1, 2, 3])]))
    await assets.delete()
    const reopened = createAssetStore('assets-delete')
    expect(await reopened.get(hash)).toBeUndefined()
    await reopened.delete()
  })
```

Append to `packages/store-yjs/test/sync.test.ts`:

```ts
  it('reports close codes and stops reconnecting only on 4401, 4403, 4404', () => {
    const connection = connectBoard(new Y.Doc(), {
      url: 'ws://localhost:1',
      boardId: 'board-1',
      token: 'secret',
      connect: false,
    })
    const codes: Array<number | null> = []
    connection.subscribeClose((code) => codes.push(code))
    connection.provider.emit('connection-close', [
      { code: 4422 } as CloseEvent,
      connection.provider,
    ])
    connection.provider.emit('connection-close', [null, connection.provider])
    expect(codes).toEqual([4422, null])

    const reconnects = (code: number) =>
      connection.provider.shouldReconnect(
        { code } as CloseEvent,
        connection.provider,
      )
    expect(reconnects(4401)).toBe(false)
    expect(reconnects(4403)).toBe(false)
    expect(reconnects(4404)).toBe(false)
    expect(reconnects(4409)).toBe(true)
    expect(reconnects(4422)).toBe(true)
    expect(reconnects(4429)).toBe(true)
    expect(reconnects(1006)).toBe(true)
    connection.destroy()
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/store-yjs test`
Expected: FAIL, `clear`, `delete`, `subscribeClose` are not functions.

- [ ] **Step 3: Implement**

`persistence.ts`: add `clear(): Promise<void>` to the interface with the doc comment "Destroys the mirror and deletes its database." and `clear: () => persistence.clearData()` to the returned object.

`assets.ts`: import `deleteDB` from `idb`, add `delete(): Promise<void>` to the interface ("Closes and deletes the database of this board.") and:

```ts
    async delete() {
      ;(await db).close()
      await deleteDB(`tlwb:assets:${boardId}`)
    },
```

`sync.ts`:

```ts
/** The server says the link itself is wrong; reconnecting cannot help. */
const PERMANENT_CLOSE_CODES = new Set([4401, 4403, 4404])

export interface BoardConnection {
  provider: WebsocketProvider
  awareness: Awareness
  getStatus(): ConnectionStatus
  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void
  /** Every socket closure; the code is null when closed locally. */
  subscribeClose(listener: (code: number | null) => void): () => void
  /** Resumes after a permanent close, once the caller fixed its cause. */
  reconnect(): void
  destroy(): void
}
```

In `connectBoard`, pass `shouldReconnect: (event) => !PERMANENT_CLOSE_CODES.has(event.code)` to the provider options, keep a `closeListeners` set fed by `provider.on('connection-close', (event: CloseEvent | null) => ...)` that forwards `event?.code ?? null`, clear it in `destroy`, and add `reconnect: () => provider.connect()`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @tlwb/store-yjs test && pnpm --filter @tlwb/store-yjs typecheck`
Expected: PASS.

- [ ] **Step 5: Document**

In `packages/store-yjs/README.md`, "Tearing a board down": add after the code block "To forget a board rather than close it, `persistence.clear()` and `assets.delete()` remove both databases." In "Assets" nothing changes. Add a "Close codes" paragraph under the connection example: "`subscribeClose` reports every socket closure with its code (`null` for a local close). The provider stops reconnecting on `4401`, `4403`, and `4404`, the codes that mean the link itself is wrong; `reconnect()` resumes once the caller has fixed the cause. Every other code reconnects with backoff."

- [ ] **Step 6: Commit**

```bash
git add packages/store-yjs
git commit -m "✨ feat(store-yjs): expose database deletion, close codes, and reconnection"
```

---

### Task 3: Web package scaffold and share keys

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/test/setup.ts`
- Create: `apps/web/board.html`, `apps/web/index.html` (placeholder replaced in Task 15), `apps/web/src/styles/tokens.css`, `apps/web/src/board/main.tsx` (placeholder replaced in Task 8)
- Create: `apps/web/src/board/session/keys.ts`
- Test: `apps/web/test/session/keys.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StoredKeys { editKey?: string; viewKey?: string }
  export type BoardRole = 'local' | 'edit' | 'view'
  export function readKeys(boardId: string, storage?: Storage): StoredKeys | null
  export function writeKeys(boardId: string, keys: StoredKeys, storage?: Storage): void
  export function clearKeys(boardId: string, storage?: Storage): void
  export function roleOf(keys: StoredKeys | null): BoardRole
  export function tokenOf(keys: StoredKeys): string | null
  export function keysFromFragment(hash: string): StoredKeys | null
  export function shareLink(origin: string, boardId: string, keys: StoredKeys, role: 'edit' | 'view'): string | null
  export function readAlias(boardId: string, storage?: Storage): string | null
  export function writeAlias(oldId: string, newId: string, storage?: Storage): void
  export function clearAliasesTo(boardId: string, storage?: Storage): void
  ```

- [ ] **Step 1: Scaffold the package**

`apps/web/package.json`:

```json
{
  "name": "@tlwb/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fontsource/caveat": "^5.2.5",
    "@fontsource/inter": "^5.2.5",
    "@tlwb/engine": "workspace:*",
    "@tlwb/store-yjs": "workspace:*",
    "lucide-react": "^0.540.0",
    "nanoid": "^5.1.5",
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.1.10",
    "@types/react-dom": "^19.1.7",
    "@vitejs/plugin-react": "^5.0.1",
    "fake-indexeddb": "^6.2.5",
    "happy-dom": "^18.0.1",
    "typescript": "^7.0.2",
    "vite": "^7.1.3",
    "vitest": "^4.1.10"
  }
}
```

Run `pnpm install` afterwards; if a version above does not resolve, take the latest published one (`pnpm view <name> version`).

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src", "test", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

`apps/web/vite.config.ts`:

```ts
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import {
  defineConfig,
  type Plugin,
  type PreviewServer,
  type ViteDevServer,
} from 'vite'

/** `/b/<id>` is one page; the dev and preview servers must serve it. */
function boardRoutes(): Plugin {
  const rewrite = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/b/')) {
        req.url = '/board.html'
      }
      next()
    })
  }
  return {
    name: 'tlwb-board-routes',
    configureServer: rewrite,
    configurePreviewServer: rewrite,
  }
}

export default defineConfig({
  plugins: [react(), boardRoutes()],
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        board: resolve(__dirname, 'board.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
```

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
})
```

`apps/web/test/setup.ts`:

```ts
// The session layer persists to IndexedDB; happy-dom has none.
import 'fake-indexeddb/auto'
```

`apps/web/board.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>tlwb</title>
    <link rel="icon" href="/favicon.svg" />
    <link rel="stylesheet" href="/src/styles/tokens.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/board/main.tsx"></script>
  </body>
</html>
```

`apps/web/index.html` (placeholder until Task 15):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>tlwb</title>
    <link rel="stylesheet" href="/src/styles/tokens.css" />
  </head>
  <body>
    <a href="/b/new">Draw now</a>
  </body>
</html>
```

`apps/web/src/styles/tokens.css`:

```css
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/caveat/500.css';
@import '@fontsource/caveat/700.css';

:root {
  --paper: #f7f7f5;
  --surface: #ffffff;
  --border: #e5e4e0;
  --ink: #1a1a1a;
  --muted: #6b6b6b;
  --accent: #ff6b4a;
  --accent-soft: #ffe1d9;
  --agent: #8b7cf6;
  --font-ui: 'Inter', system-ui, sans-serif;
  --font-hand: 'Caveat', cursive;
  --radius: 8px;
  --radius-lg: 12px;
  --shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 4px 16px rgb(0 0 0 / 0.08);
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 40px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  font: 400 14px/1.5 var(--font-ui);
  color: var(--ink);
  background: var(--paper);
}

button,
input,
textarea {
  font: inherit;
  color: inherit;
}
```

`apps/web/src/board/main.tsx` (placeholder until Task 8):

```tsx
document.getElementById('root')?.append('board')
```

- [ ] **Step 2: Write the failing keys test**

`apps/web/test/session/keys.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAliasesTo,
  clearKeys,
  keysFromFragment,
  readAlias,
  readKeys,
  roleOf,
  shareLink,
  tokenOf,
  writeAlias,
  writeKeys,
} from '../../src/board/session/keys'

beforeEach(() => localStorage.clear())

describe('keys', () => {
  it('round-trips through localStorage', () => {
    expect(readKeys('b1')).toBeNull()
    writeKeys('b1', { editKey: 'e', viewKey: 'v' })
    expect(readKeys('b1')).toEqual({ editKey: 'e', viewKey: 'v' })
    clearKeys('b1')
    expect(readKeys('b1')).toBeNull()
  })

  it('ignores a corrupt entry', () => {
    localStorage.setItem('tlwb:keys:b1', '{nope')
    expect(readKeys('b1')).toBeNull()
  })

  it('derives the role and the token', () => {
    expect(roleOf(null)).toBe('local')
    expect(roleOf({ viewKey: 'v' })).toBe('view')
    expect(roleOf({ editKey: 'e', viewKey: 'v' })).toBe('edit')
    expect(tokenOf({ editKey: 'e', viewKey: 'v' })).toBe('e')
    expect(tokenOf({ viewKey: 'v' })).toBe('v')
    expect(tokenOf({})).toBeNull()
  })

  it('reads a key from the fragment', () => {
    expect(keysFromFragment('#edit=abc')).toEqual({ editKey: 'abc' })
    expect(keysFromFragment('#view=abc')).toEqual({ viewKey: 'abc' })
    expect(keysFromFragment('#other=abc')).toBeNull()
    expect(keysFromFragment('')).toBeNull()
  })

  it('builds share links only for the keys it holds', () => {
    const keys = { editKey: 'e', viewKey: 'v' }
    expect(shareLink('https://x', 'b1', keys, 'edit')).toBe(
      'https://x/b/b1#edit=e',
    )
    expect(shareLink('https://x', 'b1', keys, 'view')).toBe(
      'https://x/b/b1#view=v',
    )
    expect(shareLink('https://x', 'b1', { editKey: 'e' }, 'view')).toBeNull()
  })

  it('stores aliases and clears every alias to a board', () => {
    writeAlias('old1', 'new')
    writeAlias('old2', 'new')
    writeAlias('old3', 'other')
    expect(readAlias('old1')).toBe('new')
    clearAliasesTo('new')
    expect(readAlias('old1')).toBeNull()
    expect(readAlias('old2')).toBeNull()
    expect(readAlias('old3')).toBe('other')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @tlwb/web test`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `keys.ts`**

```ts
export interface StoredKeys {
  editKey?: string
  viewKey?: string
}

export type BoardRole = 'local' | 'edit' | 'view'

const KEYS_PREFIX = 'tlwb:keys:'
const ALIAS_PREFIX = 'tlwb:alias:'

export function readKeys(
  boardId: string,
  storage: Storage = localStorage,
): StoredKeys | null {
  const raw = storage.getItem(KEYS_PREFIX + boardId)
  if (!raw) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const keys: StoredKeys = {}
    if ('editKey' in parsed && typeof parsed.editKey === 'string') {
      keys.editKey = parsed.editKey
    }
    if ('viewKey' in parsed && typeof parsed.viewKey === 'string') {
      keys.viewKey = parsed.viewKey
    }
    return keys
  } catch {
    return null
  }
}

export function writeKeys(
  boardId: string,
  keys: StoredKeys,
  storage: Storage = localStorage,
): void {
  storage.setItem(KEYS_PREFIX + boardId, JSON.stringify(keys))
}

export function clearKeys(
  boardId: string,
  storage: Storage = localStorage,
): void {
  storage.removeItem(KEYS_PREFIX + boardId)
}

export function roleOf(keys: StoredKeys | null): BoardRole {
  if (keys?.editKey) {
    return 'edit'
  }
  if (keys?.viewKey) {
    return 'view'
  }
  return 'local'
}

export function tokenOf(keys: StoredKeys): string | null {
  return keys.editKey ?? keys.viewKey ?? null
}

/** `#edit=<key>` or `#view=<key>`; anything else is not ours. */
export function keysFromFragment(hash: string): StoredKeys | null {
  const match = /^#(edit|view)=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!match) {
    return null
  }
  return match[1] === 'edit'
    ? { editKey: match[2] }
    : { viewKey: match[2] }
}

export function shareLink(
  origin: string,
  boardId: string,
  keys: StoredKeys,
  role: 'edit' | 'view',
): string | null {
  const key = role === 'edit' ? keys.editKey : keys.viewKey
  return key ? `${origin}/b/${boardId}#${role}=${key}` : null
}

export function readAlias(
  boardId: string,
  storage: Storage = localStorage,
): string | null {
  return storage.getItem(ALIAS_PREFIX + boardId)
}

export function writeAlias(
  oldId: string,
  newId: string,
  storage: Storage = localStorage,
): void {
  storage.setItem(ALIAS_PREFIX + oldId, newId)
}

export function clearAliasesTo(
  boardId: string,
  storage: Storage = localStorage,
): void {
  const doomed: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key?.startsWith(ALIAS_PREFIX) && storage.getItem(key) === boardId) {
      doomed.push(key)
    }
  }
  for (const key of doomed) {
    storage.removeItem(key)
  }
}
```

- [ ] **Step 5: Run tests, typecheck, and the dev server once**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS. Then `pnpm --filter @tlwb/web dev` and open `http://localhost:5173/b/abc`: the page shows "board". Stop the server.

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "🎉 feat(web): scaffold the web application and its share key storage"
```

---

### Task 4: Recent boards and presence identity

**Files:**
- Create: `apps/web/src/board/session/recents.ts`, `apps/web/src/board/session/identity.ts`, `apps/web/src/board/session/palette.ts`
- Test: `apps/web/test/session/recents.test.ts`, `apps/web/test/session/identity.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // recents.ts
  export interface RecentBoard { id: string; name: string; updatedAt: number }
  export const RECENTS_CAP = 50
  export function listRecents(storage?: Storage): RecentBoard[]
  export function touchRecent(entry: RecentBoard, storage?: Storage): void
  export function removeRecent(id: string, storage?: Storage): void
  // identity.ts
  export interface Identity { name: string; color: string }
  export function loadIdentity(storage?: Storage, random?: () => number): Identity
  export function saveIdentity(identity: Identity, storage?: Storage): void
  // palette.ts
  export const STROKE_COLORS: readonly string[]
  export const FILL_COLORS: readonly (string | null)[]
  export const FONTS: FontConfig  // { hand: 'Caveat, cursive', ui: 'Inter, system-ui, sans-serif' }
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/session/recents.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  listRecents,
  RECENTS_CAP,
  removeRecent,
  touchRecent,
} from '../../src/board/session/recents'

beforeEach(() => localStorage.clear())

describe('recents', () => {
  it('upserts by id and orders most recent first', () => {
    touchRecent({ id: 'a', name: 'A', updatedAt: 1 })
    touchRecent({ id: 'b', name: 'B', updatedAt: 2 })
    touchRecent({ id: 'a', name: 'A2', updatedAt: 3 })
    expect(listRecents()).toEqual([
      { id: 'a', name: 'A2', updatedAt: 3 },
      { id: 'b', name: 'B', updatedAt: 2 },
    ])
  })

  it('caps the list and removes entries', () => {
    for (let i = 0; i <= RECENTS_CAP; i += 1) {
      touchRecent({ id: `b${i}`, name: 'x', updatedAt: i })
    }
    expect(listRecents()).toHaveLength(RECENTS_CAP)
    expect(listRecents()[0]?.id).toBe(`b${RECENTS_CAP}`)
    removeRecent(`b${RECENTS_CAP}`)
    expect(listRecents()[0]?.id).toBe(`b${RECENTS_CAP - 1}`)
  })

  it('survives a corrupt entry', () => {
    localStorage.setItem('tlwb:recents', '[{"id":1}]')
    expect(listRecents()).toEqual([])
  })
})
```

`apps/web/test/session/identity.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { loadIdentity, saveIdentity } from '../../src/board/session/identity'
import { STROKE_COLORS } from '../../src/board/session/palette'

beforeEach(() => localStorage.clear())

describe('identity', () => {
  it('draws a name and a marker color once and keeps them', () => {
    const first = loadIdentity(localStorage, () => 0)
    expect(first.name).toBe('Curious Otter')
    expect(STROKE_COLORS.slice(1)).toContain(first.color)
    expect(loadIdentity(localStorage, () => 0.99)).toEqual(first)
  })

  it('saves a renamed identity', () => {
    loadIdentity()
    saveIdentity({ name: 'Ada', color: '#1971C2' })
    expect(loadIdentity()).toEqual({ name: 'Ada', color: '#1971C2' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`palette.ts`:

```ts
import type { FontConfig } from '@tlwb/engine'

/** Ink first, then the six markers of the product design. */
export const STROKE_COLORS: readonly string[] = [
  '#1A1A1A',
  '#E03131',
  '#F76707',
  '#2F9E44',
  '#1971C2',
  '#7048E8',
  '#F59F00',
]

/** No fill, then the pastel of each marker, same order. */
export const FILL_COLORS: readonly (string | null)[] = [
  null,
  '#FFC9C9',
  '#FFD8A8',
  '#B2F2BB',
  '#A5D8FF',
  '#D0BFFF',
  '#FFEC99',
]

export const FONTS: FontConfig = {
  hand: 'Caveat, cursive',
  ui: 'Inter, system-ui, sans-serif',
}
```

`recents.ts`:

```ts
export interface RecentBoard {
  id: string
  name: string
  updatedAt: number
}

export const RECENTS_CAP = 50
const KEY = 'tlwb:recents'

function isRecent(value: unknown): value is RecentBoard {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'updatedAt' in value &&
    typeof value.updatedAt === 'number'
  )
}

export function listRecents(storage: Storage = localStorage): RecentBoard[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) && parsed.every(isRecent) ? parsed : []
  } catch {
    return []
  }
}

export function touchRecent(
  entry: RecentBoard,
  storage: Storage = localStorage,
): void {
  const others = listRecents(storage).filter((item) => item.id !== entry.id)
  const next = [entry, ...others]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENTS_CAP)
  storage.setItem(KEY, JSON.stringify(next))
}

export function removeRecent(id: string, storage: Storage = localStorage): void {
  storage.setItem(
    KEY,
    JSON.stringify(listRecents(storage).filter((item) => item.id !== id)),
  )
}
```

`identity.ts`:

```ts
import { STROKE_COLORS } from './palette'

export interface Identity {
  name: string
  color: string
}

const KEY = 'tlwb:identity'
const ADJECTIVES = ['Curious', 'Quiet', 'Brave', 'Sunny', 'Clever', 'Gentle']
const ANIMALS = ['Otter', 'Fox', 'Heron', 'Panda', 'Lynx', 'Koala']
const MARKERS = STROKE_COLORS.slice(1)

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T
}

export function loadIdentity(
  storage: Storage = localStorage,
  random: () => number = Math.random,
): Identity {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? 'null')
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'name' in parsed &&
      typeof parsed.name === 'string' &&
      'color' in parsed &&
      typeof parsed.color === 'string'
    ) {
      return { name: parsed.name, color: parsed.color }
    }
  } catch {
    // A corrupt entry is replaced below.
  }
  const identity = {
    name: `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`,
    color: pick(MARKERS, random),
  }
  saveIdentity(identity, storage)
  return identity
}

export function saveIdentity(
  identity: Identity,
  storage: Storage = localStorage,
): void {
  storage.setItem(KEY, JSON.stringify(identity))
}
```

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): index recent boards and draw a presence identity"
```

---

### Task 5: HTTP client for the collaboration server

**Files:**
- Create: `apps/web/src/board/session/server.ts`
- Test: `apps/web/test/session/server.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface HostedBoard { boardId: string; editKey: string; viewKey: string }
  export class ServerError extends Error { readonly status: number }
  export function createHostedBoard(fetchFn?: typeof fetch): Promise<HostedBoard>
  export function uploadAsset(boardId: string, hash: string, blob: Blob, editKey: string, fetchFn?: typeof fetch): Promise<void>
  export function fetchAsset(boardId: string, hash: string, token: string, fetchFn?: typeof fetch): Promise<Blob | null>
  export function socketUrl(loc?: { protocol: string; host: string }): string
  ```

- [ ] **Step 1: Write the failing test**

`apps/web/test/session/server.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  createHostedBoard,
  fetchAsset,
  ServerError,
  socketUrl,
  uploadAsset,
} from '../../src/board/session/server'

function respond(status: number, body?: unknown, type = 'application/json') {
  return vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': type },
    }),
  ) as unknown as typeof fetch
}

describe('server client', () => {
  it('creates a hosted board with a relative POST', async () => {
    const fetchFn = respond(201, { boardId: 'b', editKey: 'e', viewKey: 'v' })
    expect(await createHostedBoard(fetchFn)).toEqual({
      boardId: 'b',
      editKey: 'e',
      viewKey: 'v',
    })
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe('/api/boards')
    expect(init.method).toBe('POST')
  })

  it('throws a ServerError carrying the status', async () => {
    await expect(createHostedBoard(respond(429))).rejects.toBeInstanceOf(
      ServerError,
    )
    await expect(createHostedBoard(respond(429))).rejects.toMatchObject({
      status: 429,
    })
  })

  it('uploads an asset with the edit key and its content type', async () => {
    const fetchFn = respond(201)
    await uploadAsset('b', 'h', new Blob(['x'], { type: 'image/png' }), 'e', fetchFn)
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe('/api/boards/b/assets/h')
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer e')
    expect(new Headers(init.headers).get('content-type')).toBe('image/png')
  })

  it('fetches an asset and answers null on 404', async () => {
    const found = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    ) as unknown as typeof fetch
    const blob = await fetchAsset('b', 'h', 'v', found)
    expect(blob?.type).toBe('image/png')
    expect(await fetchAsset('b', 'h', 'v', respond(404))).toBeNull()
  })

  it('derives the socket url from the page origin', () => {
    expect(socketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    )
    expect(socketUrl({ protocol: 'https:', host: 'tlwb.app' })).toBe(
      'wss://tlwb.app/ws',
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/session/server.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `server.ts`**

```ts
export interface HostedBoard {
  boardId: string
  editKey: string
  viewKey: string
}

export class ServerError extends Error {
  readonly status: number

  constructor(status: number, message = `server answered ${status}`) {
    super(message)
    this.status = status
  }
}

export async function createHostedBoard(
  fetchFn: typeof fetch = fetch,
): Promise<HostedBoard> {
  const response = await fetchFn('/api/boards', { method: 'POST' })
  if (response.status !== 201) {
    throw new ServerError(response.status)
  }
  const body = (await response.json()) as HostedBoard
  return { boardId: body.boardId, editKey: body.editKey, viewKey: body.viewKey }
}

export async function uploadAsset(
  boardId: string,
  hash: string,
  blob: Blob,
  editKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchFn(`/api/boards/${boardId}/assets/${hash}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${editKey}`,
      'content-type': blob.type,
    },
    body: blob,
  })
  if (response.status !== 200 && response.status !== 201) {
    throw new ServerError(response.status)
  }
}

export async function fetchAsset(
  boardId: string,
  hash: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<Blob | null> {
  const response = await fetchFn(`/api/boards/${boardId}/assets/${hash}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new ServerError(response.status)
  }
  return response.blob()
}

export function socketUrl(
  loc: { protocol: string; host: string } = location,
): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`
}
```

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): add the HTTP client of the collaboration server"
```

---

### Task 6: Image cache for the renderer

**Files:**
- Create: `apps/web/src/board/session/image-cache.ts`
- Test: `apps/web/test/session/image-cache.test.ts`

**Interfaces:**
- Consumes: `AssetStore` from `@tlwb/store-yjs`; `PendingImage` from `@tlwb/engine`.
- Produces:
  ```ts
  export interface DecodedImage { source: CanvasImageSource; width: number; height: number }
  export interface ImageCacheDeps {
    assets: AssetStore
    fetchRemote: (hash: string) => Promise<Blob | null>   // null when local only
    upload: ((hash: string, blob: Blob) => Promise<void>) | null  // null when local only
    decode?: (blob: Blob) => Promise<DecodedImage>          // default createImageBitmap
    onLoaded: () => void
  }
  export interface ImageCache {
    resolve(hash: string): CanvasImageSource | null   // synchronous; starts a load on a miss
    resolveUrl(hash: string): string | null           // data URL for the SVG export
    stage(blob: Blob): Promise<PendingImage>           // store, upload, decode, cache
    setUpload(upload: ImageCacheDeps['upload']): void
    setFetchRemote(fetchRemote: ImageCacheDeps['fetchRemote']): void
    setAssets(assets: AssetStore): void                // the migration swaps the local store
    destroy(): void
  }
  export function createImageCache(deps: ImageCacheDeps): ImageCache
  export function blobToDataUrl(blob: Blob): Promise<string>
  ```

- [ ] **Step 1: Write the failing test**

`apps/web/test/session/image-cache.test.ts`:

```ts
import { createAssetStore } from '@tlwb/store-yjs'
import { describe, expect, it, vi } from 'vitest'
import {
  blobToDataUrl,
  createImageCache,
} from '../../src/board/session/image-cache'

const decode = async (blob: Blob) => ({
  source: { blob } as unknown as CanvasImageSource,
  width: 10,
  height: 20,
})

function png(byte: number) {
  return new Blob([new Uint8Array([byte])], { type: 'image/png' })
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('image cache', () => {
  it('stages a blob: stores, uploads, decodes, and answers synchronously after', async () => {
    const assets = createAssetStore('cache-stage')
    const upload = vi.fn(async () => undefined)
    const onLoaded = vi.fn()
    const cache = createImageCache({
      assets,
      fetchRemote: async () => null,
      upload,
      decode,
      onLoaded,
    })
    const pending = await cache.stage(png(1))
    expect(pending.width).toBe(10)
    expect(pending.height).toBe(20)
    expect(upload).toHaveBeenCalledWith(pending.assetHash, expect.any(Blob))
    expect(cache.resolve(pending.assetHash)).not.toBeNull()
    expect(cache.resolveUrl(pending.assetHash)).toMatch(/^data:image\/png;base64,/)
    expect(await assets.get(pending.assetHash)).toBeDefined()
    cache.destroy()
    await assets.delete()
  })

  it('does not store when the upload fails', async () => {
    const assets = createAssetStore('cache-upload-fails')
    const cache = createImageCache({
      assets,
      fetchRemote: async () => null,
      upload: async () => {
        throw new Error('415')
      },
      decode,
      onLoaded: () => undefined,
    })
    await expect(cache.stage(png(2))).rejects.toThrow('415')
    cache.destroy()
    await assets.delete()
  })

  it('loads a miss from the local store, then from the server, and notifies', async () => {
    const assets = createAssetStore('cache-miss')
    const hash = await assets.put(png(3))
    const remote = vi.fn(async () => png(4))
    const onLoaded = vi.fn()
    const cache = createImageCache({
      assets,
      fetchRemote: remote,
      upload: null,
      decode,
      onLoaded,
    })
    expect(cache.resolve(hash)).toBeNull()
    await settled()
    await settled()
    expect(cache.resolve(hash)).not.toBeNull()
    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(remote).not.toHaveBeenCalled()

    expect(cache.resolve('missing')).toBeNull()
    await settled()
    await settled()
    expect(remote).toHaveBeenCalledWith('missing')
    expect(cache.resolve('missing')).not.toBeNull()
    expect(await assets.get('missing')).toBeDefined()
    cache.destroy()
    await assets.delete()
  })

  it('encodes a blob as a data url', async () => {
    expect(await blobToDataUrl(png(255))).toBe('data:image/png;base64,/w==')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/session/image-cache.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `image-cache.ts`**

```ts
import type { PendingImage } from '@tlwb/engine'
import type { AssetStore } from '@tlwb/store-yjs'

export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
}

export interface ImageCacheDeps {
  assets: AssetStore
  /** The server copy; null when the board is local or the asset is unknown. */
  fetchRemote: (hash: string) => Promise<Blob | null>
  /** Null on a local board: nothing to upload to. */
  upload: ((hash: string, blob: Blob) => Promise<void>) | null
  decode?: (blob: Blob) => Promise<DecodedImage>
  /** The renderer has no idea an image finished loading; the host repaints. */
  onLoaded: () => void
}

export interface ImageCache {
  resolve(hash: string): CanvasImageSource | null
  resolveUrl(hash: string): string | null
  stage(blob: Blob): Promise<PendingImage>
  setUpload(upload: ImageCacheDeps['upload']): void
  setFetchRemote(fetchRemote: ImageCacheDeps['fetchRemote']): void
  setAssets(assets: AssetStore): void
  destroy(): void
}

interface Entry {
  source: CanvasImageSource
  dataUrl: string
}

async function decodeWithBitmap(blob: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(blob)
  return { source: bitmap, width: bitmap.width, height: bitmap.height }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

export function createImageCache(deps: ImageCacheDeps): ImageCache {
  const decode = deps.decode ?? decodeWithBitmap
  let upload = deps.upload
  let fetchRemote = deps.fetchRemote
  let assets = deps.assets
  const entries = new Map<string, Entry>()
  const loading = new Set<string>()
  let destroyed = false

  async function remember(hash: string, blob: Blob): Promise<DecodedImage> {
    const decoded = await decode(blob)
    entries.set(hash, {
      source: decoded.source,
      dataUrl: await blobToDataUrl(blob),
    })
    return decoded
  }

  async function load(hash: string): Promise<void> {
    let blob = await assets.get(hash)
    if (!blob) {
      const remote = await fetchRemote(hash)
      if (!remote) {
        return
      }
      await assets.put(remote)
      blob = remote
    }
    await remember(hash, blob)
    if (!destroyed) {
      deps.onLoaded()
    }
  }

  return {
    resolve(hash) {
      const entry = entries.get(hash)
      if (entry) {
        return entry.source
      }
      if (!loading.has(hash)) {
        loading.add(hash)
        load(hash)
          .catch(() => undefined)
          .finally(() => loading.delete(hash))
      }
      return null
    },
    resolveUrl(hash) {
      return entries.get(hash)?.dataUrl ?? null
    },
    async stage(blob) {
      const hash = await assets.put(blob)
      if (upload) {
        await upload(hash, blob)
      }
      const decoded = await remember(hash, blob)
      return { assetHash: hash, width: decoded.width, height: decoded.height }
    },
    setUpload(next) {
      upload = next
    },
    setFetchRemote(next) {
      fetchRemote = next
    },
    setAssets(next) {
      assets = next
    },
    destroy() {
      destroyed = true
      entries.clear()
    },
  }
}
```

Note on the second test: the blob is stored before the upload is attempted, which the spec allows ("no element is created"); the orphaned local blob is harmless. The test name says "does not store" for the element, not the blob: rename it to `'rejects when the upload fails'` to keep it honest.

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): cache decoded images for the renderer and the exports"
```

---

### Task 7: The board session

**Files:**
- Create: `apps/web/src/board/session/board-session.ts`
- Test: `apps/web/test/session/board-session.test.ts`

**Interfaces:**
- Consumes: `createBoardDoc`, `createYjsBoardStore`, `persistBoard`, `createAssetStore`, `createLocalAwareness`, `createPresence`, `connectBoard` from `@tlwb/store-yjs`; `readKeys`, `writeKeys`, `roleOf`, `tokenOf` from `keys.ts`; `touchRecent` from `recents.ts`; `Identity`; `socketUrl`, `fetchAsset`, `uploadAsset` from `server.ts`; `createImageCache`.
- Produces:
  ```ts
  export type BoardDoc = ReturnType<typeof createBoardDoc>
  export type StorageMode = 'persistent' | 'memory'
  export interface SessionSnapshot {
    boardId: string
    role: BoardRole
    storage: StorageMode
    status: ConnectionStatus | 'local'
    closeCode: number | null
  }
  export interface HostingHandoff {
    boardId: string
    keys: StoredKeys
    persistence: BoardPersistence
    assets: AssetStore
  }
  export interface BoardSessionOptions {
    boardId: string
    fresh: boolean
    identity: Identity
    connect?: typeof connectBoard
    storage?: Storage
    now?: () => number
  }
  export interface BoardSession {
    readonly doc: BoardDoc
    readonly store: BoardStore
    readonly images: ImageCache
    getSnapshot(): SessionSnapshot
    subscribe(listener: () => void): () => void
    keys(): StoredKeys | null
    assets(): AssetStore
    persistence(): BoardPersistence | null
    presence(): Presence
    connection(): BoardConnection | null
    setIdentity(identity: Identity): void
    adoptHosting(handoff: HostingHandoff): void
    becomeViewer(): void
    forgetKeys(): void
    destroy(): Promise<void>
  }
  export async function openBoardSession(options: BoardSessionOptions): Promise<BoardSession | 'not-found'>
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/session/board-session.test.ts`:

```ts
import { createElement } from '@tlwb/engine'
import type { BoardConnection, ConnectOptions } from '@tlwb/store-yjs'
import { createLocalAwareness } from '@tlwb/store-yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openBoardSession } from '../../src/board/session/board-session'
import { writeKeys } from '../../src/board/session/keys'
import { listRecents } from '../../src/board/session/recents'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

function fakeConnect() {
  const calls: ConnectOptions[] = []
  const closeListeners = new Set<(code: number | null) => void>()
  const connect = vi.fn((doc, options: ConnectOptions): BoardConnection => {
    calls.push(options)
    return {
      provider: {} as never,
      awareness: createLocalAwareness(doc),
      getStatus: () => 'connecting',
      subscribeStatus: () => () => undefined,
      subscribeClose: (listener) => {
        closeListeners.add(listener)
        return () => closeListeners.delete(listener)
      },
      reconnect: vi.fn(),
      destroy: vi.fn(),
    }
  })
  return {
    connect,
    calls,
    close: (code: number) => {
      for (const listener of closeListeners) listener(code)
    },
  }
}

describe('openBoardSession', () => {
  it('creates a fresh local board with meta, presence, and a recents entry', async () => {
    const session = await openBoardSession({
      boardId: 'fresh1',
      fresh: true,
      identity,
      now: () => 42,
    })
    if (session === 'not-found') throw new Error('unexpected')
    expect(session.getSnapshot()).toEqual({
      boardId: 'fresh1',
      role: 'local',
      storage: 'persistent',
      status: 'local',
      closeCode: null,
    })
    expect(session.store.getMeta()).toEqual({ name: 'Untitled', createdAt: 42 })
    expect(session.presence().getPeers()).toEqual([])
    expect(listRecents()[0]).toMatchObject({ id: 'fresh1', name: 'Untitled' })
    await session.destroy()
  })

  it('reopens a board from IndexedDB and answers not-found for an unknown one', async () => {
    const first = await openBoardSession({ boardId: 'again', fresh: true, identity })
    if (first === 'not-found') throw new Error('unexpected')
    first.store.applyChanges([
      { kind: 'create', element: createElement('rectangle', { index: 'a0' }) },
    ])
    await first.destroy()

    const second = await openBoardSession({ boardId: 'again', fresh: false, identity })
    if (second === 'not-found') throw new Error('unexpected')
    expect(second.store.listElements()).toHaveLength(1)
    await second.destroy()

    expect(
      await openBoardSession({ boardId: 'nowhere', fresh: false, identity }),
    ).toBe('not-found')
  })

  it('connects a hosted board with its token and the view role', async () => {
    writeKeys('hosted', { viewKey: 'v' })
    const fake = fakeConnect()
    const session = await openBoardSession({
      boardId: 'hosted',
      fresh: false,
      identity,
      connect: fake.connect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    expect(fake.calls[0]).toMatchObject({ boardId: 'hosted', token: 'v' })
    expect(fake.calls[0]?.url).toMatch(/^wss?:\/\/.+\/ws$/)
    expect(session.getSnapshot().role).toBe('view')
    expect(session.getSnapshot().status).toBe('connecting')
    await session.destroy()
  })

  it('reports close codes, demotes to viewer on 4403, and forgets keys', async () => {
    writeKeys('hosted2', { editKey: 'e', viewKey: 'v' })
    const fake = fakeConnect()
    const session = await openBoardSession({
      boardId: 'hosted2',
      fresh: false,
      identity,
      connect: fake.connect,
    })
    if (session === 'not-found') throw new Error('unexpected')
    const seen: number[] = []
    session.subscribe(() => {
      const code = session.getSnapshot().closeCode
      if (code !== null) seen.push(code)
    })
    fake.close(4422)
    expect(seen).toEqual([4422])

    session.becomeViewer()
    expect(session.getSnapshot().role).toBe('view')
    expect(session.keys()).toEqual({ viewKey: 'e' })

    session.forgetKeys()
    expect(session.keys()).toBeNull()
    expect(session.getSnapshot().role).toBe('local')
    await session.destroy()
  })

  it('adopts a hosting handoff and starts the connection', async () => {
    const session = await openBoardSession({ boardId: 'pre', fresh: true, identity })
    if (session === 'not-found') throw new Error('unexpected')
    const fake = fakeConnect()
    const hosted = await openBoardSession({
      boardId: 'other',
      fresh: true,
      identity,
      connect: fake.connect,
    })
    if (hosted === 'not-found') throw new Error('unexpected')
    const persistence = hosted.persistence()
    const assets = hosted.assets()
    if (!persistence) throw new Error('unexpected')
    // Reuse another session's databases as a stand-in for the migration's.
    ;(session as unknown as { connectFn: typeof fake.connect }).connectFn =
      fake.connect
    session.adoptHosting({
      boardId: 'new1',
      keys: { editKey: 'e', viewKey: 'v' },
      persistence,
      assets,
    })
    expect(session.getSnapshot()).toMatchObject({
      boardId: 'new1',
      role: 'edit',
      status: 'connecting',
    })
    expect(fake.calls.at(-1)).toMatchObject({ boardId: 'new1', token: 'e' })
    await session.destroy()
    await hosted.destroy()
  })
})
```

The last test reaches into `connectFn` to swap the connector after opening; keep that property name on the returned object (it is documented in the implementation as the seam for tests).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/session/board-session.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `board-session.ts`**

```ts
import type { BoardStore } from '@tlwb/engine'
import type {
  AssetStore,
  BoardConnection,
  BoardPersistence,
  ConnectionStatus,
  Presence,
} from '@tlwb/store-yjs'
import {
  connectBoard,
  createAssetStore,
  createBoardDoc,
  createLocalAwareness,
  createPresence,
  createYjsBoardStore,
  persistBoard,
} from '@tlwb/store-yjs'
import type { Identity } from './identity'
import { createImageCache, type ImageCache } from './image-cache'
import {
  type BoardRole,
  clearKeys,
  readKeys,
  roleOf,
  type StoredKeys,
  tokenOf,
  writeKeys,
} from './keys'
import { touchRecent } from './recents'
import { fetchAsset, socketUrl, uploadAsset } from './server'

export type BoardDoc = ReturnType<typeof createBoardDoc>
export type StorageMode = 'persistent' | 'memory'

export interface SessionSnapshot {
  boardId: string
  role: BoardRole
  storage: StorageMode
  status: ConnectionStatus | 'local'
  closeCode: number | null
}

export interface HostingHandoff {
  boardId: string
  keys: StoredKeys
  persistence: BoardPersistence
  assets: AssetStore
}

export interface BoardSessionOptions {
  boardId: string
  /** Just created from `/b/new`: write the meta instead of probing. */
  fresh: boolean
  identity: Identity
  connect?: typeof connectBoard
  storage?: Storage
  now?: () => number
}

export interface BoardSession {
  readonly doc: BoardDoc
  readonly store: BoardStore
  readonly images: ImageCache
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  keys(): StoredKeys | null
  assets(): AssetStore
  persistence(): BoardPersistence | null
  presence(): Presence
  connection(): BoardConnection | null
  setIdentity(identity: Identity): void
  /** The migration hands over the hosted databases and keys. */
  adoptHosting(handoff: HostingHandoff): void
  /** The server refused a write (4403): keep the key as a view key. */
  becomeViewer(): void
  /** The server no longer knows this link (4401, 4404). */
  forgetKeys(): void
  destroy(): Promise<void>
}

const RECENTS_DEBOUNCE_MS = 1_000

export async function openBoardSession(
  options: BoardSessionOptions,
): Promise<BoardSession | 'not-found'> {
  const storage = options.storage ?? localStorage
  const now = options.now ?? Date.now
  const doc = createBoardDoc()
  const store = createYjsBoardStore(doc)
  let boardId = options.boardId
  let keys = readKeys(boardId, storage)
  let persistence: BoardPersistence | null = persistBoard(doc, boardId)
  let storageMode: StorageMode = 'persistent'
  try {
    await persistence.whenLoaded
  } catch {
    persistence = null
    storageMode = 'memory'
  }

  if (options.fresh) {
    store.setMeta({ name: 'Untitled', createdAt: now() })
  } else if (!keys && store.getMeta().createdAt === 0) {
    // Nothing stored here and no key to fetch it with.
    await persistence?.clear()
    return 'not-found'
  }

  let assets = createAssetStore(boardId)
  let identity = options.identity
  let connectFn = options.connect ?? connectBoard
  let connection: BoardConnection | null = null
  let presence: Presence
  let localAwareness: ReturnType<typeof createLocalAwareness> | null = null
  let status: ConnectionStatus | 'local' = 'local'
  let closeCode: number | null = null
  let unsubscribeConnection: () => void = () => undefined
  const listeners = new Set<() => void>()
  let snapshot: SessionSnapshot

  const notify = (): void => {
    snapshot = {
      boardId,
      role: roleOf(keys),
      storage: storageMode,
      status,
      closeCode,
    }
    for (const listener of listeners) {
      listener()
    }
  }

  const images = createImageCache({
    assets,
    fetchRemote: (hash) => remoteFetcher(hash),
    upload: null,
    onLoaded: () => notify(),
  })

  function remoteFetcher(hash: string): Promise<Blob | null> {
    const token = keys ? tokenOf(keys) : null
    return token ? fetchAsset(boardId, hash, token) : Promise.resolve(null)
  }

  function refreshUpload(): void {
    const editKey = keys?.editKey
    images.setUpload(
      editKey
        ? (hash, blob) => uploadAsset(boardId, hash, blob, editKey)
        : null,
    )
  }

  function attachPresence(awareness: Parameters<typeof createPresence>[0]) {
    presence = createPresence(awareness, { ...identity, isAgent: false })
  }

  function startConnection(): void {
    const token = keys ? tokenOf(keys) : null
    if (!token) {
      return
    }
    unsubscribeConnection()
    presence?.destroy()
    localAwareness?.destroy()
    localAwareness = null
    connection = connectFn(doc, { url: socketUrl(), boardId, token })
    status = connection.getStatus()
    const stopStatus = connection.subscribeStatus((next) => {
      status = next
      notify()
    })
    const stopClose = connection.subscribeClose((code) => {
      closeCode = code
      notify()
    })
    unsubscribeConnection = () => {
      stopStatus()
      stopClose()
    }
    attachPresence(connection.awareness)
  }

  if (keys) {
    startConnection()
  } else {
    localAwareness = createLocalAwareness(doc)
    attachPresence(localAwareness)
  }
  refreshUpload()

  let recentsTimer: ReturnType<typeof setTimeout> | null = null
  const touch = (): void => {
    touchRecent(
      { id: boardId, name: store.getMeta().name, updatedAt: now() },
      storage,
    )
  }
  touch()
  const unsubscribeStore = store.subscribe(() => {
    if (recentsTimer) {
      clearTimeout(recentsTimer)
    }
    recentsTimer = setTimeout(touch, RECENTS_DEBOUNCE_MS)
  })

  notify()

  const session = {
    doc,
    store,
    images,
    // Test seam: swapped by the adoption test.
    connectFn,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    keys: () => keys,
    assets: () => assets,
    persistence: () => persistence,
    presence: () => presence,
    connection: () => connection,
    setIdentity(next: Identity) {
      identity = next
      presence.destroy()
      const awareness = connection?.awareness ?? localAwareness
      if (awareness) {
        attachPresence(awareness)
      }
      notify()
    },
    adoptHosting(handoff: HostingHandoff) {
      connectFn = session.connectFn
      boardId = handoff.boardId
      keys = handoff.keys
      persistence = handoff.persistence
      assets = handoff.assets
      images.setAssets(assets)
      images.setFetchRemote((hash) => remoteFetcher(hash))
      refreshUpload()
      closeCode = null
      startConnection()
      touch()
      notify()
    },
    becomeViewer() {
      if (keys?.editKey) {
        keys = { viewKey: keys.editKey }
        writeKeys(boardId, keys, storage)
        refreshUpload()
        notify()
      }
    },
    forgetKeys() {
      keys = null
      clearKeys(boardId, storage)
      refreshUpload()
      notify()
    },
    async destroy() {
      if (recentsTimer) {
        clearTimeout(recentsTimer)
      }
      unsubscribeStore()
      unsubscribeConnection()
      presence.destroy()
      connection?.destroy()
      connection?.awareness.destroy()
      localAwareness?.destroy()
      images.destroy()
      await persistence?.destroy()
      await assets.destroy()
    },
  }
  return session
}
```

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS. If the typecheck complains that `presence` is used before assignment, initialize it with `let presence!: Presence`.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): open a board session with persistence, presence, and connection"
```

---

### Task 8: The local to hosted migration

**Files:**
- Create: `apps/web/src/board/session/share.ts`
- Test: `apps/web/test/session/share.test.ts`

**Interfaces:**
- Consumes: `BoardSession` (Task 7), `createHostedBoard`, `uploadAsset` (Task 5), `persistBoard`, `createAssetStore` (`@tlwb/store-yjs`), `writeKeys`, `writeAlias` (Task 3), `removeRecent`, `touchRecent` (Task 4).
- Produces:
  ```ts
  export interface ShareDeps {
    createHostedBoard?: typeof createHostedBoard
    uploadAsset?: typeof uploadAsset
    history?: Pick<History, 'replaceState'>
    storage?: Storage
    now?: () => number
  }
  export async function shareBoard(session: BoardSession, deps?: ShareDeps): Promise<StoredKeys>
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/test/session/share.test.ts`:

```ts
import { createElement } from '@tlwb/engine'
import { createAssetStore, createLocalAwareness } from '@tlwb/store-yjs'
import type { BoardConnection } from '@tlwb/store-yjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openBoardSession } from '../../src/board/session/board-session'
import { readAlias, readKeys } from '../../src/board/session/keys'
import { listRecents } from '../../src/board/session/recents'
import { shareBoard } from '../../src/board/session/share'

const identity = { name: 'Ada', color: '#1971C2' }
const hosted = { boardId: 'srv1', editKey: 'e', viewKey: 'v' }

beforeEach(() => localStorage.clear())

const connect = vi.fn(
  (doc): BoardConnection => ({
    provider: {} as never,
    awareness: createLocalAwareness(doc),
    getStatus: () => 'connecting',
    subscribeStatus: () => () => undefined,
    subscribeClose: () => () => undefined,
    reconnect: () => undefined,
    destroy: () => undefined,
  }),
)

async function localBoard(id: string) {
  const session = await openBoardSession({ boardId: id, fresh: true, identity, connect })
  if (session === 'not-found') throw new Error('unexpected')
  const hash = await session.assets().put(
    new Blob([new Uint8Array([9])], { type: 'image/png' }),
  )
  session.store.applyChanges([
    { kind: 'create', element: createElement('image', { index: 'a0', assetHash: hash }) },
  ])
  return { session, hash }
}

describe('shareBoard', () => {
  it('moves the board to the server id, uploads assets, and rewrites local state', async () => {
    const { session, hash } = await localBoard('loc1')
    const history = { replaceState: vi.fn() }
    const uploadAsset = vi.fn(async () => undefined)
    const keys = await shareBoard(session, {
      createHostedBoard: async () => hosted,
      uploadAsset,
      history,
      now: () => 7,
    })

    expect(keys).toEqual({ editKey: 'e', viewKey: 'v' })
    expect(uploadAsset).toHaveBeenCalledWith('srv1', hash, expect.any(Blob), 'e')
    expect(session.getSnapshot()).toMatchObject({ boardId: 'srv1', role: 'edit' })
    expect(readKeys('srv1')).toEqual(keys)
    expect(readAlias('loc1')).toBe('srv1')
    expect(listRecents().map((r) => r.id)).toEqual(['srv1'])
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/b/srv1')
    expect(await session.assets().get(hash)).toBeDefined()
    expect(connect).toHaveBeenCalled()
    await session.destroy()

    // The hosted database holds the board; the local one is gone.
    const reopened = await openBoardSession({ boardId: 'srv1', fresh: false, identity, connect })
    if (reopened === 'not-found') throw new Error('unexpected')
    expect(reopened.store.listElements()).toHaveLength(1)
    await reopened.destroy()
    expect(await openBoardSession({ boardId: 'loc1', fresh: false, identity })).toBe('not-found')
  })

  it('leaves everything intact when the server refuses', async () => {
    const { session } = await localBoard('loc2')
    await expect(
      shareBoard(session, {
        createHostedBoard: async () => {
          throw new Error('429')
        },
        history: { replaceState: vi.fn() },
      }),
    ).rejects.toThrow('429')
    expect(session.getSnapshot()).toMatchObject({ boardId: 'loc2', role: 'local' })
    expect(readAlias('loc2')).toBeNull()
    await session.destroy()
  })

  it('rolls back the hosted databases when an upload fails', async () => {
    const { session, hash } = await localBoard('loc3')
    await expect(
      shareBoard(session, {
        createHostedBoard: async () => ({ ...hosted, boardId: 'srv3' }),
        uploadAsset: async () => {
          throw new Error('415')
        },
        history: { replaceState: vi.fn() },
      }),
    ).rejects.toThrow('415')
    expect(session.getSnapshot()).toMatchObject({ boardId: 'loc3', role: 'local' })
    expect(readKeys('srv3')).toBeNull()
    const leftover = createAssetStore('srv3')
    expect(await leftover.get(hash)).toBeUndefined()
    await leftover.delete()
    await session.destroy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/session/share.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `share.ts`**

```ts
import { createAssetStore, persistBoard } from '@tlwb/store-yjs'
import type { BoardSession } from './board-session'
import { type StoredKeys, writeAlias, writeKeys } from './keys'
import { removeRecent, touchRecent } from './recents'
import {
  createHostedBoard as defaultCreate,
  uploadAsset as defaultUpload,
} from './server'

export interface ShareDeps {
  createHostedBoard?: typeof defaultCreate
  uploadAsset?: typeof defaultUpload
  history?: Pick<History, 'replaceState'>
  storage?: Storage
  now?: () => number
}

/**
 * Turns a local board into a hosted one. Nothing local changes before
 * the server has answered, and a failed upload removes what was written
 * under the new id, so the board is either fully moved or untouched.
 */
export async function shareBoard(
  session: BoardSession,
  deps: ShareDeps = {},
): Promise<StoredKeys> {
  const createHostedBoard = deps.createHostedBoard ?? defaultCreate
  const uploadAsset = deps.uploadAsset ?? defaultUpload
  const history = deps.history ?? window.history
  const storage = deps.storage ?? localStorage
  const now = deps.now ?? Date.now
  const oldId = session.getSnapshot().boardId

  const hosted = await createHostedBoard()
  const keys: StoredKeys = { editKey: hosted.editKey, viewKey: hosted.viewKey }

  const persistence = persistBoard(session.doc, hosted.boardId)
  const assets = createAssetStore(hosted.boardId)
  try {
    await persistence.whenLoaded
    const hashes = new Set(
      session.store
        .listElements()
        .flatMap((element) =>
          element.type === 'image' ? [element.assetHash] : [],
        ),
    )
    for (const hash of hashes) {
      const blob = await session.assets().get(hash)
      if (!blob) {
        continue
      }
      await uploadAsset(hosted.boardId, hash, blob, hosted.editKey)
      await assets.put(blob)
    }
  } catch (error) {
    await persistence.clear()
    await assets.delete()
    throw error
  }

  writeKeys(hosted.boardId, keys, storage)
  writeAlias(oldId, hosted.boardId, storage)
  removeRecent(oldId, storage)
  touchRecent(
    { id: hosted.boardId, name: session.store.getMeta().name, updatedAt: now() },
    storage,
  )
  const oldPersistence = session.persistence()
  const oldAssets = session.assets()
  session.adoptHosting({ boardId: hosted.boardId, keys, persistence, assets })
  await oldPersistence?.clear()
  await oldAssets.delete()
  history.replaceState(null, '', `/b/${hosted.boardId}`)
  return keys
}
```

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): migrate a local board to a hosted one on share"
```

---

### Task 9: React shell, toolbar, and zoom controls

**Files:**
- Create: `apps/web/src/board/main.tsx` (replace the placeholder), `apps/web/src/board/board.css`
- Create: `apps/web/src/board/hooks/use-session.ts`, `use-editor-state.ts`, `use-peers.ts`
- Create: `apps/web/src/board/components/board-app.tsx`, `toolbar.tsx`, `toolbar.css`, `zoom-controls.tsx`, `zoom-controls.css`, `notice.tsx`, `notice.css`, `not-found.tsx`
- Test: `apps/web/test/components/toolbar.test.tsx`

**Interfaces:**
- Consumes: `openBoardSession`, `keys.ts`, `identity.ts`, `FONTS`, `createEditor`, `Editor`, `EditorState`, `ToolType`.
- Produces:
  ```ts
  // hooks
  export function useSession(session: BoardSession): SessionSnapshot
  export function useEditorState(editor: Editor): EditorState
  export function usePeers(session: BoardSession): Peer[]
  // components
  export function BoardApp(props: { session: BoardSession; identity: Identity }): JSX.Element
  export interface EditorContextValue { editor: Editor; session: BoardSession }
  export const EditorContext: React.Context<EditorContextValue | null>
  export function useEditor(): EditorContextValue
  export function Toolbar(props: { editor: Editor; onPickImage: () => void }): JSX.Element
  export function ZoomControls(props: { editor: Editor }): JSX.Element
  export type NoticeKind = 'banner' | 'toast'
  export function Notice(props: { kind: NoticeKind; children: ReactNode; onClose?: () => void }): JSX.Element
  export function NotFound(): JSX.Element
  ```

- [ ] **Step 1: Write the failing toolbar test**

`apps/web/test/components/toolbar.test.tsx`:

```tsx
import type { Editor, EditorState } from '@tlwb/engine'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toolbar } from '../../src/board/components/toolbar'

export function fakeEditor(overrides: Partial<EditorState> = {}) {
  let state: EditorState = {
    activeTool: 'select',
    selectedIds: [],
    camera: { x: 0, y: 0, zoom: 1 },
    gesture: 'idle',
    readOnly: false,
    canUndo: false,
    canRedo: false,
    ...overrides,
  }
  const listeners = new Set<() => void>()
  const editor = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setActiveTool: vi.fn((tool) => {
      state = { ...state, activeTool: tool }
      for (const l of listeners) l()
    }),
    setSelectedIds: vi.fn(),
    setDefaults: vi.fn(),
    setReadOnly: vi.fn(),
    execute: vi.fn(),
    updateSelection: vi.fn(),
    commitText: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setCamera: vi.fn(),
    zoomTo: vi.fn(),
    zoomToFit: vi.fn(),
    worldToScreen: vi.fn((p) => p),
    screenToWorld: vi.fn((p) => p),
    getElementScreenRect: vi.fn(() => null),
    setPresence: vi.fn(),
    exportPng: vi.fn(),
    exportSvg: vi.fn(() => '<svg/>'),
    destroy: vi.fn(),
  } as unknown as Editor
  return editor
}

describe('Toolbar', () => {
  it('lists the eleven tools with shortcuts and activates one on click', () => {
    const editor = fakeEditor()
    render(<Toolbar editor={editor} onPickImage={() => undefined} />)
    expect(screen.getAllByRole('radio')).toHaveLength(11)
    fireEvent.click(screen.getByRole('radio', { name: 'Rectangle (3)' }))
    expect(editor.setActiveTool).toHaveBeenCalledWith('rectangle')
    expect(screen.getByRole('radio', { name: 'Rectangle (3)' })).toBeChecked()
  })

  it('opens the file picker instead of a tool for images', () => {
    const editor = fakeEditor()
    const onPickImage = vi.fn()
    render(<Toolbar editor={editor} onPickImage={onPickImage} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Image (0)' }))
    expect(onPickImage).toHaveBeenCalled()
    expect(editor.setActiveTool).not.toHaveBeenCalled()
  })
})
```

`toBeChecked` needs `@testing-library/jest-dom`: add `"@testing-library/jest-dom": "^6.8.0"` to devDependencies, `pnpm install`, and add `import '@testing-library/jest-dom/vitest'` to `test/setup.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/components/toolbar.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the hooks**

`hooks/use-session.ts`:

```ts
import { useSyncExternalStore } from 'react'
import type { BoardSession, SessionSnapshot } from '../session/board-session'

export function useSession(session: BoardSession): SessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot)
}
```

`hooks/use-editor-state.ts`:

```ts
import type { Editor, EditorState } from '@tlwb/engine'
import { useSyncExternalStore } from 'react'

export function useEditorState(editor: Editor): EditorState {
  return useSyncExternalStore(editor.subscribe, editor.getState)
}
```

`hooks/use-peers.ts`:

```ts
import type { Peer } from '@tlwb/engine'
import { useEffect, useState } from 'react'
import type { BoardSession } from '../session/board-session'
import { useSession } from './use-session'

/** Re-subscribes when the session swaps its presence (share, rename). */
export function usePeers(session: BoardSession): Peer[] {
  const snapshot = useSession(session)
  const [peers, setPeers] = useState<Peer[]>([])
  useEffect(() => {
    const presence = session.presence()
    setPeers(presence.getPeers())
    return presence.subscribe(() => setPeers(presence.getPeers()))
  }, [session, snapshot])
  return peers
}
```

- [ ] **Step 4: Implement the components**

`components/notice.tsx`:

```tsx
import type { ReactNode } from 'react'
import './notice.css'

export type NoticeKind = 'banner' | 'toast'

export function Notice(props: {
  kind: NoticeKind
  children: ReactNode
  onClose?: () => void
}) {
  return (
    <output className={`notice notice-${props.kind}`}>
      {props.children}
      {props.onClose ? (
        <button type="button" onClick={props.onClose} aria-label="Dismiss">
          ×
        </button>
      ) : null}
    </output>
  )
}
```

`components/notice.css`:

```css
.notice {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--ink);
  color: var(--surface);
  box-shadow: var(--shadow);
  z-index: 20;
}

.notice-banner {
  top: 64px;
}

.notice-toast {
  bottom: 72px;
}

.notice button {
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
}
```

`components/not-found.tsx`:

```tsx
export function NotFound() {
  return (
    <main className="not-found">
      <h1>Board not found or incomplete link</h1>
      <p>
        This browser holds no copy of this board, and the link carries no key
        to fetch it. Ask for the link again, or start fresh.
      </p>
      <a className="button" href="/b/new">
        New board
      </a>
    </main>
  )
}
```

`components/toolbar.tsx`:

```tsx
import type { Editor, ToolType } from '@tlwb/engine'
import {
  ArrowRight,
  Circle,
  Diamond,
  Eraser,
  Hand,
  Image,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  Type,
} from 'lucide-react'
import { useEditorState } from '../hooks/use-editor-state'
import './toolbar.css'

const TOOLS: Array<{ type: ToolType; label: string; key: string; Icon: typeof Square }> = [
  { type: 'select', label: 'Select', key: '1', Icon: MousePointer2 },
  { type: 'hand', label: 'Hand', key: '2', Icon: Hand },
  { type: 'rectangle', label: 'Rectangle', key: '3', Icon: Square },
  { type: 'ellipse', label: 'Ellipse', key: '4', Icon: Circle },
  { type: 'diamond', label: 'Diamond', key: '5', Icon: Diamond },
  { type: 'arrow', label: 'Arrow', key: '6', Icon: ArrowRight },
  { type: 'line', label: 'Line', key: '7', Icon: Minus },
  { type: 'draw', label: 'Draw', key: '8', Icon: Pencil },
  { type: 'text', label: 'Text', key: '9', Icon: Type },
  { type: 'image', label: 'Image', key: '0', Icon: Image },
  { type: 'eraser', label: 'Eraser', key: 'E', Icon: Eraser },
]

export function Toolbar(props: { editor: Editor; onPickImage: () => void }) {
  const { activeTool, readOnly } = useEditorState(props.editor)
  if (readOnly) {
    return null
  }
  return (
    <fieldset className="toolbar" aria-label="Tools">
      {TOOLS.map(({ type, label, key, Icon }) => (
        <label key={type} className="tool" title={`${label} (${key})`}>
          <input
            type="radio"
            name="tool"
            aria-label={`${label} (${key})`}
            checked={activeTool === type}
            onChange={() =>
              type === 'image' ? props.onPickImage() : props.editor.setActiveTool(type)
            }
          />
          <Icon size={18} aria-hidden="true" />
          <kbd>{key}</kbd>
        </label>
      ))}
    </fieldset>
  )
}
```

`components/toolbar.css`:

```css
.toolbar {
  position: absolute;
  top: var(--space-3);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  z-index: 10;
}

.tool {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius);
  cursor: pointer;
}

.tool input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.tool:has(input:checked) {
  background: var(--accent-soft);
  color: var(--accent);
}

.tool kbd {
  position: absolute;
  right: 3px;
  bottom: 1px;
  font-size: 9px;
  color: var(--muted);
}
```

`components/zoom-controls.tsx`:

```tsx
import type { Editor } from '@tlwb/engine'
import { Minus, Plus, Redo2, Undo2 } from 'lucide-react'
import { useEditorState } from '../hooks/use-editor-state'
import './zoom-controls.css'

export function ZoomControls(props: { editor: Editor }) {
  const { camera, canUndo, canRedo, readOnly } = useEditorState(props.editor)
  const { editor } = props
  return (
    <div className="zoom-controls">
      <button type="button" aria-label="Zoom out" onClick={() => editor.zoomTo(camera.zoom / 1.2)}>
        <Minus size={16} />
      </button>
      <button type="button" aria-label="Reset zoom" onClick={() => editor.zoomTo(1)}>
        {Math.round(camera.zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" onClick={() => editor.zoomTo(camera.zoom * 1.2)}>
        <Plus size={16} />
      </button>
      {readOnly ? null : (
        <>
          <span className="divider" />
          <button type="button" aria-label="Undo" disabled={!canUndo} onClick={() => editor.undo()}>
            <Undo2 size={16} />
          </button>
          <button type="button" aria-label="Redo" disabled={!canRedo} onClick={() => editor.redo()}>
            <Redo2 size={16} />
          </button>
        </>
      )}
    </div>
  )
}
```

`components/zoom-controls.css`:

```css
.zoom-controls {
  position: absolute;
  left: var(--space-3);
  bottom: var(--space-3);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  z-index: 10;
}

.zoom-controls button {
  min-width: 32px;
  height: 32px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius);
  background: none;
  cursor: pointer;
}

.zoom-controls button:disabled {
  color: var(--border);
  cursor: default;
}

.zoom-controls .divider {
  width: 1px;
  height: 20px;
  margin: 0 var(--space-1);
  background: var(--border);
}
```

`components/board-app.tsx` (the later tasks add components to it; keep this shape):

```tsx
import type { Editor } from '@tlwb/engine'
import { createEditor } from '@tlwb/engine'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { BoardSession } from '../session/board-session'
import type { Identity } from '../session/identity'
import { FONTS } from '../session/palette'
import { useSession } from '../hooks/use-session'
import { Notice } from './notice'
import { Toolbar } from './toolbar'
import { ZoomControls } from './zoom-controls'
import '../board.css'

export interface EditorContextValue {
  editor: Editor
  session: BoardSession
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext)
  if (!value) {
    throw new Error('useEditor outside of BoardApp')
  }
  return value
}

export function BoardApp(props: { session: BoardSession; identity: Identity }) {
  const { session } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const snapshot = useSession(session)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const created = createEditor({
      container,
      store: session.store,
      fonts: FONTS,
      background: '#FFFFFF',
      readOnly: session.getSnapshot().role === 'view',
      resolveImage: (hash) => session.images.resolve(hash),
      resolveImageUrl: (hash) => session.images.resolveUrl(hash),
      onCursorMove: (point) => session.presence().setCursor(point),
    })
    setEditor(created)
    return () => {
      created.destroy()
      setEditor(null)
    }
  }, [session])

  // The image cache and the presence notify through the session; both
  // need a repaint the renderer cannot know about.
  useEffect(() => {
    if (!editor) {
      return
    }
    editor.setCamera(editor.getState().camera)
    editor.setReadOnly(snapshot.role === 'view')
  }, [editor, snapshot])

  useEffect(() => {
    if (!editor) {
      return
    }
    return editor.subscribe(() => {
      session.presence().setSelection(editor.getState().selectedIds)
    })
  }, [editor, session])

  return (
    <div className="board">
      <div ref={containerRef} className="board-canvas" />
      {editor ? (
        <EditorContext.Provider value={{ editor, session }}>
          <Toolbar editor={editor} onPickImage={() => undefined} />
          <ZoomControls editor={editor} />
          {snapshot.role === 'view' ? (
            <Notice kind="banner">View only</Notice>
          ) : null}
          {snapshot.storage === 'memory' ? (
            <Notice kind="banner">This browser is not saving this board</Notice>
          ) : null}
        </EditorContext.Provider>
      ) : null}
    </div>
  )
}
```

`board.css`:

```css
.board {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--surface);
}

.board-canvas {
  position: absolute;
  inset: 0;
}

.not-found {
  max-width: 480px;
  margin: 20vh auto;
  padding: var(--space-4);
  text-align: center;
}

.button {
  display: inline-block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--surface);
  text-decoration: none;
  font-weight: 500;
}
```

`main.tsx`:

```tsx
import { nanoid } from 'nanoid'
import { createRoot } from 'react-dom/client'
import { BoardApp } from './components/board-app'
import { NotFound } from './components/not-found'
import { openBoardSession } from './session/board-session'
import { loadIdentity } from './session/identity'
import { keysFromFragment, readAlias, readKeys, writeKeys } from './session/keys'

async function main(): Promise<void> {
  const root = document.getElementById('root')
  if (!root) {
    return
  }
  const match = /^\/b\/([A-Za-z0-9_-]+)$/.exec(location.pathname)
  if (!match) {
    location.replace('/')
    return
  }
  let boardId = match[1] as string
  let fresh = false
  if (boardId === 'new') {
    boardId = nanoid()
    fresh = true
    history.replaceState(null, '', `/b/${boardId}`)
  }
  const alias = readAlias(boardId)
  if (alias) {
    location.replace(`/b/${alias}${location.hash}`)
    return
  }
  const fromFragment = keysFromFragment(location.hash)
  if (fromFragment) {
    writeKeys(boardId, { ...readKeys(boardId), ...fromFragment })
    history.replaceState(null, '', `/b/${boardId}`)
  }
  const identity = loadIdentity()
  const session = await openBoardSession({ boardId, fresh, identity })
  if (session === 'not-found') {
    createRoot(root).render(<NotFound />)
    return
  }
  if (import.meta.env.DEV) {
    // End-to-end tests read the store through this handle.
    ;(window as unknown as { tlwb: unknown }).tlwb = { session }
  }
  createRoot(root).render(<BoardApp session={session} identity={identity} />)
}

void main()
```

- [ ] **Step 5: Run tests, checks, and the app**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS. Then `pnpm --filter @tlwb/web dev`, open `http://localhost:5173/b/new`: the toolbar appears, pressing `3` and dragging draws a sketchy rectangle, the zoom percentage follows the wheel, a reload keeps the rectangle. `http://localhost:5173/b/unknownid1` shows the not-found screen.

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "✨ feat(web): mount the editor with its toolbar and zoom controls"
```

---

### Task 10: Top bar, board menu, name editing, and save indicator

**Files:**
- Create: `apps/web/src/board/components/top-bar.tsx`, `top-bar.css`, `board-menu.tsx`
- Modify: `apps/web/src/board/components/board-app.tsx` (render `<TopBar />`)
- Test: `apps/web/test/components/top-bar.test.tsx`

**Interfaces:**
- Consumes: `useEditor()` context, `useSession`, `listRecents`.
- Produces: `TopBar(props: { session: BoardSession })`, `BoardMenu(props: { currentId: string })`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/components/top-bar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TopBar } from '../../src/board/components/top-bar'
import { openBoardSession } from '../../src/board/session/board-session'
import { touchRecent } from '../../src/board/session/recents'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

describe('TopBar', () => {
  it('renames the board through the meta and the document title', async () => {
    const session = await openBoardSession({ boardId: 'top1', fresh: true, identity })
    if (session === 'not-found') throw new Error('unexpected')
    render(<TopBar session={session} />)
    const name = screen.getByRole('textbox', { name: 'Board name' })
    expect(name).toHaveValue('Untitled')
    fireEvent.change(name, { target: { value: 'Roadmap' } })
    fireEvent.blur(name)
    expect(session.store.getMeta().name).toBe('Roadmap')
    expect(document.title).toBe('Roadmap · tlwb')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    await session.destroy()
  })

  it('lists recent boards in the menu, current one excluded', async () => {
    touchRecent({ id: 'other', name: 'Other', updatedAt: 1 })
    const session = await openBoardSession({ boardId: 'top2', fresh: true, identity })
    if (session === 'not-found') throw new Error('unexpected')
    render(<TopBar session={session} />)
    fireEvent.click(screen.getByRole('button', { name: 'tlwb menu' }))
    expect(screen.getByRole('link', { name: 'New board' })).toHaveAttribute('href', '/b/new')
    expect(screen.getByRole('link', { name: /Other/ })).toHaveAttribute('href', '/b/other')
    expect(screen.queryByRole('link', { name: /Untitled/ })).toBeNull()
    await session.destroy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/components/top-bar.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`components/board-menu.tsx`:

```tsx
import { listRecents } from '../session/recents'

function relative(updatedAt: number): string {
  const minutes = Math.round((Date.now() - updatedAt) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function BoardMenu(props: { currentId: string }) {
  const recents = listRecents().filter((item) => item.id !== props.currentId)
  return (
    <nav className="board-menu" aria-label="Boards">
      <a href="/b/new">New board</a>
      {recents.length > 0 ? (
        <ul>
          {recents.slice(0, 10).map((item) => (
            <li key={item.id}>
              <a href={`/b/${item.id}`}>
                {item.name || 'Untitled'} <small>{relative(item.updatedAt)}</small>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <a href="/">Home</a>
    </nav>
  )
}
```

`components/top-bar.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import { BoardMenu } from './board-menu'
import './top-bar.css'

function useBoardName(session: BoardSession): string {
  const [name, setName] = useState(session.store.getMeta().name)
  useEffect(
    () =>
      session.store.subscribe((event) => {
        if (event.kind === 'meta') {
          setName(event.meta.name)
        }
      }),
    [session],
  )
  useEffect(() => {
    document.title = `${name || 'Untitled'} · tlwb`
  }, [name])
  return name
}

export function TopBar(props: { session: BoardSession }) {
  const { session } = props
  const snapshot = useSession(session)
  const name = useBoardName(session)
  const [draft, setDraft] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const commit = (): void => {
    if (draft !== null && draft.trim() !== name) {
      session.store.setMeta({ name: draft.trim() || 'Untitled' })
    }
    setDraft(null)
  }

  const indicator =
    snapshot.role === 'local'
      ? snapshot.storage === 'memory'
        ? 'Not saved'
        : 'Saved'
      : snapshot.status === 'connected'
        ? 'Synced'
        : 'Offline'

  return (
    <header className="top-bar">
      <button
        type="button"
        className="logo"
        aria-label="tlwb menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        tlwb
      </button>
      {menuOpen ? <BoardMenu currentId={snapshot.boardId} /> : null}
      <input
        className="board-name"
        aria-label="Board name"
        value={draft ?? name}
        readOnly={snapshot.role === 'view'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />
      <span className="indicator">{indicator}</span>
    </header>
  )
}
```

`components/top-bar.css`:

```css
.top-bar {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  z-index: 10;
}

.logo {
  border: 0;
  background: none;
  font: 700 22px var(--font-hand);
  color: var(--accent);
  cursor: pointer;
}

.board-menu {
  position: absolute;
  top: 44px;
  left: 0;
  min-width: 220px;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}

.board-menu a {
  display: block;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius);
  color: inherit;
  text-decoration: none;
}

.board-menu a:hover {
  background: var(--paper);
}

.board-menu ul {
  margin: var(--space-1) 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.board-menu small {
  color: var(--muted);
}

.board-name {
  width: 180px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: none;
  font-weight: 500;
}

.board-name:focus {
  border-color: var(--border);
  outline: none;
}

.indicator {
  font-size: 12px;
  color: var(--muted);
}
```

In `board-app.tsx`, import `TopBar` and render `<TopBar session={session} />` as the first child inside the provider.

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): add the top bar with board name, menu, and save indicator"
```

---

### Task 11: Contextual panel

**Files:**
- Create: `apps/web/src/board/components/context-panel.tsx`, `context-panel.css`
- Modify: `apps/web/src/board/components/board-app.tsx`
- Test: `apps/web/test/components/context-panel.test.tsx`

**Interfaces:**
- Consumes: `Editor`, `BoardStore`, `STROKE_COLORS`, `FILL_COLORS`, `fakeEditor` from the toolbar test (move it to `test/helpers/fake-editor.tsx` and import it from both tests).
- Produces: `ContextPanel(props: { editor: Editor; store: BoardStore })`.

- [ ] **Step 1: Move the fake editor to a helper**

Create `apps/web/test/helpers/fake-editor.ts` with the `fakeEditor` function from Task 9 (unchanged) and import it from `toolbar.test.tsx`.

- [ ] **Step 2: Write the failing test**

`apps/web/test/components/context-panel.test.tsx`:

```tsx
import { createElement, InMemoryBoardStore } from '@tlwb/engine'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContextPanel } from '../../src/board/components/context-panel'
import { fakeEditor } from '../helpers/fake-editor'

describe('ContextPanel', () => {
  it('stays hidden with the select tool and no selection', () => {
    const { container } = render(
      <ContextPanel editor={fakeEditor()} store={new InMemoryBoardStore()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('patches the creation defaults when a tool is active', () => {
    const editor = fakeEditor({ activeTool: 'rectangle' })
    render(<ContextPanel editor={editor} store={new InMemoryBoardStore()} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Stroke #E03131' }))
    expect(editor.setDefaults).toHaveBeenCalledWith({ strokeColor: '#E03131' })
    expect(editor.updateSelection).not.toHaveBeenCalled()
  })

  it('patches the selection and shows text controls for a text element', () => {
    const store = new InMemoryBoardStore()
    const text = createElement('text', { index: 'a0', text: 'hi' })
    store.applyChanges([{ kind: 'create', element: text }])
    const editor = fakeEditor({ selectedIds: [text.id] })
    render(<ContextPanel editor={editor} store={store} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Font size 28' }))
    expect(editor.updateSelection).toHaveBeenCalledWith({ fontSize: 28 })
    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }))
    expect(editor.execute).toHaveBeenCalledWith({ kind: 'bring-to-front' })
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/components/context-panel.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `context-panel.tsx`**

```tsx
import type {
  BoardStore,
  Editor,
  ElementProps,
  StrokeStyle,
  TextAlign,
} from '@tlwb/engine'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useEditorState } from '../hooks/use-editor-state'
import { FILL_COLORS, STROKE_COLORS } from '../session/palette'
import './context-panel.css'

const WIDTHS = [1, 2, 4]
const STYLES: StrokeStyle[] = ['solid', 'dashed']
const SKETCHINESS = [0, 1, 2]
const FONT_SIZES = [16, 20, 28, 36]
const ALIGNS: Array<{ value: TextAlign; Icon: typeof AlignLeft }> = [
  { value: 'left', Icon: AlignLeft },
  { value: 'center', Icon: AlignCenter },
  { value: 'right', Icon: AlignRight },
]

function Choice<T extends string | number | null>(props: {
  group: string
  label: (value: T) => string
  values: readonly T[]
  current: T | undefined
  onPick: (value: T) => void
  render?: (value: T) => React.ReactNode
}) {
  return (
    <fieldset className="choice">
      <legend>{props.group}</legend>
      {props.values.map((value) => (
        <label key={String(value)} className="choice-item">
          <input
            type="radio"
            name={props.group}
            aria-label={props.label(value)}
            checked={props.current === value}
            onChange={() => props.onPick(value)}
          />
          {props.render ? props.render(value) : String(value)}
        </label>
      ))}
    </fieldset>
  )
}

export function ContextPanel(props: { editor: Editor; store: BoardStore }) {
  const { editor, store } = props
  const { activeTool, selectedIds, readOnly } = useEditorState(editor)
  const selected = selectedIds.flatMap((id) => {
    const element = store.getElement(id)
    return element ? [element] : []
  })
  if (readOnly || (selected.length === 0 && (activeTool === 'select' || activeTool === 'hand' || activeTool === 'eraser'))) {
    return null
  }
  const first = selected[0]
  const patch = (props: ElementProps): void => {
    if (selected.length > 0) {
      editor.updateSelection(props)
    } else {
      editor.setDefaults(props)
    }
  }
  const showsText = first ? first.type === 'text' : activeTool === 'text'
  const swatch = (color: string | null) => (
    <span
      className="swatch"
      style={{ background: color ?? 'transparent' }}
      data-none={color === null ? '' : undefined}
    />
  )

  return (
    <aside className="context-panel" aria-label="Properties">
      <Choice
        group="Stroke"
        label={(value) => `Stroke ${value}`}
        values={STROKE_COLORS}
        current={first?.strokeColor}
        onPick={(strokeColor) => patch({ strokeColor })}
        render={swatch}
      />
      <Choice
        group="Fill"
        label={(value) => `Fill ${value ?? 'none'}`}
        values={FILL_COLORS}
        current={first ? first.fillColor : undefined}
        onPick={(fillColor) => patch({ fillColor })}
        render={swatch}
      />
      <Choice
        group="Width"
        label={(value) => `Stroke width ${value}`}
        values={WIDTHS}
        current={first?.strokeWidth}
        onPick={(strokeWidth) => patch({ strokeWidth })}
      />
      <Choice
        group="Style"
        label={(value) => `Stroke style ${value}`}
        values={STYLES}
        current={first?.strokeStyle}
        onPick={(strokeStyle) => patch({ strokeStyle })}
      />
      <Choice
        group="Sketchiness"
        label={(value) => `Sketchiness ${value}`}
        values={SKETCHINESS}
        current={first?.sketchiness}
        onPick={(sketchiness) => patch({ sketchiness })}
      />
      {showsText ? (
        <>
          <Choice
            group="Font size"
            label={(value) => `Font size ${value}`}
            values={FONT_SIZES}
            current={first?.type === 'text' ? first.fontSize : undefined}
            onPick={(fontSize) => patch({ fontSize })}
          />
          <Choice
            group="Align"
            label={(value) => `Align ${value}`}
            values={ALIGNS.map((item) => item.value)}
            current={first?.type === 'text' ? first.textAlign : undefined}
            onPick={(textAlign) => patch({ textAlign })}
            render={(value) => {
              const Icon = ALIGNS.find((item) => item.value === value)?.Icon ?? AlignLeft
              return <Icon size={16} aria-hidden="true" />
            }}
          />
        </>
      ) : null}
      {selected.length > 0 ? (
        <div className="z-order" aria-label="Order">
          <button type="button" aria-label="Bring to front" onClick={() => editor.execute({ kind: 'bring-to-front' })}>
            <ArrowUpToLine size={16} />
          </button>
          <button type="button" aria-label="Bring forward" onClick={() => editor.execute({ kind: 'bring-forward' })}>
            <ChevronUp size={16} />
          </button>
          <button type="button" aria-label="Send backward" onClick={() => editor.execute({ kind: 'send-backward' })}>
            <ChevronDown size={16} />
          </button>
          <button type="button" aria-label="Send to back" onClick={() => editor.execute({ kind: 'send-to-back' })}>
            <ArrowDownToLine size={16} />
          </button>
        </div>
      ) : null}
    </aside>
  )
}
```

`context-panel.css`:

```css
.context-panel {
  position: absolute;
  top: 72px;
  left: var(--space-3);
  width: 200px;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  z-index: 10;
}

.choice {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0 0 var(--space-2);
  padding: 0;
  border: 0;
}

.choice legend {
  width: 100%;
  margin-bottom: var(--space-1);
  font-size: 12px;
  color: var(--muted);
}

.choice-item {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 28px;
  height: 28px;
  padding: 0 var(--space-1);
  border-radius: var(--radius);
  font-size: 12px;
  cursor: pointer;
}

.choice-item input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.choice-item:has(input:checked) {
  outline: 2px solid var(--accent);
}

.swatch {
  width: 18px;
  height: 18px;
  border: 1px solid var(--border);
  border-radius: 50%;
}

.swatch[data-none] {
  background: linear-gradient(135deg, transparent 45%, var(--muted) 45%, var(--muted) 55%, transparent 55%);
}

.z-order {
  display: flex;
  gap: var(--space-1);
}

.z-order button {
  flex: 1;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: none;
  cursor: pointer;
}
```

In `board-app.tsx`, render `<ContextPanel editor={editor} store={session.store} />` after the toolbar.

- [ ] **Step 5: Run tests and checks**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS. In the dev server, selecting a shape shows the panel, picking a fill recolors it, and the panel hides with an empty selection.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): add the contextual properties panel"
```

---

### Task 12: DOM text editor

**Files:**
- Create: `apps/web/src/board/components/text-editor.tsx`, `text-editor.css`
- Modify: `apps/web/src/board/components/board-app.tsx` (state `editingId`, `onTextEditRequest`, render `<TextEditor />`)
- Test: `apps/web/test/components/text-editor.test.tsx`

**Interfaces:**
- Consumes: `Editor.getElementScreenRect`, `Editor.commitText`, `measureText`, `LINE_HEIGHT`, `FONTS`.
- Produces: `TextEditor(props: { editor: Editor; store: BoardStore; id: ElementId; onDone: () => void })`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/components/text-editor.test.tsx`:

```tsx
import { createElement, InMemoryBoardStore } from '@tlwb/engine'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TextEditor } from '../../src/board/components/text-editor'
import { fakeEditor } from '../helpers/fake-editor'

function setup(text = 'hello') {
  const store = new InMemoryBoardStore()
  const element = createElement('text', { index: 'a0', text, x: 10, y: 20, width: 80, height: 25 })
  store.applyChanges([{ kind: 'create', element }])
  const editor = fakeEditor()
  ;(editor.getElementScreenRect as ReturnType<typeof vi.fn>).mockReturnValue({
    x: 100,
    y: 200,
    width: 80,
    height: 25,
  })
  const onDone = vi.fn()
  render(<TextEditor editor={editor} store={store} id={element.id} onDone={onDone} />)
  return { editor, element, onDone }
}

describe('TextEditor', () => {
  it('opens over the element with its text and font, focused', () => {
    setup()
    const area = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(area).toHaveValue('hello')
    expect(document.activeElement).toBe(area)
    expect(area.style.left).toBe('100px')
    expect(area.style.top).toBe('200px')
    expect(area.style.fontSize).toBe('20px')
    expect(area.style.fontFamily).toContain('Caveat')
  })

  it('commits on blur and on Escape, keeps Enter as a line break', () => {
    const { editor, element, onDone } = setup()
    const area = screen.getByRole('textbox')
    fireEvent.change(area, { target: { value: 'line 1\nline 2' } })
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(editor.commitText).not.toHaveBeenCalled()
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(editor.commitText).toHaveBeenCalledWith(element.id, 'line 1\nline 2')
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/components/text-editor.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `text-editor.tsx`**

```tsx
import type { BoardStore, Editor, ElementId } from '@tlwb/engine'
import { LINE_HEIGHT, measureText } from '@tlwb/engine'
import { useEffect, useRef, useState } from 'react'
import { useEditorState } from '../hooks/use-editor-state'
import { FONTS } from '../session/palette'
import './text-editor.css'

let sharedContext: CanvasRenderingContext2D | null = null

/** One offscreen context sizes the textarea like the renderer paints. */
function measuringContext(): CanvasRenderingContext2D | null {
  if (!sharedContext) {
    sharedContext = document.createElement('canvas').getContext('2d')
  }
  return sharedContext
}

export function TextEditor(props: {
  editor: Editor
  store: BoardStore
  id: ElementId
  onDone: () => void
}) {
  const { editor, store, id, onDone } = props
  const element = store.getElement(id)
  const [text, setText] = useState(element?.type === 'text' ? element.text : '')
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const committed = useRef(false)
  // Re-rendered on every editor change so the box follows the camera.
  useEditorState(editor)

  useEffect(() => {
    areaRef.current?.focus()
    areaRef.current?.select()
  }, [])

  if (!element || element.type !== 'text') {
    return null
  }
  const rect = editor.getElementScreenRect(id)
  if (!rect) {
    return null
  }
  const spec = { text: text || ' ', fontSize: element.fontSize, fontFamily: element.fontFamily }
  const ctx = measuringContext()
  const measured = ctx
    ? measureText(spec, FONTS, ctx)
    : { width: rect.width, height: rect.height }
  const zoom = editor.getState().camera.zoom

  const commit = (): void => {
    if (committed.current) {
      return
    }
    committed.current = true
    editor.commitText(id, text)
    onDone()
  }

  return (
    <textarea
      ref={areaRef}
      className="text-editor"
      aria-label="Text"
      value={text}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${Math.max(measured.width * zoom + 8, rect.width)}px`,
        height: `${Math.max(measured.height * zoom, rect.height)}px`,
        fontFamily: FONTS[element.fontFamily],
        fontSize: `${element.fontSize * zoom}px`,
        lineHeight: String(LINE_HEIGHT),
        textAlign: element.textAlign,
        color: element.strokeColor,
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}
```

`text-editor.css`:

```css
.text-editor {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 0;
  outline: 1px dashed var(--accent);
  background: transparent;
  resize: none;
  overflow: hidden;
  white-space: pre;
  z-index: 5;
}
```

In `board-app.tsx`: add `const [editingId, setEditingId] = useState<string | null>(null)`, pass `onTextEditRequest: (id) => setEditingId(id)` to `createEditor`, and render `{editingId ? <TextEditor editor={editor} store={session.store} id={editingId} onDone={() => setEditingId(null)} /> : null}` inside the provider.

- [ ] **Step 4: Run tests and checks**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS. In the dev server: press `9`, click the canvas, type, click elsewhere: the text stays, in Caveat, and one Cmd+Z removes creation and text together.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): edit text in a DOM textarea sized like the renderer"
```

---

### Task 13: Presence stack, share dialog, and close-code handling

**Files:**
- Create: `apps/web/src/board/components/presence-stack.tsx`, `presence-stack.css`, `share-dialog.tsx`, `share-dialog.css`
- Modify: `apps/web/src/board/components/board-app.tsx` (render both, wire close codes and toasts, feed `editor.setPresence`)
- Test: `apps/web/test/components/share-dialog.test.tsx`

**Interfaces:**
- Consumes: `usePeers`, `useSession`, `shareBoard`, `shareLink`, `saveIdentity`, `BoardSession.setIdentity`, `becomeViewer`, `forgetKeys`, `connection().reconnect()`.
- Produces:
  ```ts
  export function PresenceStack(props: { session: BoardSession; identity: Identity; onRename: (identity: Identity) => void; onShare: () => void; menu: ReactNode })
  export function ShareDialog(props: { session: BoardSession; open: boolean; onClose: () => void; share?: (session: BoardSession) => Promise<StoredKeys> })
  ```

- [ ] **Step 1: Write the failing test**

`apps/web/test/components/share-dialog.test.tsx`:

```tsx
import { createBoardDoc, createLocalAwareness } from '@tlwb/store-yjs'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareDialog } from '../../src/board/components/share-dialog'
import { openBoardSession } from '../../src/board/session/board-session'
import { writeKeys } from '../../src/board/session/keys'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => {
  localStorage.clear()
  // happy-dom's <dialog> has no showModal; the component guards it.
})

describe('ShareDialog', () => {
  it('offers to create a link on a local board and shows the links after', async () => {
    const session = await openBoardSession({ boardId: 'sd1', fresh: true, identity })
    if (session === 'not-found') throw new Error('unexpected')
    const share = vi.fn(async () => ({ editKey: 'e', viewKey: 'v' }))
    render(<ShareDialog session={session} open onClose={() => undefined} share={share} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() => expect(share).toHaveBeenCalledWith(session))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Share link' })).toHaveValue(
        expect.stringContaining('#edit=e'),
      ),
    )
    fireEvent.click(screen.getByRole('radio', { name: 'View only' }))
    expect(screen.getByRole('textbox', { name: 'Share link' })).toHaveValue(
      expect.stringContaining('#view=v'),
    )
    await session.destroy()
  })

  it('reports a failed share and stays local', async () => {
    const session = await openBoardSession({ boardId: 'sd2', fresh: true, identity })
    if (session === 'not-found') throw new Error('unexpected')
    const share = vi.fn(async () => {
      throw new Error('down')
    })
    render(<ShareDialog session={session} open onClose={() => undefined} share={share} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() =>
      expect(screen.getByText('Could not create the link, try again')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Create link' })).toBeEnabled()
    await session.destroy()
  })

  it('shows only the links whose keys it holds', async () => {
    writeKeys('sd3', { viewKey: 'v' })
    const session = await openBoardSession({
      boardId: 'sd3',
      fresh: true,
      identity,
      connect: () => ({
        provider: {} as never,
        awareness: createLocalAwareness(createBoardDoc()),
        getStatus: () => 'connected',
        subscribeStatus: () => () => undefined,
        subscribeClose: () => () => undefined,
        reconnect: () => undefined,
        destroy: () => undefined,
      }),
    })
    if (session === 'not-found') throw new Error('unexpected')
    render(<ShareDialog session={session} open onClose={() => undefined} />)
    expect(screen.queryByRole('radio', { name: 'Can edit' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Share link' })).toHaveValue(
      expect.stringContaining('#view=v'),
    )
    await session.destroy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/components/share-dialog.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `share-dialog.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import { shareLink, type StoredKeys } from '../session/keys'
import { shareBoard } from '../session/share'
import './share-dialog.css'

export function ShareDialog(props: {
  session: BoardSession
  open: boolean
  onClose: () => void
  share?: (session: BoardSession) => Promise<StoredKeys>
}) {
  const { session, open, onClose } = props
  const share = props.share ?? ((target: BoardSession) => shareBoard(target))
  const snapshot = useSession(session)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [role, setRole] = useState<'edit' | 'view'>('edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || typeof dialog.showModal !== 'function') {
      return
    }
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const keys = session.keys()
  const effectiveRole = role === 'edit' && !keys?.editKey ? 'view' : role
  const link = keys ? shareLink(location.origin, snapshot.boardId, keys, effectiveRole) : null

  const create = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await share(session)
    } catch {
      setError('Could not create the link, try again')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    if (link && navigator.clipboard) {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <dialog ref={dialogRef} className="share-dialog" onClose={onClose} open={open || undefined}>
      <h2>Share this board</h2>
      {snapshot.role === 'local' ? (
        <>
          <p>
            Sharing moves the board to the server so others can open it. It
            stays on this device too.
          </p>
          {error ? <p className="error">{error}</p> : null}
          <button type="button" className="primary" disabled={busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create link'}
          </button>
        </>
      ) : (
        <>
          <fieldset className="share-role">
            {keys?.editKey ? (
              <label>
                <input type="radio" name="role" aria-label="Can edit" checked={effectiveRole === 'edit'} onChange={() => setRole('edit')} />
                Can edit
              </label>
            ) : null}
            {keys?.viewKey ? (
              <label>
                <input type="radio" name="role" aria-label="View only" checked={effectiveRole === 'view'} onChange={() => setRole('view')} />
                View only
              </label>
            ) : null}
          </fieldset>
          <div className="share-link">
            <input aria-label="Share link" readOnly value={link ?? ''} onFocus={(event) => event.target.select()} />
            <button type="button" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <section className="share-agents">
            <h3>Agents</h3>
            <p>
              Connect Claude Code or any MCP client to this board. Coming with
              the MCP server; see the repository README for progress.
            </p>
          </section>
        </>
      )}
      <button type="button" className="close" onClick={onClose}>
        Close
      </button>
    </dialog>
  )
}
```

`share-dialog.css`:

```css
.share-dialog {
  width: min(480px, 90vw);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}

.share-dialog::backdrop {
  background: rgb(26 26 26 / 0.3);
}

.share-dialog h2 {
  margin: 0 0 var(--space-3);
  font-size: 20px;
}

.share-dialog .primary {
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--surface);
  font-weight: 500;
  cursor: pointer;
}

.share-dialog .error {
  color: #c92a2a;
}

.share-role {
  display: flex;
  gap: var(--space-3);
  margin: 0 0 var(--space-2);
  padding: 0;
  border: 0;
}

.share-link {
  display: flex;
  gap: var(--space-1);
}

.share-link input {
  flex: 1;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.share-agents {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
  color: var(--muted);
}

.share-dialog .close {
  margin-top: var(--space-3);
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
}
```

- [ ] **Step 4: Implement `presence-stack.tsx`**

```tsx
import type { ReactNode } from 'react'
import { useState } from 'react'
import { usePeers } from '../hooks/use-peers'
import { useSession } from '../hooks/use-session'
import type { BoardSession } from '../session/board-session'
import type { Identity } from '../session/identity'
import './presence-stack.css'

function Avatar(props: { name: string; color: string; isAgent: boolean; onClick?: () => void }) {
  const initial = props.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <button
      type="button"
      className={`avatar${props.isAgent ? ' avatar-agent' : ''}`}
      style={{ background: props.color }}
      title={props.name}
      aria-label={props.name}
      onClick={props.onClick}
    >
      {initial}
    </button>
  )
}

export function PresenceStack(props: {
  session: BoardSession
  identity: Identity
  onRename: (identity: Identity) => void
  onShare: () => void
  menu: ReactNode
}) {
  const peers = usePeers(props.session)
  const snapshot = useSession(props.session)
  const [renaming, setRenaming] = useState(false)
  return (
    <div className="presence-stack">
      {renaming ? (
        <input
          aria-label="Your name"
          defaultValue={props.identity.name}
          onBlur={(event) => {
            const name = event.target.value.trim()
            if (name) {
              props.onRename({ ...props.identity, name })
            }
            setRenaming(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
        />
      ) : (
        <Avatar {...props.identity} isAgent={false} onClick={() => setRenaming(true)} />
      )}
      {peers.map((peer) => (
        <Avatar key={peer.id} name={peer.name} color={peer.color} isAgent={peer.isAgent} />
      ))}
      {snapshot.role !== 'view' ? (
        <button type="button" className="share" onClick={props.onShare}>
          Share
        </button>
      ) : null}
      {props.menu}
    </div>
  )
}
```

`presence-stack.css`:

```css
.presence-stack {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  z-index: 10;
}

.avatar {
  width: 28px;
  height: 28px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  color: var(--surface);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.avatar-agent {
  outline: 2px solid var(--agent);
}

.presence-stack .share {
  margin-left: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border: 0;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--surface);
  font-weight: 500;
  cursor: pointer;
}
```

- [ ] **Step 5: Wire into `board-app.tsx`**

Add state: `const [identity, setIdentity] = useState(props.identity)`, `const [shareOpen, setShareOpen] = useState(false)`, `const [toast, setToast] = useState<string | null>(null)`, `const [linkDead, setLinkDead] = useState(false)`.

Peers to the overlay:

```tsx
const peers = usePeers(session)
useEffect(() => {
  editor?.setPresence(peers)
}, [editor, peers])
```

Close codes (one effect on `snapshot.closeCode`):

```tsx
useEffect(() => {
  const code = snapshot.closeCode
  if (code === 4401 || code === 4404) {
    session.forgetKeys()
    setLinkDead(true)
  } else if (code === 4403) {
    session.becomeViewer()
    session.connection()?.reconnect()
  } else if (code === 4409 || code === 4422 || code === 4429) {
    setToast('Change refused by the server')
  }
}, [session, snapshot.closeCode])

useEffect(() => {
  if (!toast) return
  const timer = setTimeout(() => setToast(null), 4000)
  return () => clearTimeout(timer)
}, [toast])
```

Rename: `const rename = (next: Identity) => { saveIdentity(next); setIdentity(next); session.setIdentity(next) }`.

Render inside the provider, after the top bar:

```tsx
<PresenceStack session={session} identity={identity} onRename={rename} onShare={() => setShareOpen(true)} menu={null} />
<ShareDialog session={session} open={shareOpen} onClose={() => setShareOpen(false)} />
{linkDead ? <Notice kind="banner">This link is no longer valid</Notice> : null}
{toast ? <Notice kind="toast" onClose={() => setToast(null)}>{toast}</Notice> : null}
```

- [ ] **Step 6: Run tests, checks, and a two-tab check**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS. Then with `docker compose up -d postgres`, the server (`DATABASE_URL=... CORS_ORIGIN=http://localhost:5173 pnpm --filter @tlwb/collab-server dev`) and `pnpm --filter @tlwb/web dev`: Share on a board, open the edit link in a private window, draw in each: both see the shapes and cursors, the URL of the first tab moved to the server id, the view link shows the banner and no toolbar.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): share a board by link and show who is present"
```

---

### Task 14: Image tool

**Files:**
- Modify: `apps/web/src/board/components/board-app.tsx` (file input, `getPendingImage`, `onPickImage`)
- Test: covered by Task 6 for the cache; this task adds no unit test (the wiring is a file input and two callbacks).

- [ ] **Step 1: Wire the file input**

In `board-app.tsx`:

```tsx
const fileRef = useRef<HTMLInputElement>(null)
const pendingRef = useRef<PendingImage | null>(null)

const onFile = async (file: File | undefined): Promise<void> => {
  if (!file || !editor) return
  try {
    pendingRef.current = await session.images.stage(file)
    editor.setActiveTool('image')
  } catch (error) {
    const status = error instanceof ServerError ? error.status : null
    setToast(
      status === 415
        ? 'This image type is not accepted'
        : status === 413
          ? 'This image is too large'
          : 'Could not upload the image',
    )
  }
}
```

Pass `getPendingImage: () => { const pending = pendingRef.current; pendingRef.current = null; return pending }` to `createEditor` (import `PendingImage` type and `ServerError`). The toolbar gets `onPickImage={() => fileRef.current?.click()}`, and the hidden input renders inside the board:

```tsx
<input
  ref={fileRef}
  type="file"
  accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
  hidden
  onChange={(event) => {
    void onFile(event.target.files?.[0])
    event.target.value = ''
  }}
/>
```

Note: `getPendingImage` clears the staged image on the first read, so a single click places it and the tool falls back to select as the engine does.

- [ ] **Step 2: Typecheck, check, and try**

Run: `pnpm --filter @tlwb/web typecheck && pnpm check && pnpm --filter @tlwb/web test`
Expected: PASS. In the dev server: press `0`, pick a PNG, click the canvas: the image appears at its natural size and survives a reload. On a hosted board, the second tab shows it too (fetched from the server into its own local store).

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): place images from a file picker"
```

---

### Task 15: Overflow menu (export, duplicate, remove) and help

**Files:**
- Create: `apps/web/src/board/session/board-actions.ts`, `apps/web/src/board/components/overflow-menu.tsx`, `overflow-menu.css`, `help-button.tsx`
- Modify: `apps/web/src/board/components/board-app.tsx`
- Test: `apps/web/test/session/board-actions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function download(blob: Blob, filename: string, doc?: Document): void
  export async function duplicateBoard(session: BoardSession, newId?: string, now?: () => number): Promise<string>  // returns the new id
  export async function removeBoard(session: BoardSession, storage?: Storage): Promise<void>
  export function OverflowMenu(props: { session: BoardSession; editor: Editor })
  export function HelpButton()
  ```

- [ ] **Step 1: Write the failing test**

`apps/web/test/session/board-actions.test.ts`:

```ts
import { createElement } from '@tlwb/engine'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  duplicateBoard,
  removeBoard,
} from '../../src/board/session/board-actions'
import { openBoardSession } from '../../src/board/session/board-session'
import { readAlias, readKeys, writeAlias, writeKeys } from '../../src/board/session/keys'
import { listRecents } from '../../src/board/session/recents'

const identity = { name: 'Ada', color: '#1971C2' }

beforeEach(() => localStorage.clear())

describe('board actions', () => {
  it('duplicates elements, assets, and name into a new local board', async () => {
    const session = await openBoardSession({ boardId: 'dup', fresh: true, identity })
    if (session === 'not-found') throw new Error('unexpected')
    session.store.setMeta({ name: 'Plan' })
    const hash = await session.assets().put(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    session.store.applyChanges([
      { kind: 'create', element: createElement('image', { index: 'a0', assetHash: hash }) },
    ])
    const newId = await duplicateBoard(session, 'dup-copy', () => 5)
    await session.destroy()

    const copy = await openBoardSession({ boardId: newId, fresh: false, identity })
    if (copy === 'not-found') throw new Error('unexpected')
    expect(copy.store.getMeta()).toEqual({ name: 'Plan copy', createdAt: 5 })
    expect(copy.store.listElements()).toHaveLength(1)
    expect(await copy.assets().get(hash)).toBeDefined()
    expect(copy.store.canUndo()).toBe(false)
    await copy.destroy()
  })

  it('removes every local trace of a board', async () => {
    writeKeys('gone', { editKey: 'e' })
    writeAlias('old', 'gone')
    const session = await openBoardSession({ boardId: 'gone', fresh: true, identity })
    if (session === 'not-found') throw new Error('unexpected')
    await removeBoard(session)
    expect(readKeys('gone')).toBeNull()
    expect(readAlias('old')).toBeNull()
    expect(listRecents()).toEqual([])
    expect(await openBoardSession({ boardId: 'gone', fresh: false, identity })).toBe('not-found')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/session/board-actions.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `board-actions.ts`**

```ts
import { exportSnapshot, importSnapshot } from '@tlwb/engine'
import {
  createAssetStore,
  createBoardDoc,
  createYjsBoardStore,
  persistBoard,
} from '@tlwb/store-yjs'
import { nanoid } from 'nanoid'
import type { BoardSession } from './board-session'
import { clearAliasesTo, clearKeys } from './keys'
import { removeRecent } from './recents'

export function download(blob: Blob, filename: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob)
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** A new local board holding a copy of this one; returns its id. */
export async function duplicateBoard(
  session: BoardSession,
  newId: string = nanoid(),
  now: () => number = Date.now,
): Promise<string> {
  const doc = createBoardDoc()
  const store = createYjsBoardStore(doc)
  const persistence = persistBoard(doc, newId)
  const assets = createAssetStore(newId)
  await persistence.whenLoaded
  const snapshot = exportSnapshot(session.store)
  importSnapshot(store, {
    ...snapshot,
    meta: { name: `${snapshot.meta.name} copy`, createdAt: now() },
  })
  for (const element of snapshot.elements) {
    if (element.type === 'image') {
      const blob = await session.assets().get(element.assetHash)
      if (blob) {
        await assets.put(blob)
      }
    }
  }
  await persistence.destroy()
  await assets.destroy()
  return newId
}

/** Forgets the board on this device; a hosted board lives on elsewhere. */
export async function removeBoard(
  session: BoardSession,
  storage: Storage = localStorage,
): Promise<void> {
  const { boardId } = session.getSnapshot()
  const persistence = session.persistence()
  const assets = session.assets()
  await session.destroy()
  await persistence?.clear()
  await assets.delete()
  clearKeys(boardId, storage)
  clearAliasesTo(boardId, storage)
  removeRecent(boardId, storage)
}
```

`session.destroy()` closes the asset store; `assets.delete()` reopens the `idb` promise it holds only to close it again before deleting. If `deleteDB` hangs on a still-open connection in the test, call `assets.delete()` before `session.destroy()` and drop the `assets.destroy()` call from `destroy` when the store was already deleted (guard with a `deleted` flag inside `createAssetStore`).

- [ ] **Step 4: Implement the menu and help**

`components/overflow-menu.tsx`:

```tsx
import type { Editor } from '@tlwb/engine'
import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { download, duplicateBoard, removeBoard } from '../session/board-actions'
import type { BoardSession } from '../session/board-session'
import './overflow-menu.css'

export function OverflowMenu(props: { session: BoardSession; editor: Editor }) {
  const { session, editor } = props
  const [open, setOpen] = useState(false)
  const name = () => session.store.getMeta().name || 'board'
  const run = (action: () => Promise<void> | void) => async () => {
    setOpen(false)
    await action()
  }
  return (
    <div className="overflow">
      <button type="button" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={18} />
      </button>
      {open ? (
        <menu>
          <li>
            <button type="button" onClick={run(async () => download(await editor.exportPng({ background: '#FFFFFF', scale: 2 }), `${name()}.png`))}>
              Export PNG
            </button>
          </li>
          <li>
            <button type="button" onClick={run(() => download(new Blob([editor.exportSvg({ background: '#FFFFFF' })], { type: 'image/svg+xml' }), `${name()}.svg`))}>
              Export SVG
            </button>
          </li>
          <li>
            <button type="button" onClick={run(async () => { const id = await duplicateBoard(session); location.assign(`/b/${id}`) })}>
              Duplicate
            </button>
          </li>
          <li>
            <button type="button" onClick={run(async () => { await removeBoard(session); location.assign('/') })}>
              Remove from this browser
            </button>
          </li>
        </menu>
      ) : null}
    </div>
  )
}
```

`overflow-menu.css`:

```css
.overflow {
  position: relative;
}

.overflow > button {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  cursor: pointer;
}

.overflow menu {
  position: absolute;
  top: 40px;
  right: 0;
  min-width: 200px;
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}

.overflow menu button {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: var(--radius);
  background: none;
  text-align: left;
  cursor: pointer;
}

.overflow menu button:hover {
  background: var(--paper);
}
```

`components/help-button.tsx`:

```tsx
import { CircleHelp } from 'lucide-react'
import { useRef } from 'react'

const SHORTCUTS: Array<[string, string]> = [
  ['1 to 0, E', 'Tools'],
  ['Space + drag, wheel', 'Pan and zoom'],
  ['Cmd/Ctrl + Z, Shift + Cmd/Ctrl + Z', 'Undo, redo'],
  ['Cmd/Ctrl + A, D, G, Shift + G', 'Select all, duplicate, group, ungroup'],
  ['Delete, arrows', 'Delete, nudge'],
  ['Double-click', 'Edit text or label a shape'],
]

export function HelpButton() {
  const ref = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button type="button" className="help-button" aria-label="Help" onClick={() => ref.current?.showModal()}>
        <CircleHelp size={18} />
      </button>
      <dialog ref={ref} className="share-dialog">
        <h2>Shortcuts</h2>
        <dl>
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt><kbd>{keys}</kbd></dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="close" onClick={() => ref.current?.close()}>Close</button>
      </dialog>
    </>
  )
}
```

Add to `board.css`:

```css
.help-button {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-3);
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  cursor: pointer;
  z-index: 10;
}
```

In `board-app.tsx`: pass `menu={<OverflowMenu session={session} editor={editor} />}` to `PresenceStack` (hidden in view mode by not rendering the stack's menu when `snapshot.role === 'view'`: pass `menu={snapshot.role === 'view' ? null : <OverflowMenu ... />}`), and render `<HelpButton />`.

- [ ] **Step 5: Run tests and checks**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check`
Expected: PASS. In the dev server, Export PNG downloads a file with the drawing, Duplicate opens a copy, Remove returns to the landing and the old URL shows not-found.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): export, duplicate, and remove boards from the overflow menu"
```

---

### Task 16: Landing page

**Files:**
- Modify: `apps/web/index.html` (replace the placeholder)
- Create: `apps/web/src/landing/landing.css`, `apps/web/src/landing/recents.ts`, `apps/web/public/favicon.svg`, `apps/web/public/editor-preview.svg`
- Test: `apps/web/test/landing/recents.test.ts`

**Interfaces:**
- Consumes: `listRecents` from `src/board/session/recents.ts`.
- Produces: `renderResume(container: HTMLElement, recents: RecentBoard[]): void`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/landing/recents.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderResume } from '../../src/landing/recents'

describe('renderResume', () => {
  it('renders nothing for an empty index', () => {
    const container = document.createElement('div')
    renderResume(container, [])
    expect(container.innerHTML).toBe('')
  })

  it('lists up to five boards as links', () => {
    const container = document.createElement('div')
    renderResume(
      container,
      Array.from({ length: 7 }, (_, i) => ({
        id: `b${i}`,
        name: i === 0 ? '' : `Board ${i}`,
        updatedAt: 1,
      })),
    )
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(5)
    expect(links[0]?.getAttribute('href')).toBe('/b/b0')
    expect(links[0]?.textContent).toContain('Untitled')
    expect(container.querySelector('h2')?.textContent).toBe('Resume')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tlwb/web test -- test/landing/recents.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/landing/recents.ts`**

```ts
import { listRecents, type RecentBoard } from '../board/session/recents'

export function renderResume(container: HTMLElement, recents: RecentBoard[]): void {
  container.replaceChildren()
  if (recents.length === 0) {
    return
  }
  const heading = document.createElement('h2')
  heading.textContent = 'Resume'
  const list = document.createElement('ul')
  for (const board of recents.slice(0, 5)) {
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = `/b/${board.id}`
    link.textContent = board.name || 'Untitled'
    item.append(link)
    list.append(item)
  }
  container.append(heading, list)
}

const target = document.getElementById('resume')
if (target) {
  renderResume(target, listRecents())
}
```

- [ ] **Step 4: Write the landing**

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>tlwb, the little whiteboard</title>
    <meta name="description" content="An instant, collaborative whiteboard your AI agents can draw on. Open a link, sketch, share, and let agents read and edit your boards through MCP." />
    <meta property="og:title" content="tlwb, the little whiteboard" />
    <meta property="og:description" content="Instant, collaborative, agent-friendly." />
    <meta property="og:image" content="/editor-preview.svg" />
    <link rel="icon" href="/favicon.svg" />
    <link rel="stylesheet" href="/src/styles/tokens.css" />
    <link rel="stylesheet" href="/src/landing/landing.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="logo" href="/">tlwb</a>
      <span class="sign-in" title="Coming soon">Sign in</span>
    </header>
    <main>
      <section class="hero">
        <h1>The instant little whiteboard, for you, your team, and your agents.</h1>
        <p>Open a link, sketch with a hand-drawn feel, collaborate live, and let your AI agents read and edit the board.</p>
        <a class="cta" href="/b/new">Draw now</a>
        <p class="hint">No account. Your boards stay in this browser until you share them.</p>
        <div id="resume" class="resume"></div>
        <img class="preview" src="/editor-preview.svg" alt="The tlwb editor showing a hand-drawn architecture diagram with a human and an agent cursor" width="1200" height="720" />
      </section>
      <section class="proof">
        <article><h2>Instant</h2><p>A board is a URL. One click and you are drawing; nothing to install, nothing to sign.</p></article>
        <article><h2>Collaborative</h2><p>Share a link, edit or view only, and see everyone's cursor as they draw.</p></article>
        <article><h2>Your agents via MCP</h2><p>Claude Code, Claude Desktop, or any MCP client joins the board as a badged collaborator.</p></article>
      </section>
      <section class="open-source">
        <h2>Open source</h2>
        <p>The engine, this client, and the MCP server are MIT licensed. Self-host the whole thing with one <code>docker compose up</code>.</p>
        <a href="https://github.com/jdevelop-io/tlwb">GitHub</a>
      </section>
      <section class="pricing">
        <h2>Pricing</h2>
        <div class="plans">
          <article><h3>Free</h3><p>Unlimited local boards, sharing by link, agent access with fair use.</p></article>
          <article><h3>Pro <small>coming soon</small></h3><p>Unlimited hosted boards and team features.</p></article>
        </div>
      </section>
    </main>
    <footer class="site-footer">
      <span>tlwb by JDevelop</span>
      <a href="https://github.com/jdevelop-io/tlwb">Source</a>
    </footer>
    <script type="module" src="/src/landing/recents.ts"></script>
  </body>
</html>
```

`src/landing/landing.css`:

```css
.site-header,
.site-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-3) var(--space-4);
}

.logo {
  font: 700 28px var(--font-hand);
  color: var(--accent);
  text-decoration: none;
}

.sign-in {
  color: var(--muted);
}

main {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 var(--space-4) var(--space-5);
}

.hero {
  text-align: center;
  padding: var(--space-5) 0;
}

.hero h1 {
  max-width: 720px;
  margin: 0 auto var(--space-3);
  font: 700 40px/1.15 var(--font-hand);
}

.hero > p {
  max-width: 560px;
  margin: 0 auto var(--space-4);
  font-size: 16px;
  color: var(--muted);
}

.cta {
  display: inline-block;
  padding: 12px 28px;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--surface);
  font-size: 16px;
  font-weight: 600;
  text-decoration: none;
}

.hint {
  margin-top: var(--space-2);
  font-size: 12px;
}

.resume {
  margin: var(--space-3) auto 0;
}

.resume h2 {
  font-size: 14px;
  color: var(--muted);
}

.resume ul {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  padding: 0;
  list-style: none;
}

.resume a {
  display: inline-block;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: inherit;
  text-decoration: none;
}

.preview {
  width: 100%;
  height: auto;
  max-width: 100%;
  margin-top: var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}

.proof {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-4);
  padding: var(--space-5) 0;
}

.proof h2,
.open-source h2,
.pricing h2 {
  margin: 0 0 var(--space-2);
  font-size: 20px;
}

.open-source,
.pricing {
  padding: var(--space-4) 0;
  border-top: 1px solid var(--border);
}

.plans {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-4);
}

.plans article {
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.plans small {
  font-weight: 400;
  color: var(--muted);
}

.site-footer {
  font-size: 12px;
  color: var(--muted);
}
```

`public/favicon.svg`: a 32 by 32 SVG with a rounded coral square and a white hand-drawn "t" in Caveat (`<text font-family="Caveat, cursive" font-weight="700">t</text>`). `public/editor-preview.svg`: a 1200 by 720 SVG with a white canvas, the toolbar as a rounded rectangle at the top, three sketchy boxes linked by arrows labeled "client", "api", "db", a coral cursor labeled "Ada", and a violet cursor labeled "Claude (agent)". Both hand-written, no external references.

- [ ] **Step 5: Run tests, checks, and look**

Run: `pnpm --filter @tlwb/web test && pnpm --filter @tlwb/web typecheck && pnpm check && pnpm --filter @tlwb/web build`
Expected: PASS, `dist/` holds `index.html` and `board.html`. In the dev server, `/` shows the landing; after opening a board, "Resume" lists it under the CTA. At 375 px wide nothing overflows horizontally.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "✨ feat(web): add the landing page with a resume list"
```

---

### Task 17: Docker image, Caddy, Compose, root README

**Files:**
- Create: `apps/web/Dockerfile`, `apps/web/Caddyfile`
- Modify: `docker-compose.yml`, `README.md` (package list and a "Running the product" section), `.dockerignore` (add `apps/web/dist`, `**/test-results`, `**/playwright-report`)

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tlwb/web build

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 8080
```

- [ ] **Step 2: Write the Caddyfile**

```
:8080 {
	root * /srv
	encode gzip

	@api path /api/*
	handle @api {
		uri strip_prefix /api
		reverse_proxy collab-server:3000
	}

	@ws path /ws/*
	handle @ws {
		reverse_proxy collab-server:3000
	}

	@board path /b/*
	handle @board {
		rewrite * /board.html
		file_server
	}

	handle {
		try_files {path} {path}.html
		file_server
	}
}
```

- [ ] **Step 3: Add the service to Compose**

In `docker-compose.yml`, change the server's `CORS_ORIGIN` to `http://localhost:8080` and append:

```yaml
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "8080:8080"
    depends_on:
      - collab-server
```

- [ ] **Step 4: Build and run the stack**

Run: `docker compose up --build -d && sleep 5 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/ && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/b/whatever && curl -s -X POST -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/boards`
Expected: `200`, `200`, `201`. In a browser on `http://localhost:8080`, "Draw now", draw, Share, open the link in a private window: live collaboration through Caddy. Then `docker compose down`.

- [ ] **Step 5: Update the root README**

Add to the package list: "`apps/web`: the product's client. A static landing page and the board editor (React), served by Caddy on the same origin as the collaboration server. Local-first boards, sharing by link, presence, image assets, export." Add a section after "Getting started":

```md
## Running the product

```bash
docker compose up --build
```

Then open `http://localhost:8080`. For development, run Postgres and
the server (`docker compose up -d postgres`, then
`DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb CORS_ORIGIN=http://localhost:5173 pnpm --filter @tlwb/collab-server dev`)
and the web application (`pnpm --filter @tlwb/web dev`) on
`http://localhost:5173`; the Vite server proxies `/api` and `/ws` to
the collaboration server.
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/Dockerfile apps/web/Caddyfile docker-compose.yml README.md .dockerignore
git commit -m "📦 build(web): serve the application through Caddy in the Compose stack"
```

---

### Task 18: End-to-end journeys and CI

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/board.spec.ts`
- Modify: `.github/workflows/ci.yml` (new `e2e` job), `.gitignore` (add `test-results/`, `playwright-report/`)

- [ ] **Step 1: Configure Playwright**

`apps/web/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      command: 'pnpm --filter @tlwb/collab-server start',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      env: {
        DATABASE_URL: databaseUrl,
        CORS_ORIGIN: 'http://localhost:5173',
        PORT: '3000',
      },
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
```

Run `pnpm --filter @tlwb/web exec playwright install chromium` once locally.

- [ ] **Step 2: Write the journeys**

`apps/web/e2e/board.spec.ts`:

```ts
import { expect, type Page, test } from '@playwright/test'

async function elementCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { tlwb: { session: { store: { listElements(): unknown[] } } } })
        .tlwb.session.store.listElements().length,
  )
}

async function drawRectangle(page: Page, x = 400, y = 300): Promise<void> {
  await page.keyboard.press('3')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 120, y + 80, { steps: 5 })
  await page.mouse.up()
}

async function shareLink(page: Page, role: 'Can edit' | 'View only'): Promise<string> {
  await page.getByRole('button', { name: 'Share' }).click()
  await page.getByRole('button', { name: 'Create link' }).click()
  await page.getByRole('radio', { name: role }).check()
  const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue()
  await page.getByRole('button', { name: 'Close' }).click()
  return link
}

test('a local board survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Draw now' }).click()
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{21}$/)
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await drawRectangle(page)
  await expect.poll(() => elementCount(page)).toBe(1)
  await page.reload()
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await expect.poll(() => elementCount(page)).toBe(1)
})

test('an edit link collaborates live in both directions', async ({ browser, page }) => {
  await page.goto('/b/new')
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await drawRectangle(page)
  const link = await shareLink(page, 'Can edit')
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/)

  const other = await browser.newContext()
  const guest = await other.newPage()
  await guest.goto(link)
  await guest.getByRole('radio', { name: 'Select (1)' }).waitFor()
  await expect.poll(() => elementCount(guest)).toBe(1)
  await expect(guest.getByRole('button', { name: /Otter|Fox|Heron|Panda|Lynx|Koala/ }).nth(1)).toBeVisible()

  await drawRectangle(guest, 700, 400)
  await expect.poll(() => elementCount(page)).toBe(2)
  await other.close()
})

test('a view link shows the board and refuses to draw', async ({ browser, page }) => {
  await page.goto('/b/new')
  await page.getByRole('radio', { name: 'Select (1)' }).waitFor()
  const link = await shareLink(page, 'View only')

  const other = await browser.newContext()
  const viewer = await other.newPage()
  await viewer.goto(link)
  await expect(viewer.getByText('View only')).toBeVisible()
  await expect(viewer.getByRole('radio', { name: 'Select (1)' })).toHaveCount(0)

  await drawRectangle(page)
  await expect.poll(() => elementCount(viewer)).toBe(1)
  await drawRectangle(viewer, 700, 400)
  await expect.poll(() => elementCount(viewer)).toBe(1)
  await other.close()
})
```

The presence assertion in the second test relies on the generated identity names of Task 4; keep the list in sync if the animals change.

- [ ] **Step 3: Run locally**

Run: `docker compose up -d postgres && pnpm --filter @tlwb/web e2e`
Expected: 3 passed. If the first drag lands on the toolbar, raise the y coordinates in `drawRectangle`.

- [ ] **Step 4: Add the CI job**

Append to `.github/workflows/ci.yml`:

```yaml
  e2e:
    name: End to end
    runs-on: ubuntu-latest
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
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/setup@v2
        with:
          runtime: node@24
          cache: true
          install: false
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Install Chromium
        run: pnpm --filter @tlwb/web exec playwright install --with-deps chromium
      - name: Build the web application
        run: pnpm --filter @tlwb/web build
      - name: Run the journeys
        run: pnpm --filter @tlwb/web e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/playwright-report
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e .github/workflows/ci.yml .gitignore
git commit -m "🧪 test(web): prove the local, edit, and view journeys end to end"
```

---

### Task 19: Verification

- [ ] **Step 1: Full workspace checks**

Run: `pnpm check && pnpm typecheck && DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb pnpm test && pnpm --filter @tlwb/web build && pnpm --filter @tlwb/web e2e`
Expected: every command exits 0.

- [ ] **Step 2: Walk the success criteria of the spec (section 10)**

With `docker compose up --build`: the landing answers on 8080, "Draw now" opens a board that survives a reload, Share yields edit and view links that work in another browser with live cursors, the view link cannot write, and every chrome element of product design section 5.1 is present with the Agents block as a placeholder.

- [ ] **Step 3: Amend the web specification**

In `.claude/superpowers/specs/2026-08-26-tlwb-web-app-design.md`: the fragment is `#edit=` / `#view=` (section 2, section 4 "Opening" and "Sharing"), and "not found" is decided from the loaded document's meta rather than `indexedDB.databases()` (section 4 "Opening", step 4). Add a section 12 "Amendments" dated 2026-08-26 recording both.

- [ ] **Step 4: Commit and push**

```bash
git add .claude/superpowers/specs/2026-08-26-tlwb-web-app-design.md
git commit -m "📝 docs(web): true up the design specification with the shipped application"
git push
```
