# tlwb canvas engine and real-time collaboration: design

Date: 2026-08-08
Status: validated through brainstorming, pending written review
Parent specification: `2026-08-07-tlwb-product-design.md` (sections 4 and 6)

## 1. Scope and goal

This specification covers the whiteboard engine and the real-time
collaboration layer of tlwb v1: the canvas editor (shapes, arrows, free
drawing, text, images, hand-drawn rendering), local-first persistence for
anonymous boards, live collaboration (shared cursors, presence, concurrent
edits), and the collaboration server. Accounts, freemium limits, and the
MCP server are separate follow-up specifications; this design only leaves
them well-defined attachment points.

## 2. Decisions and rationale

### Build versus reuse

The engine is built from scratch on MIT building blocks. The alternatives
were evaluated and rejected:

- tldraw SDK: excluded outright. Its license is proprietary (watermark
  required on the free tier, paid business license), incompatible with the
  non-negotiable MIT open-core model.
- Forking or embedding Excalidraw (MIT): fastest path to v1, but it locks
  the project into a monolithic React component, contradicts the goal of
  owning a reusable framework-agnostic engine, and the engine would never
  become a JDevelop asset. Kept as a study reference only (rough.js usage,
  arrow heuristics), never as a code base.
- From scratch on MIT bricks (chosen): rough.js for sketchy shape
  rendering, perfect-freehand for free drawing, Yjs for synchronization.
  Accepted cost: four to six months to v1, solo with heavy AI assistance.

### Other structural decisions

- Licensing: MIT is a hard constraint for the entire open-source surface
  (engine, client, MCP server).
- The engine starts as an internal package of the tlwb monorepo with a
  clean public API, and is published to npm only once the API stabilizes
  (post-v1 decision, not a v1 deliverable).
- Frontend: the engine core is pure TypeScript with no framework and no
  network knowledge; the client application is React (Vite).
- Synchronization: CRDT with Yjs. Offline editing, reconnection, and
  concurrent merges are solved by construction; the future MCP server
  mutates the same document and therefore flows through the same pipeline
  as human edits.
- Collaboration server: portable TypeScript on Node, shipped as a Docker
  image with Postgres. The same artifact serves the SaaS and the future
  self-hosted Enterprise edition; no cloud-specific runtime.

## 3. Architecture

pnpm workspace monorepo, strict TypeScript everywhere, four packages with
explicit boundaries:

- `packages/engine`: the future MIT reusable engine. Scene model, Canvas2D
  rendering, tools, hit-testing, public editor API. Depends on nothing but
  the DOM canvas and a store interface.
- `packages/store-yjs`: the Yjs implementation of the engine's store
  interface, plus y-indexeddb persistence and the WebSocket sync client.
  The only package that knows Yjs.
- `apps/client`: the React application. UI chrome per the Paper artboards
  (toolbar, contextual panel, Share modal, remote cursors), board routing
  by URL, wiring of engine plus store.
- `apps/collab-server`: the Node collaboration server. Rooms per board,
  y-sync plus awareness protocol, snapshot persistence, link-based access
  control.

The decisive boundary is the store interface between `engine` and
`store-yjs`: read elements, apply changes, subscribe. It keeps the engine
publishable on its own and testable against a trivial in-memory store, and
it is locked by a shared contract test suite (section 8).

## 4. Canvas engine (`packages/engine`)

### Scene model

A board is a flat collection of elements keyed by id and ordered by a
fractional index (stable z-order under concurrent editing). Element types
in v1: `rectangle`, `ellipse`, `diamond`, `arrow`, `line`, `draw` (free
drawing), `text`, `image`. Common properties: position, dimensions, angle,
stroke and fill colors, stroke width, stroke style (solid, dashed),
sketchiness level, opacity, and a render seed. Arrows carry optional
bindings to the elements they connect and follow them when they move. Text
exists standalone or bound to a shape as a centered label.

### Rendering

A single HTML canvas, render loop on invalidation (no continuous redraw),
viewport culling, device pixel ratio handling. Shapes render through
rough.js with a stable per-element seed so the sketchy jitter is identical
across frames and across collaborators. Free drawing renders through
perfect-freehand with simulated pressure. Default canvas text uses the
handwriting family fixed by the Foundations design tokens. Zoom range 10%
to 6400%; pan via wheel, trackpad, and the hand tool.

### Tools and interactions

One state machine per tool (down, move, up). Single and multiple selection
(lasso), resize and rotate handles, light snapping against other elements,
duplication, groups, full keyboard support with the numbered shortcuts of
the Paper artboards. Hit-testing works on real geometry (shape outlines,
arrow curves), not bounding boxes alone.

### Public API

