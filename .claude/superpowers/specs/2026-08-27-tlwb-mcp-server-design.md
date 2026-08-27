# tlwb MCP server: design

Date: 2026-08-27
Status: approved
Parent specification: `2026-08-07-tlwb-product-design.md` (section 6,
"Agent UX and MCP surface")
Sibling specifications: `2026-08-26-tlwb-collab-server-design.md` (the
process this server lives in) and `2026-08-26-tlwb-store-yjs-design.md`
(the store the agent mutates through)

## 1. Scope and goal

This specification covers the MCP (Model Context Protocol) surface of
tlwb: the endpoint an AI agent connects to in order to create boards,
read them, draw on them, and see them as an image. After this work, a
person pastes `{ "url": "https://<domain>/mcp" }` into Claude Code,
Claude Desktop, or any MCP client, hands the agent a board's share link,
and watches the agent draw in real time in the browser, badged as an
agent in the avatar stack.

The server is a route of `apps/collab-server`, not a new deployment. It
reuses the board keys, the rooms, the validation, and the persistence
that already exist; it adds the MCP transport, six tools, a virtual
room connection for the agent, and server-side PNG rendering.

Accounts do not exist yet. The product specification ties MCP tokens to
accounts; until accounts ship, the credential is the board's share key,
carried in the share URL the human already copies from the Share dialog.
Account-scoped tokens, `list_boards`, and MCP quotas arrive with the
accounts specification.

## 2. Decisions and rationale

- **Board key as the credential.** An agent authenticates per board with
  the same `editKey` or `viewKey` a human uses, parsed from the share
  URL. No new table, no token lifecycle to design twice; the access
  control is `resolveRole` from `keys.ts`, unchanged. The cost is the
  absence of `list_boards`: there is nothing to list boards against.
- **Route in the collaboration server, streamable HTTP.** The MCP server
  mounts on `/mcp` in the existing Hono application through `@hono/mcp`,
  behind the same Caddy, on the same origin as the web application. One
  process, one deployment, and the agent writes into the room already in
  memory instead of opening a WebSocket to the process it runs in.
- **Stateless transport.** Every HTTP request gets its own transport;
  the server keeps no MCP session. Sessions over streamable HTTP are
  long-lived and often abandoned, and nothing in the tool surface needs
  state between two calls.
- **Virtual room connection, never a direct write.** The agent's
  mutation reaches the room as a Yjs update through
  `room.handleMessage`, the exact path a browser takes. Validation in
  the staging document, persistence, relay, and awareness need no second
  implementation. Writing into `room.doc` directly was rejected because
  it bypasses all four.
- **Engine elements, defaults filled.** The tool schema exposes the
  engine's element types with a small required core (`type`, `x`, `y`,
  `width`, `height`) and optional style and content properties.
  `createElement` fills the rest, `validateElement` in the room has the
  final word. No simplified vocabulary to keep in step with the engine.
- **Agent name as a tool parameter.** The stateless transport does not
  carry the MCP client's `initialize` information into a tool call, so
  mutation tools take an optional `agentName` (default `"Agent"`). The
  badge itself already exists: `Peer.isAgent` in the engine, the overlay
  cursor, and the `avatar-agent` class in the web application render it
  without change.
- **Ephemeral presence.** After an accepted mutation, the agent stays
  visible for five seconds with its cursor on the last element it
  touched, then leaves. Long enough for a human to see who drew, short
  enough that an abandoned agent never lingers.
- **Server-side PNG through `@napi-rs/canvas`.** The engine's
  `exportScenePng` takes a canvas factory; the engine tests already
  rasterize through `@napi-rs/canvas`. The same fonts as the web
  application (`@fontsource/inter`, `@fontsource/caveat`) are registered
  from their package files so the export matches the browser.

## 3. Architecture

New directory in `apps/collab-server/src`:

