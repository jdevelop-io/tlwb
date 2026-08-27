# tlwb web application: design

Date: 2026-08-26
Status: approved
Parent specification: `2026-08-07-tlwb-product-design.md` (sections 5.1
"Board editor" and 5.2 "Landing page")
Sibling specifications: `2026-08-25-tlwb-engine-editor-api-design.md`
(the editor the application mounts),
`2026-08-26-tlwb-store-yjs-design.md` (the primitives it composes), and
`2026-08-26-tlwb-collab-server-design.md` (the server it talks to)

## 1. Scope and goal

This specification covers `apps/web`: the client application that turns
the engine, the Yjs store, and the collaboration server into a product a
person can open in a browser. It ships two screens of the product
design: the landing page with its "Draw now" call to action, and the
board editor with its full chrome, sharing by link, real-time presence,
and export.

After this work, `docker compose up` serves the complete product: a
visitor draws without an account on a local-first board, presses Share,
sends a link, and collaborates in real time with whoever holds it, in
edit or in view mode. The same build serves the SaaS and the self-hosted
edition.

The dashboard and the Agents / MCP screen of the product design depend
on accounts and on the MCP server, which have their own specifications.
This one leaves them out; section 10 lists what else it excludes.

## 2. Decisions and rationale

- **One Vite application, two HTML pages.** `index.html` is the landing,
  hand-written static HTML with no framework to hydrate; `board.html`
  mounts the editor as a client-side application on `/b/:id`. Search
  engines only need the landing: boards are private and carry
  `<meta name="robots" content="noindex">`. Server-side rendering would
  add a runtime and a deployment topology for a page that is static
  anyway; a meta-framework (Astro first) is the upgrade path if the
  landing grows a blog or documentation.
- **React 19 for the editor chrome.** The toolbar, the contextual panel,
  the share dialog, the presence stack, and the text editor react to
  the editor's state; `editor.subscribe` feeds `useSyncExternalStore`,
  with no state library. React is what open-source contributors know,
  and the engine stays framework-agnostic: React never touches the
  canvas.
- **The server issues hosted board ids.** `POST /boards` no longer
  accepts a client-chosen id; it generates one and returns it with the
  keys. A local id never leaves the browser (a client-chosen id would
  travel in the `Referer` of every third-party request and could be
  claimed by whoever sees it), and the "local board becomes a hosted
  board" migration this forces is the same one accounts will need to
  adopt anonymous boards later.
- **Share keys travel in the URL fragment.** `/b/<id>#edit=<key>` or
  `/b/<id>#view=<key>` keeps the key out of server logs and `Referer`
  headers. The application stores the key locally on first open and
  strips it from the address bar.
- **A local index of recent boards.** Without a dashboard, an anonymous
  board kept "indefinitely" in IndexedDB would be lost with its URL.
  A localStorage index feeds a "Recent boards" menu in the editor and a
  "Resume" list on the landing; it is also the source accounts will
  adopt from later.
- **A generated presence identity, editable in place.** A name of the
  form "Curious Otter" and a marker color are drawn once and kept in
  localStorage; clicking one's own avatar renames. Zero friction before
  drawing, and accounts will replace the source of the name.
- **Plain CSS with custom properties.** The product design fixes the
  tokens; a shared `tokens.css` and one stylesheet per component carry
  them. Ten components do not pay back a utility framework or a CSS
  build step. Inter and Caveat are self-hosted through `@fontsource`:
  no Google Fonts request, so no `Referer` leak and no consent banner.
- **Same origin in production.** A Caddy container serves the static
  build and proxies `/api/*` and `/ws/*` to the collaboration server.
  The application uses relative URLs, needs no `VITE_*` configuration,
  and CORS never enters the picture. In development the Vite server
  proxies the same paths to `localhost:3000`.
- **Unit tests for the logic, two end-to-end journeys for the
  assembly.** Vitest with happy-dom covers the session layer and the
  components that carry logic; Playwright against the real server and
  Postgres proves that the three packages fit together, which nothing
  else in the repository does.

## 3. Package and architecture

Package `@tlwb/web` in `apps/web`, Vite 7, React 19, TypeScript, Biome
from the workspace root.

```
apps/web/
  index.html              landing: static HTML, tokens.css, landing.css
  board.html              mounts the editor application
  src/
    landing/
      recents.ts          injects the "Resume" list under the CTA
    board/
      main.tsx            reads the URL, resolves aliases, mounts <BoardApp>
      session/            the layer without React
        board-session.ts  composes doc, store, persistence, assets,
                          connection, presence, editor
        share.ts          local to hosted migration
        identity.ts       presence name and color
        recents.ts        index of opened boards
        keys.ts           share keys in localStorage, fragment reading
        server.ts         HTTP client (createBoard, putAsset)
      hooks/
        use-editor-state.ts, use-presence.ts, use-connection.ts
      components/
        board-app.tsx, toolbar.tsx, context-panel.tsx, top-bar.tsx,
        board-menu.tsx, presence-stack.tsx, share-dialog.tsx,
        zoom-controls.tsx, help-button.tsx, text-editor.tsx, banner.tsx
        (one .css next to each)
    styles/
      tokens.css          shared by both pages
  e2e/                    Playwright journeys
  public/                 landing image, favicon
  Dockerfile, Caddyfile, vite.config.ts, playwright.config.ts
```