`createEditor({ canvas, store, options })` returns an editor object:
active tool, camera, selection, event subscriptions, PNG and SVG export.
Every mutation goes through the injected store; the engine edits data it
does not own. Undo and redo are delegated to the store. In the Yjs
implementation, `Y.UndoManager` filtered by local origin gives each
collaborator an undo stack covering only their own actions, agents
included, which matches the product requirement.

## 5. Document model and synchronization (`packages/store-yjs`)

### Document structure

One board is one `Y.Doc` containing a `Y.Map` named `elements` (element id
to a `Y.Map` of element properties) and a `Y.Map` named `meta` (board
name, creation date). Merge granularity is one element property: two
people moving two different shapes never conflict; two people editing the
same property resolve as last writer wins, which is sufficient for a
whiteboard. Text element content is a `Y.Text` for fine-grained merging of
concurrent text edits.

### Local-first persistence

Every board lives in IndexedDB first, through y-indexeddb, including
during collaboration: the editor always writes locally and
synchronization is a side effect. An anonymous board has only this
persistence (zero server cost, per the freemium model). When a board is
shared, the client opens the WebSocket connection and pushes the initial
state; the board becomes hosted. Account adoption at sign-up walks the
IndexedDB boards and attaches them through the same mechanism.

### Presence

The Yjs awareness protocol carries cursor position, display name, color,
current selection, and an `isAgent` flag. The client derives remote
cursors, the avatar stack, and the agent badge from it. Presence is
ephemeral and never persisted.

### JSON projection

The interchange format (file export, MCP `read_board`, thumbnails) is a
versioned, documented JSON projection of the Yjs document: the "tiny
vector JSON" of the product specification. The types live in
`packages/engine` (scene model); `store-yjs` converts in both directions
(import and export).

## 6. Collaboration server (`apps/collab-server`)

### Rooms and protocol

One Node process (TypeScript, `ws` for WebSocket, Hono for HTTP). One room
per board, loaded on first connection and evicted after idle time. The
server speaks the standard y-sync plus awareness protocol: it relays
updates to the room's peers and applies them to its own copy of the
document. Deployment is one Docker image plus Postgres, identical for the
SaaS and the future self-hosted Enterprise edition.

### Persistence

Postgres from v1 (the accounts specification will need it anyway): an
append table of Yjs updates per board, periodically compacted into a
snapshot. Loading a room replays snapshot plus residual updates. No
automatic expiry, per the product specification.

### Link-based access control

Each hosted board owns two capability keys generated at creation time: an
edit key and a view key. A share link carries one of them; the server
validates the key on WebSocket connect and rejects any incoming update on
a read-only connection. Owner access through the account session is
detailed in the accounts specification. The MCP server will use its own
tokens (MCP specification) but joins a room as a regular editing client
with the `isAgent` awareness flag.

### Images

Binary data never lives in the Yjs document: an image element references a
content hash. Anonymous boards keep blobs in IndexedDB; hosted boards
upload over HTTP to S3-compatible storage (MinIO when self-hosted) and are
served by content URL.

## 7. Error handling and guardrails

- Network loss: discreet "reconnecting" banner, exponential backoff. Local
  editing continues and y-indexeddb guarantees resynchronization; there is
  no degraded mode to build.
- Server guardrails: maximum message size, maximum document size, rate
  limiting per connection, idle room eviction.
- Read-only enforcement happens server-side (rejected updates), not only
  in the client UI.

## 8. Testing strategy

Classical TDD as the default loop, Vitest as the runner:

- Engine: pure TypeScript, unit-tested heavily against a trivial in-memory
  store: geometry, hit-testing, fractional index, tool state machines,
  arrow bindings. Rendering is deterministic (stable seeds), so a small
  visual regression suite compares PNG exports of reference scenes.
- Store contract: one shared contract suite that both store
  implementations (in-memory and Yjs) must pass. The architecture's key
  boundary is enforced by tests, not discipline.
- `store-yjs`: two-`Y.Doc` merge scenarios without real networking:
  concurrent edits, offline then resync, undo by origin that only reverts
  the local collaborator's actions.
- Server: integration tests over real WebSocket connections: two clients
  in a room, propagation, write rejection on read-only connections,
  snapshot plus updates persistence round-trip.
- End to end: Playwright on critical paths only: create an anonymous
  board, draw, reload (local persistence), share, second browser sees
  edits live.

## 9. Success criteria

- 60 fps interaction on a board of 1000 elements with 10 active
  collaborators.
- Clean resynchronization after 5 minutes offline, with zero data loss on
  reconnection.
- The engine builds and its full test suite passes with no dependency on
  React, Yjs, or the network.

## 10. Out of scope

Deferred to their own specifications or to post-v1: the MCP server
(next specification), accounts and freemium limits, the Enterprise
self-hosted edition, npm publication of the engine, mobile support, dark
mode, comments, and any WebGL rendering work.