```
mcp/
  index.ts          createMcpApp(deps): Hono sub-application mounted on /mcp
  server.ts         builds the McpServer and registers the tools
  board-ref.ts      share URL -> { boardId, key }; role resolution
  agent-client.ts   the virtual room connection: read, mutate, present
  render.ts         PNG rendering with @napi-rs/canvas and the registered fonts
  tools/
    create-board.ts
    read-board.ts
    add-elements.ts
    update-elements.ts
    delete-elements.ts
    get-board-screenshot.ts
    elements.ts     zod schemas shared by the element tools
```

Dependencies added to `apps/collab-server`: `@modelcontextprotocol/sdk`,
`@hono/mcp`, `@napi-rs/canvas`, `@fontsource/inter`,
`@fontsource/caveat`, `zod`; `@tlwb/store-yjs` moves from
`devDependencies` to `dependencies`. `@tlwb/store-yjs` is imported for
`createYjsBoardStore` only; nothing in `mcp/` touches IndexedDB or
`y-websocket`.

`createApp` receives the room registry (`rooms`) in `HttpDeps`, which
`startServer` already holds, and mounts `createMcpApp` on `/mcp`. The
web application's `Caddyfile` gains a `/mcp` handle that proxies to
`collab-server:3000` without stripping the prefix.

### The virtual connection

`agent-client.ts` exposes one function:

```ts
withBoard<T>(
  deps, boardRef, needs: 'view' | 'edit',
  run: (client: AgentClient) => Promise<T>,
): Promise<T>
```

It acquires the room, resolves the role from the key, checks it against
`needs`, joins a `RoomConnection` whose `send` decodes the room's
messages into a local mirror `Y.Doc` (sync step 1 and step 2 exchanged
as a browser would, then updates and awareness applied as they arrive),
runs the callback, and finally leaves the room and releases it. The
mirror is per call: no state survives between two tool calls.

`AgentClient` offers:

- `store`: a `BoardStore` from `createYjsBoardStore(mirror)`, for
  reading and for building mutations with the engine's own helpers.
- `mutate(fn: (store) => void): Promise<void>`: runs `fn` inside one
  Yjs transaction on the mirror, captures the update bytes it produced,
  wraps them with `encodeUpdate`, submits them through
  `room.handleMessage`, awaits `room.drain()`, and resolves once the room
  accepted the update. A rejection is observed through the connection's
  `close` being called by the room with code `4422` (element rejected)
  or `4409` (document too large) and surfaces as an error carrying that
  reason.
- `present(touchedIds, agentName): Promise<void>`: publishes an
  awareness state `{ name, color, cursor, selectedIds, isAgent: true }`
  through `handleMessage`, where `cursor` is the center of the last
  touched element's bounds and `color` is the fixed agent color, then
  holds the connection open for `MCP_PRESENCE_MS` (default 5000) before
  `withBoard` leaves. Leaving removes the awareness states the
  connection owns; nothing else is needed.

Mutations run through the store interface (`applyChanges`) so that
`createElement`, `indexAfter`, and the store's own change events are the
ones used everywhere else. New elements receive `indexAfter(last)` in
batch order so a batch of elements stacks in the order given.

### Data flow of `add_elements`

1. The SDK validates the input against the zod schema.
2. `parseBoardRef(board)` yields `{ boardId, key }` or throws the URL
   error.
3. `withBoard(deps, ref, 'edit', ...)`: room acquired, role resolved,
   `view` refused, connection joined, mirror synchronized.
4. For each input element, `createElement(type, { index, id?, ...props })`
   builds a full element; `mutate` applies the `create` changes in one
   transaction.
5. The room validates every created element in staging, persists the
   update, relays it to every browser, and applies it to the room
   document; `mutate` resolves.
6. `present(ids, agentName)` shows the agent for five seconds.
7. The tool returns `{ ids }`.

## 4. Tool surface

Every tool takes `board: string`, the full share URL
`https://<host>/b/<boardId>#edit=<key>` or `#view=<key>`, except
`create_board`. The host is not checked: only the path and the fragment
are read, so a self-hosted deployment accepts its own links.