Dependency rule: `session/` knows neither React nor the DOM beyond what
`createEditor` requires; it is the layer Vitest exercises without a
component. React owns the chrome only and reads the editor's state by
subscription. The canvas, rendering, tools, and hit-testing stay in the
engine. The application never imports `yjs`: the document and the
awareness are opaque handles it passes between `@tlwb/store-yjs` and
`@tlwb/engine`.

Routing: two routes, `/` and `/b/:id`, read from `location.pathname`.
No router library. `/b/new` is a real address the landing links to;
`board.html` resolves it by generating an id and replacing the URL, so
the call to action stays a plain anchor.

Dependencies added: `react`, `react-dom`, `lucide-react`, `nanoid`,
`@fontsource/inter`, `@fontsource/caveat`; in development `vite`,
`@vitejs/plugin-react`, `vitest`, `happy-dom`, `fake-indexeddb`,
`@testing-library/react`, `@playwright/test`.

## 4. Board lifecycle

### Creation

"Draw now" on the landing and "New board" in the board menu open
`/b/new`; `main.tsx` generates `nanoid()` (21 characters) and replaces
the URL with `/b/<id>`. The session then runs `createBoardDoc`,
`createYjsBoardStore`, `persistBoard(doc, id)`, and awaits
`whenLoaded`. When the document is empty and carries no meta, the
session writes `store.setMeta({ name: 'Untitled', createdAt })`. With no
key stored for the id, presence rides a `createLocalAwareness` with
zero peers. No server call is made.

### Opening

`main.tsx` resolves the address in this order:

1. `tlwb:alias:<id>` exists in localStorage: `location.replace` to
   `/b/<newId>`.
2. The fragment carries `#edit=<key>` or `#view=<key>`: store it under
   `tlwb:keys:<id>` with the matching role, then `history.replaceState`
   without the fragment.
3. A key is known for the id: `connectBoard(doc, { url: '/ws', boardId,
   token })`, the connection's awareness, `createPresence` with the
   local identity. The role (edit or view) is the one recorded with the
   key; a view key switches the editor to `setReadOnly(true)` with a
   "View only" banner. The server stays the judge and closes writes
   from a view connection with `4403`.
4. Neither a key nor a stored board: the session opens the local
   IndexedDB document anyway and awaits `whenLoaded`; if it loaded with
   no meta (`createdAt === 0`), nothing was ever written under this id,
   so it shows the "Board not found or incomplete link" screen with a
   "New board" button. A shared board opened once keeps opening from
   its local copy, since that copy already carries meta.

### Sharing: the local to hosted migration

`share.ts` runs these steps in order; a board that is already hosted
opens the dialog on its links directly, and the Share button is
disabled while a migration is in flight:

1. `POST /api/boards` returns `201 { boardId, editKey, viewKey }`. Any
   failure stops here: nothing local has changed, the dialog reports
   "Could not create the link, try again".
2. `persistBoard(doc, newId)` on the same document, then await
   `whenLoaded`: y-indexeddb writes the current state into the new
   database.
3. Every blob in the local asset store is uploaded with `PUT
   /api/boards/<newId>/assets/<sha256>` and the edit key. A failure
   rolls back: the new database is destroyed and deleted, and the board
   stays local with the dialog reporting the error.
4. The keys are stored under `tlwb:keys:<newId>` with the edit role, the
   alias `tlwb:alias:<oldId> = newId` is written, the recents index is
   rewritten under the new id, the old persistence is destroyed and its
   database deleted, and `history.replaceState` moves the address to
   `/b/<newId>`.
5. `connectBoard` starts; the local awareness is destroyed and presence
   is recreated on the connection's awareness, without unmounting the
   editor: `editor.setPresence` simply receives the new peer list.

Links are built on demand by the dialog: `/b/<id>#edit=<editKey>` or
`/b/<id>#view=<viewKey>` according to the toggle.

### Assets

`createAssetStore(id)` backs every board. On a hosted board the image
tool writes the blob locally, then `PUT`s it to the server before the
element is created; if the upload fails, no element is created and a
toast states the reason (`415`, size, network). There is no retry
queue. The editor's `resolveImageUrl` returns an object URL from the
local store, and falls back to `/api/boards/<id>/assets/<hash>` when
the blob is absent locally (an image another collaborator added).

