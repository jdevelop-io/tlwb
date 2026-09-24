# tlwb

[![CI](https://github.com/jdevelop-io/tlwb/actions/workflows/ci.yml/badge.svg)](https://github.com/jdevelop-io/tlwb/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The little whiteboard: instant, collaborative, agent-friendly.

Try it at [tlwb.io](https://tlwb.io), no account required. Or run your
own instance, see [Running the product](#running-the-product).

Monorepo packages:

- `packages/engine`: framework-agnostic whiteboard engine, data layer,
  rendering, interactions, and public editor API (element model,
  fractional z-ordering, board store with per-origin undo and redo,
  versioned JSON snapshots, camera and viewport math, sketchy shape and
  free-drawing rendering, canvas text and images, an invalidation-driven
  render loop). The interaction layer hit-tests on real geometry and
  runs one state machine per tool, with group and lasso selection,
  resize and rotate handles, alignment snapping, arrow bindings and
  shape labels that follow their shapes, and keyboard shortcuts.
  `createEditor` binds it all to a DOM container: two stacked canvases
  (scene and overlay), pointer, wheel, and keyboard input, remote
  presence painting, double-click text editing, read-only mode, and PNG
  and SVG export.
- `packages/store-yjs`: Yjs implementation of the engine's store,
  local-first persistence, synchronization client, presence, and image
  assets. The only package that imports Yjs.
- `apps/collab-server`: the collaboration server. Creates hosted boards
  and their share keys, relays Yjs updates and awareness between the
  collaborators of a board, enforces read-only links, validates every
  incoming element on a staging document, persists boards in Postgres
  as a snapshot plus residual updates, and stores image assets. One
  Docker image plus Postgres (`docker compose up`).
- `apps/web`: the product's client. A static landing page and the board
  editor (React), served by Caddy on the same origin as the
  collaboration server. Local-first boards, sharing by link, presence,
  image assets, export.

## Getting started

Requires Node.js >= 22 and pnpm >= 11. The exact pnpm version is pinned
in the root `packageManager` field, which any pnpm from version 10
onwards reads and honors automatically.

```bash
pnpm install
pnpm test
```

## Running the product

```bash
docker compose pull
docker compose up -d
```

Then open `http://localhost:8080`. The images are published to the
GitHub Container Registry from every green commit on `main`, as
`ghcr.io/jdevelop-io/tlwb-web` and `ghcr.io/jdevelop-io/tlwb-collab-server`,
tagged `latest` and `sha-<commit>`. To run your own changes instead,
build locally with `docker compose up --build`. For development, run Postgres and
the server (`docker compose up -d postgres`, then
`DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb CORS_ORIGIN=http://localhost:5173 pnpm --filter @tlwb/collab-server dev`)
and the web application (`pnpm --filter @tlwb/web dev`) on
`http://localhost:5173`; the Vite server proxies `/api` and `/ws` to
the collaboration server. The self-hosted product is anonymous by design: no accounts, no sign-in,
nothing to configure beyond the variables in `apps/collab-server/README.md`.

### Letting an agent draw

The stack serves an MCP endpoint at `http://localhost:8080/mcp`. Add it
to Claude Code (`claude mcp add --transport http tlwb http://localhost:8080/mcp`)
or any MCP client, share a board's edit link with the agent, and ask it
to draw: it appears on the board as a badged collaborator. See
`apps/collab-server/README.md` for the tools.

## Using the engine

`createEditor` mounts the whiteboard into a container element and hands
back a handle for the host application. The package is not published
yet (`@tlwb/engine` is `"private": true`); today it only resolves as a
workspace dependency from another package inside this monorepo. A
minimal mount looks like this:

```ts
import { createEditor, InMemoryBoardStore } from '@tlwb/engine'

const container = document.getElementById('board')
if (!container) {
  throw new Error('missing #board container')
}

// A collaborative host supplies a store that syncs the same
// `BoardStore` interface over the network instead; the engine never
// persists or transmits anything itself.
const store = new InMemoryBoardStore()

const editor = createEditor({ container, store })

// When the host unmounts the board:
editor.destroy()
```

`createEditor` mounts two absolutely positioned canvases inside the
container: the scene (the elements as drawn) below, and the overlay
(selection handles, the lasso, remote cursors) above. Give the
container a CSS size; the editor watches it and resizes both canvases
on its own, so nothing else needs sizing by hand.

### Text editing

The engine owns no DOM text editor. When a user starts typing a shape
label or a text element, the editor calls `onTextEditRequest(id)`; the
host opens whatever text input it wants, positioned with
`editor.getElementScreenRect(id)`, and calls `editor.commitText(id,
text)` when the host is done (on blur, on Enter, whichever fits the
host's UI). Creating a text and typing its first characters is one undo
entry: `createEditor` keeps the creation's undo capture open until the
commit, and closes it on any other action:

```ts
import type { Editor } from '@tlwb/engine'

function openTextEditor(editor: Editor, container: HTMLElement, id: string) {
  const rect = editor.getElementScreenRect(id)
  if (!rect) {
    return
  }
  const input = document.createElement('textarea')
  // Deliberately minimal: a real host also sets `input.style.font` to
  // match the element (via `fontString`, see below) so the textarea's
  // line breaks agree with what the renderer and `measureText` produce.
  input.style.position = 'absolute'
  input.style.left = `${rect.x}px`
  input.style.top = `${rect.y}px`
  input.style.width = `${rect.width}px`
  input.style.height = `${rect.height}px`
  container.appendChild(input)
  input.focus()
  input.addEventListener('blur', () => {
    editor.commitText(id, input.value)
    input.remove()
  })
}

const editor = createEditor({
  container,
  store,
  onTextEditRequest: (id) => openTextEditor(editor, container, id),
})
```

A host binding its own DOM through `createInteractionController` instead
owns that capture. Its `onTextEditRequest(id, origin)` receives an
`origin` of `'created'` when the text tool has just created the element
and left the capture open: return `true` to take it, and call
`store.stopCapturing()` when the edit settles (the commit, or any
unrelated action). Returning nothing declines it, the tool closes the
capture itself, and creating then typing costs two undo entries.

### Presence and read-only mode

`editor.setPresence(peers)` paints remote collaborators (cursor and
selection) on the overlay; the host derives the peer list from its own
presence transport and passes the whole list on every change:

```ts
editor.setPresence([
  {
    id: 'peer-1',
    name: 'Ada',
    color: '#4F46E5',
    cursor: { x: 120, y: 80 },
    selectedIds: [],
    isAgent: false,
  },
])
```

`editor.setReadOnly(true)` switches the board to viewing mode: the hand
tool, no selection, and every board-mutating method (`execute`,
`updateSelection`, `commitText`, `setActiveTool`, `setSelectedIds`,
`undo`, `redo`) becomes a no-op. The camera and the creation defaults
stay live: `setCamera`, `zoomTo`, `zoomToFit`, `setDefaults`, and
`setPresence` keep working, so a viewer can still pan, zoom, and see
remote cursors. The server should still reject writes from a read-only
connection on its own; this is only the client-side half of the
enforcement.

### Exporting the board

`exportSvg` returns an SVG document synchronously; `exportPng`
rasterizes on an offscreen canvas and resolves a `Blob`. Both default to
the whole board and accept a subset of element ids and a background
color; `exportPng` also takes a `scale` for retina output. The host is
responsible for triggering the download (`URL.createObjectURL`, an
anchor with `download`, or whatever fits):

```ts
const svg = editor.exportSvg({ background: '#ffffff' })
const png = await editor.exportPng({ ids: ['a', 'b'], scale: 2 })
```

### After destroy

`editor.destroy()` unmounts the canvases and stops every subscription.
After that call, every method that mutates the board, paints the
mounted canvases, or notifies subscribers becomes a silent no-op.
Every purely reading method keeps answering truthfully: `getState`,
`worldToScreen`, `screenToWorld`, `getElementScreenRect`, `exportSvg`,
and `exportPng` all still work on a destroyed editor, since they only
read the store and, for the exports, paint to a canvas the environment
creates rather than the ones `destroy` removed. A host can safely
export a board right after tearing down its editor.

### Sizing text like the renderer

`measureText(spec, fonts, ctx)` takes a 2D context as its third
argument, because nothing under the engine's source is allowed to own a
module-level canvas: the caller supplies one. A browser host builds it
with:

```ts
const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d')
if (!ctx) {
  throw new Error('2D canvas context unavailable')
}
```

and reuses that context to size its own DOM text editor so typing and
rendering agree on line breaks.

## Contributing

Read the [contributing guide](CONTRIBUTING.md) for the development setup,
the checks to run, and the pull request process. Everyone taking part is
expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

To report a security vulnerability, follow the
[security policy](SECURITY.md) rather than opening a public issue.

## License

[MIT](LICENSE)