| Tool | Role | Input | Output |
| --- | --- | --- | --- |
| `create_board` | none | `{ name? }` | `{ boardId, editUrl, viewUrl }` |
| `read_board` | view | `{ board, image? }` | `{ meta, elements }` as JSON text, plus a PNG `image` content block when `image` is true |
| `add_elements` | edit | `{ board, elements: ElementInput[], agentName? }` | `{ ids }` in input order |
| `update_elements` | edit | `{ board, updates: { id, ...ElementPatch }[], agentName? }` | `{ updated }` |
| `delete_elements` | edit | `{ board, ids, agentName? }` | `{ deleted }` |
| `get_board_screenshot` | view | `{ board, scale? }` | a PNG `image` content block |

Batch sizes are bounded by the schema (`MCP_MAX_BATCH`, default 200
elements or ids per call).

### Element schemas (`tools/elements.ts`)

`ElementInput` is a discriminated union on `type`:

- Common, required: `type`, `x`, `y`, `width`, `height`.
- Common, optional: `id` (so an agent can bind an arrow to a shape
  created in the same batch), `angle`, `strokeColor`, `fillColor`,
  `strokeWidth`, `strokeStyle`, `sketchiness`, `opacity`, `groupId`.
- `line`, `draw`: `points` required (relative to `x`, `y`, as the engine
  stores them).
- `arrow`: `points` required, `startBinding` and `endBinding` optional
  `{ elementId }`.
- `text`: `text` required; `fontSize`, `fontFamily`, `textAlign`,
  `containerId` optional.
- `image`: refused by `add_elements` (no asset upload over MCP in this
  iteration); still present in `read_board` output.

Unspecified properties take `createElement`'s defaults: same look as a
shape drawn from the toolbar. `seed` and `index` are never accepted from
the agent.

`ElementPatch` is every optional property above, all optional, without
`type`; `text`, `points`, and bindings included for the variants that
have them. A patch that sets a property a variant does not have is
rejected by the room's validation, not by the schema, to keep the schema
small.

`read_board` returns elements in stacking order (`listElements()`),
complete, as the engine holds them, so what the agent reads is what it
can write back. `create_board` names the board through `setMeta` when
`name` is given, via the same virtual connection.

### PNG rendering (`render.ts`)

`renderPng(elements, scale)` calls `exportScenePng` with a canvas
factory backed by `@napi-rs/canvas` (wrapping `toBlob`, which napi
lacks, over `encode('png')`), fonts `{ hand: 'Caveat', ui: 'Inter' }`
registered once at module load from the `@fontsource` package files, and
`resolveImage` reading the board's assets from the database so image
elements render. `Path2D` is installed on `globalThis` from
`@napi-rs/canvas` at module load, as the engine tests do. `scale` is
bounded to `[0.25, 3]`; the output size is bounded by
`MCP_MAX_IMAGE_PIXELS` (default 16 million pixels) so a huge board
cannot exhaust memory, with an explicit error above the bound.

## 5. Presence

- Mutation tools call `present` after a successful `mutate`; read tools
  never publish awareness.
- Awareness payload: `{ name: agentName, color: AGENT_COLOR, cursor,
  selectedIds: touchedIds, isAgent: true }`, the shape
  `sanitizePeers` in the engine accepts. `agentName` is trimmed and
  bounded to 40 characters by the schema.
- The connection stays joined for `MCP_PRESENCE_MS`, then leaves; the
  room removes its awareness states on leave and every browser drops the
  avatar. The room is released after leaving. A server shutdown during
  that window closes the connection like any other and loses nothing.

## 6. Error handling

Every failure a tool can anticipate is returned as a tool result with
`isError: true` and a single explicit text; MCP protocol errors are
reserved for malformed requests, which the SDK produces itself.