### Recent boards

`recents.ts` keeps `tlwb:recents`, an array of `{ id, name, updatedAt }`
capped at 50, most recent first. The session writes an entry when a
board opens and on every meta or element change, debounced at one
second. "Remove from this browser" deletes the entry.

### Identity

`identity.ts` keeps `tlwb:identity` as `{ name, color }`. On first read
it draws an adjective and an animal ("Curious Otter") and one of the
six marker colors of the drawing palette, and stores them. Renaming
through the presence stack rewrites the entry and the presence.

### Overflow menu

Export PNG and SVG through the engine, with the host triggering the
download from an object URL. "Duplicate" creates a new local id and
imports `exportSnapshot()` of the current board. "Remove from this
browser" destroys and deletes the IndexedDB databases, the keys, the
alias entries pointing at the id, and the recents entry; a hosted board
keeps existing for everyone else, since server-side deletion belongs to
accounts.

## 5. Editor chrome and data flow

### Mounting

`<BoardApp session>` renders a full-screen `<div class="board">`; a
`useEffect` calls `createEditor({ container, store, resolveImageUrl,
getPendingImage, onTextEditRequest, onCursorMove })` and destroys it on
unmount. Every chrome component is an absolutely positioned sibling
above the container, with pointer events limited to its own box so the
canvas receives everything else.

### Reading state

- `useEditorState()` is `useSyncExternalStore(editor.subscribe,
  editor.getState)`: `activeTool`, `selectedIds`, `camera`, `readOnly`,
  `canUndo`, `canRedo`.
- The contextual panel reads the selected elements through
  `store.listElements()` filtered on `selectedIds`, under the same
  subscription.
- `usePresence()` subscribes to the awareness, runs `sanitizePeers`,
  and feeds both the presence stack and `editor.setPresence`.
- `useConnection()` subscribes to `subscribeStatus` and to the
  persistence's state to derive the save indicator.

### Components

- `Toolbar` (top center): select, hand, rectangle, ellipse, diamond,
  arrow, line, draw, text, image, eraser, each showing the numeric
  shortcut the engine already handles. The image tool opens an
  `<input type="file" accept="image/*">`, hashes the file with
  `crypto.subtle.digest`, stores it (and uploads it on a hosted board),
  then exposes it through `getPendingImage`.
- `ContextPanel` (left), visible when there is a selection or a
  creation tool is active: stroke color, fill, stroke width, stroke
  style, sketchiness, text size, alignment, z-order. With a selection it
  calls `updateSelection(patch)`; without one, `setDefaults(patch)`.
- `TopBar` (top left): the logo opens `BoardMenu` (New board, Recent
  boards, Home); the board name is editable inline and writes
  `store.setMeta`; a discreet indicator shows "Saved", "Synced", or
  "Offline".
- `PresenceStack` (top right): one avatar per peer, colored, with an
  initial, and a violet badge when `isAgent`; the local user comes
  first and a click on it renames. Next to it the primary Share button
  and the overflow menu (export PNG, export SVG, duplicate, remove from
  this browser).
- `ShareDialog`: a native `<dialog>`. On a local board it explains what
  sharing does and offers "Create link", which runs the migration. On a
  hosted board it shows the Edit / View toggle, the link, "Copy", and an
  "Agents" block that links to the MCP documentation, to be wired by
  the MCP specification.
- `ZoomControls` (bottom left): minus, percentage (click resets to
  100 %), plus, undo, redo.
- `HelpButton` (bottom right): a `<dialog>` listing the shortcuts.
- `TextEditor`: a `<textarea>` positioned with `getElementScreenRect`,
  its font set through `fontString` and sized with `measureText` on a
  shared 2D context so line breaks agree with the renderer; it follows
  the camera while editing, commits on blur and on Escape, and Enter
  inserts a line break.
- `Banner`: view-only mode, a lost link, a storage warning, or "Board
  not found".

`document.title` is `<name> · tlwb`.

## 6. Landing page

`index.html`, static, sections in the product design's order:

1. Hero: the one-sentence promise, the "Draw now" anchor to `/b/new`,
   and a static capture of the editor (the animated "agent drawing"
   preview waits for the MCP server).
2. Three proof blocks: Instant, Collaborative, Your agents through MCP.
3. Open source: the GitHub repository and the self-hosting mention.
4. Pricing: Free and Pro, Pro marked "coming soon".
5. A discreet sign-in link at the top right, disabled and marked
   "coming soon"; a sober footer.

The only script is `recents.ts`, which injects a "Resume" list under
the call to action when the index is not empty. The page is responsive
in CSS. It carries a title, a description, and Open Graph tags;
`board.html` carries `noindex`.

## 7. Server changes, configuration, deployment

### Collaboration server

Two changes in `apps/collab-server`, with its specification and README
amended:

- `POST /boards` takes no body. The server generates the id (`nanoid`,
  21 characters, within the alphabet `BOARD_ID` already validates) and
  answers `201 { boardId, editKey, viewKey }`. The `400` on a malformed
  id and the `409` on an existing one disappear from the endpoint; the
  id pattern stays enforced on every other route.
- Nothing else changes: the Caddy proxy strips the `/api` prefix, so the
  server keeps its routes at the root.

### Development

`vite.config.ts` proxies `/api` (with the prefix stripped) and `/ws`
(with `ws: true`) to `http://localhost:3000`. The server's
`CORS_ORIGIN` no longer matters for the application, since every
request is same-origin; the README keeps documenting it for other
clients.

### Production

`apps/web/Dockerfile` builds the application in one stage and copies
`dist` into `caddy:2-alpine`. The `Caddyfile` serves the static files,
rewrites `/b/*` to `board.html`, proxies `/api/*` to
`collab-server:3000` with `uri strip_prefix /api`, and proxies `/ws/*`
to the same upstream. `docker-compose.yml` gains a `web` service on port
8080 that depends on `collab-server`; the server's `CORS_ORIGIN` is set
to the web origin.

### Continuous integration

The existing workflow already runs `check`, `typecheck`, and `test`
recursively, so the unit tests join it. A separate job builds the
application and runs Playwright on Chromium against the collaboration
server started on the Postgres service.

## 8. Error handling

- Server unreachable on Share: the dialog stays in its local state with
  "Could not create the link, try again"; the local steps of the
  migration only run after the `201`.
- WebSocket closures: `4401` and `4404` show a permanent "This link is
  no longer valid" banner and delete the stored key; `4403` switches to
  view-only with its banner; `4422`, `4409`, and `4429` show a
  "Change refused by the server" toast while the provider reconnects on
  its own.
- Network loss: the indicator reads "Offline", the board stays editable
  locally, and the provider resynchronizes on return.
- IndexedDB unavailable (private browsing, quota): the board opens in
  memory with a "This browser is not saving this board" banner.
- Image refused (`415`, too large, network): a toast with the reason,
  no element created.
- Asset missing at render time: the engine draws its placeholder;
  nothing to do in the application.

## 9. Testing

Unit tests (Vitest, happy-dom, `fake-indexeddb`):

- `session/`: `keys` (fragment reading, URL stripping, role recording),
  `recents` (cap, ordering, removal), `identity` (stability, renaming),
  `share` (the full sequence against a fake `fetch` and real
  `@tlwb/store-yjs` primitives; a failing `POST` leaves everything
  intact; a failing asset upload rolls back).
- Components: `ShareDialog` (local and hosted states, toggle, copy),
  `ContextPanel` (patch to the selection or to the defaults),
  `TextEditor` (commit on blur and Escape, positioning), `TopBar`
  (renaming writes the meta). Toolbar, zoom, and presence are direct
  renderings of state and get no dedicated test.

End-to-end (Playwright, Chromium, the real server on the Postgres
service):

1. Draw now, draw a rectangle, reload: the rectangle is still there.
2. Share, open the edit link in a second browser context: the rectangle
   and the first context's cursor are visible; a rectangle drawn there
   appears in the first.
3. Open the view link in a second context: tools are hidden, the banner
   shows, and a rectangle drawn in the edit context appears.

## 10. Success criteria

- `docker compose up` serves the landing on port 8080; "Draw now" opens
  a board that survives a reload with no server call.
- Share produces edit and view links that work in another browser, with
  live cursors, and the view link cannot write.
- Every chrome element of product design section 5.1 is present except
  the Agents wiring, which is a placeholder.
- `pnpm check`, `pnpm typecheck`, `pnpm test`, and the Playwright job
  pass in CI.

## 11. Out of scope

Accounts, the dashboard, the Agents / MCP screen and the MCP server,
server-side board deletion, the animated agent preview on the landing,
dark mode, mobile layouts, `Y.Text` for concurrent editing of one text
element (last commit wins), an asset upload retry queue, and analytics.

## 12. Amendments

### 2026-08-26

Two decisions changed shape during implementation; this specification now
describes the shipped behavior.

- **Fragment naming.** The share key travels as `#edit=<key>` or
  `#view=<key>`, not the earlier `#k=<key>`. The role is read directly
  from which fragment name is present, rather than carried separately.
- **"Not found" detection.** The session no longer calls
  `indexedDB.databases()` to decide whether a board id is known. It
  opens the local IndexedDB document unconditionally and awaits
  `whenLoaded`; the "Board not found or incomplete link" screen shows
  only when that document loaded with no meta (`createdAt === 0`) and no
  key was found for the id. This reads the decision from the loaded
  document itself instead of enumerating databases, which also sidesteps
  browsers where `indexedDB.databases()` is unavailable.