| Case | Text |
| --- | --- |
| `board` is not a share URL | `board must be a share URL like https://<host>/b/<id>#edit=<key> or #view=<key>` |
| Board unknown | `board <id> not found` |
| Key matches neither hash | `key does not match board <id>` |
| `view` key on a mutation tool | `board <id> is view-only with this link` |
| Room rejects the batch | `elements rejected: <reason from the room>`; the whole batch is refused because it travels as one transaction |
| Document over `MAX_DOC_BYTES` | `board <id> exceeds the size limit` |
| `update_elements` or `delete_elements` names an unknown id | `element <id> not found`; checked on the mirror before `mutate`, whole batch refused |
| `add_elements` with `type: 'image'` | `image elements cannot be added over MCP` |
| Screenshot over the pixel bound | `board <id> is too large to render; lower scale` |
| Creation bucket empty | `too many boards created from this address, retry later` |

Rate limiting: `POST /mcp` is bounded per client IP with the existing
`createTokenBucket` (`MCP_LIMIT_PER_MIN`, default 120), using
`clientIp` and `TRUST_PROXY` exactly as `POST /boards` does; a refused
request answers `429` before reaching the MCP transport. `create_board`
additionally takes from the board creation bucket shared with
`POST /boards`.

Configuration added to `config.ts`: `PUBLIC_URL` (default `CORS_ORIGIN`),
`MCP_LIMIT_PER_MIN` (120), `MCP_PRESENCE_MS` (5000), `MCP_MAX_BATCH`
(200), `MCP_MAX_IMAGE_PIXELS` (16000000).

Logging follows the existing JSON `log`: one line per tool call with the
tool name, the board id, the outcome, and the duration; never the key.

## 7. Testing

1. **Unit, `board-ref`:** URL parsing (both fragments, missing fragment,
   query string refused, foreign host accepted), role resolution against
   `keys.ts`.
2. **Unit, `agent-client`:** against a real `createRoom` with in-memory
   `persist` and `applied`, as `room.test.ts` does: a mirror synchronized
   from a non-empty room, an accepted mutation visible to a second
   connection, a rejected mutation surfacing the room's reason, awareness
   published then removed on leave.
3. **Unit, `render`:** a PNG signature and expected dimensions for a
   small scene, the pixel bound refused.
4. **Tools:** the SDK `Client` over `InMemoryTransport` against the
   `McpServer`, one test per tool for the happy path and one per row of
   the error table.
5. **HTTP:** `app.request('/mcp', ...)` for the rate limit and for a
   round trip of one tool call through `@hono/mcp`.
6. **End to end** (existing `e2e.test.ts`, Postgres): `create_board`
   over HTTP `/mcp`, `add_elements`, a `connectBoard` client over `/ws`
   sees the elements arrive and the agent peer appear then disappear;
   `get_board_screenshot` returns a valid PNG; the elements survive a
   restart of the server.

## 8. Success criteria

- `{ "url": "http://localhost:8080/mcp" }` pasted into Claude Code
  connects and lists the six tools.
- Given an edit share link, the agent creates a labelled diagram
  (shapes, text, bound arrows) in one `add_elements` call; a browser on
  the same link sees it appear live with an agent-badged avatar and
  cursor for five seconds.
- Given a view share link, every mutation tool refuses with the
  view-only message and `read_board` and `get_board_screenshot` work.
- `read_board` output fed back into `add_elements` (ids stripped) draws
  a faithful copy.
- The rendered PNG matches the browser's export of the same board in
  layout and fonts.
- `pnpm check`, typecheck, and the full test suite pass.

## 9. Out of scope

Account-scoped tokens, `list_boards`, MCP usage quotas and the upgrade
link, token revocation and the Agents page, image upload over MCP,
comment tools, MCP resources and prompts (tools only), persistent agent
sessions, cursor choreography beyond follow-the-edit, and the
self-hosted edition's own URL handling beyond accepting any host in the
share link.

## 10. Amendments

2026-08-27:

- `PUBLIC_URL` (default `CORS_ORIGIN`) added to the configuration: the
  server needs an origin to build the share URLs `create_board` returns;
  with `*`, the URLs are relative.
- A mutation tool returns as soon as the room accepted the update; the
  five-second presence window runs after the response, not before it,
  so an agent's loop is not slowed by its own avatar.
- The virtual connection's mirror is synchronized through the room's
  real step 1 / step 2 exchange rather than seeded from the room
  document.
