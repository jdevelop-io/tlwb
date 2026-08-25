# tlwb engine public API: design

Date: 2026-08-25
Status: implemented
Parent specification: `2026-08-08-tlwb-canvas-engine-realtime-design.md`
(section 4, "Public API")

## 1. Scope and goal

This specification closes `packages/engine`: the `createEditor` entry
point that binds a DOM container to the headless interaction controller
and the scene renderer, the overlay layer (selection, handles, lasso,
snap guides, remote presence), PNG and SVG export, and the handful of
capabilities the client chrome needs that the engine does not yet
expose (read-only mode, programmatic actions, local cursor publication,
double-click text editing with shape labels, text measurement).

After this work, `apps/client` can mount a working editor with one call
and `packages/store-yjs` can plug in without the engine knowing it.

Amendment to the parent specification: `createEditor` takes a
`container` element rather than a `canvas`, because the editor owns two
stacked canvases (section 3).

## 2. Decisions and rationale

- Two canvases, not one. The scene changes when elements change; the
  overlay changes on every pointer hover and every remote cursor move.
  Painting them on separate canvases with separate invalidation means a
  remote cursor never repaints a thousand elements. This is what makes
  the parent specification's "60 fps, 1000 elements, 10 collaborators"
  criterion structurally reachable. Consequence: the editor creates its
  canvases inside a host-provided container.
- Presence painting lives in the engine. Remote cursors and remote
  selections are drawn by the overlay from a plain `Peer[]` the host
  supplies; the engine still knows nothing about Yjs or awareness. The
  alternative, one DOM node per remote cursor in the client, would
  split overlay rendering between two technologies for no gain.
- One state snapshot and one `subscribe`, no typed event emitter. The
  shape matches React's `useSyncExternalStore` and the interaction
  controller's existing contract. Element changes stay on
  `store.subscribe`; the editor does not mirror them.
- Export reuses the rendering pipeline. PNG export renders the scene
  through `renderScene` on an offscreen canvas; SVG export walks the
  same rough.js drawables with the same seeds, so an exported file is
  the board as drawn, not a second interpretation of it.
- The host keeps the DOM text editor, the image assets, the system
  clipboard, and the download of exported files. The engine exposes
  what those need (screen rects, text measurement, `commitText`, image
  resolvers, blobs and strings) and nothing more.

## 3. Public API

```ts
createEditor(options: EditorOptions): Editor

interface EditorOptions {
  container: HTMLElement
  store: BoardStore
  fonts?: FontConfig
  /** Scene and PNG export. */
  resolveImage?: ImageResolver
  /** SVG export: an href (data or content URL); null omits the image. */
  resolveImageUrl?: (assetHash: string) => string | null
  background?: string
  defaults?: ElementProps
  readOnly?: boolean
  theme?: Partial<OverlayTheme>
  onTextEditRequest?: (id: ElementId) => void
  getPendingImage?: () => PendingImage | null
  /** World position of the local pointer; null when it leaves the canvas. */
  onCursorMove?: (point: Point | null) => void
}

interface EditorState {
  activeTool: ToolType
  selectedIds: ElementId[]
  camera: Camera
  gesture: GestureKind
  readOnly: boolean
  canUndo: boolean
  canRedo: boolean
}

interface Editor {
  getState(): EditorState
  subscribe(listener: () => void): () => void

  setActiveTool(type: ToolType): void
  setSelectedIds(ids: ElementId[]): void
  setDefaults(patch: ElementProps): void
  setReadOnly(readOnly: boolean): void
  execute(action: EditorAction): void
  updateSelection(patch: ElementProps): void
  commitText(id: ElementId, text: string): void
  undo(): void
  redo(): void

  setCamera(camera: Camera): void
  zoomTo(zoom: number, screenAnchor?: Point): void
  zoomToFit(ids?: ElementId[]): void
  worldToScreen(point: Point): Point
  screenToWorld(point: Point): Point
  getElementScreenRect(id: ElementId): Rect | null

  setPresence(peers: Peer[]): void

  exportPng(options?: ExportOptions & { scale?: number }): Promise<Blob>
  exportSvg(options?: ExportOptions): string

  destroy(): void
}

interface ExportOptions {
  /** Empty or absent exports the whole board. */
  ids?: ElementId[]
  background?: string
}

interface Peer {
  id: string
  name: string
  color: string
  /** World coordinates; null when the peer has no cursor to show. */
  cursor: Point | null
  selectedIds: ElementId[]
  isAgent: boolean
}
```

`EditorAction` is the existing `KeyboardAction` union under a neutral
name: the keyboard table resolves to it and the client chrome (toolbar,
contextual panel, overflow menu) dispatches it directly. Element
mutations otherwise go through the injected store; the editor has no
`createElement` or `updateElement` of its own.

`getState()` returns a new immutable object only when something
changed; `subscribe` fires once per change, never for a no-op. Camera
moves are state changes and notify.

`createInteractionController`, `createRenderer`, `renderScene`, and
`renderOverlay` stay exported for hosts that bind their own DOM or
render without one.

## 4. DOM binding and input

### Canvases and sizing

The editor appends two `<canvas>` children to the container, absolutely
positioned, filling it, with `touch-action: none`; the container gets
`position: relative` when it is `static`. A `ResizeObserver` on the
container resizes both canvases in CSS pixels and forwards the current
`devicePixelRatio`; a `matchMedia` resolution listener follows a monitor
change. Scene and overlay share one camera and one viewport.
`destroy()` removes the canvases, the observer, and every listener, and
is idempotent; after it, every method is a silent no-op except
`getState`, which returns the last state.

### Pointer

Listeners sit on the overlay canvas (the top one). `pointerdown`
captures the pointer (`setPointerCapture`); `pointermove` and
`pointerup` follow the capture outside the container; `pointercancel`
routes to `cancelGesture`. Each event becomes a `PointerInput`: `screen`
in CSS pixels relative to the container, `world` projected through the
camera, `shiftKey`, `altKey`. The middle button or a held space bar
starts a temporary pan using the hand tool's logic without changing the
active tool. The right button starts no gesture (the context menu is the
host's). Multitouch is out of scope (mobile is post-v1).

`dblclick` resolves its target and dispatches: a text element requests
`onTextEditRequest(id)`; a bindable shape without a label creates a
centered text element bound to it (`containerId`) and requests editing;
a shape with a label edits that label; empty canvas creates a text
element at the point as the text tool does. Read-only mode ignores
double-clicks.

`pointermove` also feeds `onCursorMove` with the world position, and
`pointerleave` sends `null`. The callback is not throttled; the host
throttles before publishing to awareness.

### Wheel

`wheel` is registered with `passive: false`. With `ctrlKey` or `metaKey`
(trackpad pinch arrives this way): zoom anchored on the pointer, the
delta converted to an exponential factor, clamped by `clampZoom`.
Without a modifier: pan by `deltaX` and `deltaY`. Both call
`preventDefault`.

### Keyboard

`keydown` on `window`, ignored when the target is editable (`input`,
`textarea`, `contenteditable`) so the host's text editor and board name
keep their keys. The controller's `handleKey` decides `preventDefault`.
The held space bar for the temporary pan is handled here. In read-only
mode only navigation keys reach the controller (see section 7).

### CSS cursor

On `pointermove` outside a gesture the editor hit-tests the handles then
the elements under the pointer and sets `cursor` on the overlay canvas:
`grab` and `grabbing` for the hand tool and the temporary pan,
`crosshair` for creation tools, `move` over a selected element,
directional resize cursors on handles (rotated with the selection
angle), `default` otherwise.

### Text editing

Unchanged from the interaction plan: `onTextEditRequest(id)` reaches the
host, which overlays its DOM editor using `getElementScreenRect(id)` and
the camera zoom. When the host is done it calls `commitText(id, text)`:
the editor measures the text (section 8), writes `text`, `width`, and
`height`, recenters a label inside its container, and deletes the
element when the text is empty. One undo entry per commit.

## 5. Overlay and presence

`renderOverlay(canvas, { snapshot, camera, viewport, devicePixelRatio,
peers, theme })` in `src/render/overlay.ts` is a pure painter like
`renderScene`, testable under `@napi-rs/canvas` and covered by the
visual suite. Everything is drawn in screen pixels so stroke widths and
handle sizes do not scale with zoom.

Painted, from the `InteractionSnapshot`:

- Selection box: a thin outline around `selectionBounds`, rotated with
  the element's angle for a single selection; one outline per element
  for a multiple selection.
- Handles: `HANDLE_SIZE` squares at `snapshot.handles`, the rotation
  handle as a circle; hidden while `gesture` is `moving`, `resizing`,
  `rotating`, or `creating`.
- Lasso: a dashed rectangle with a translucent fill when `gesture` is
  `lasso`.
- Snap guides: thin lines across the full viewport height or width for
  each `SnapGuide`.

Painted, from `Peer[]`:

- For each peer with a `cursor`: a filled arrow in the peer's `color`, a
  `name` label on a pill of the same color, an agent badge when
  `isAgent`. A peer without a cursor is not drawn.
- For each id in `selectedIds`: a thin outline in the peer's color
  around the element.

`OverlayTheme` holds the selection accent color, the guide color, the
lasso fill, and the label font size and family; the default follows the
Foundations tokens and `EditorOptions.theme` overrides any field. No
dark mode (post-v1).

The overlay has its own invalidation loop, the same mechanism as the
renderer (at most one pending frame). It is invalidated by
`controller.subscribe` (tool, selection, gesture), camera or viewport
changes (which also invalidate the scene), `setPresence`, and store
events (a selected element that moves takes its outline with it). The
scene is never invalidated by presence or hover.

`setPresence(peers)` replaces the whole list on each call; there is no
incremental merge, the host passes the complete awareness state.

## 6. Export

### PNG

`exportPng({ ids?, scale = 1, background })`: bounds of the retained
elements plus a 16 world unit margin, an offscreen canvas
(`document.createElement('canvas')`) painted by `renderScene` with a
camera framing those bounds and `devicePixelRatio = scale`, then
`toBlob('image/png')`. No overlay, no selection. An empty board yields
a 1 by 1 image of the background.

### SVG

`exportSvg({ ids?, background })` builds a string without the DOM: an
`<svg>` with a `viewBox` on the same bounds, a background `<rect>`, then
one `<g transform>` per element (translation, rotation, opacity).
Sketchy shapes and arrows go through the rough.js generator, reusing the
scene's drawables and seeds, converted to `<path>` with `opsToPath`.
Free drawing uses `getFreehandPath` in a `<path>`. Text becomes one
`<text>` per line with `font-family`, `font-size`, and the alignment
anchor. Images become `<image href>` through `resolveImageUrl`, omitted
when it returns null. Text content and attribute values are escaped;
the file references no external content. Fonts are named, not
embedded: typography fidelity depends on the viewer, as it does for
Excalidraw without font embedding.

Both exports return data; the engine never triggers a download.

## 7. Read-only mode

`readOnly: true` (or `setReadOnly(true)`) puts the editor in a viewing
state: the active tool is forced to `hand`, `setActiveTool` is ignored,
the selection is cleared and the selection overlay is not painted,
pointer gestures only pan, double-clicks and mutating actions
(`execute`, `updateSelection`, `commitText`, `undo`, `redo`) are silent
no-ops, and only navigation keys (zoom, pan, hand) reach the
controller. Presence is still painted and `onCursorMove` still fires.
`setReadOnly(false)` restores the select tool. `EditorState.readOnly`
lets the chrome hide the mutating controls. This is the client-side
half of the enforcement; the server rejects updates on read-only
connections regardless.

## 8. Text measurement and labels

`measureText({ text, fontSize, fontFamily }, fonts): { width, height }`
in `src/render/text.ts` measures every line on a shared offscreen
measuring canvas and returns the widest line and `lines * fontSize *
LINE_HEIGHT`. The host uses it while editing to size its editor;
`commitText` uses it to size the element, so the editor and the
rendering agree.

A label is a text element whose `containerId` names a bindable shape.
It is centered in its container's bounds at creation and after every
commit. Moving, resizing, or rotating the container moves the label
with it through the same mechanism bound arrows use: the bound update
helper in `src/model/bindings.ts` grows to emit label updates alongside
arrow updates. Deleting the container deletes its label. A label whose
container is deleted by a remote change becomes a standalone text
element (the store ignores dangling references; the renderer draws it
in place).

## 9. Error handling and guardrails

- `createEditor` throws when the container is not an `HTMLElement` or
  `getContext('2d')` returns null; nothing fails silently at mount.
- `zoomTo`, `zoomToFit`, and the wheel go through `clampZoom`; an out of
  range zoom never breaks the projection. `zoomToFit` on an empty board
  or an empty `ids` list resets to zoom 1 centered on the origin.
- `getElementScreenRect` returns null for an unknown id rather than
  throwing.
- `setPresence` skips any peer missing a required field or holding a
  non-finite cursor; malformed presence from a remote client cannot
  break the overlay.
- Wheel listeners are explicitly non-passive so `preventDefault` works
  in Chrome.

## 10. Testing strategy

Vitest, classical TDD, no jsdom: tests keep running in Node with
`@napi-rs/canvas`.

- DOM binding: a minimal fake container (`addEventListener`,
  `removeEventListener`, `appendChild`, `removeChild`,
  `getBoundingClientRect`, `style`) and an injectable `ResizeObserver`
  and `requestFrame`. Covered: event to `PointerInput` conversion,
  wheel zoom factor and anchoring, temporary pan with space and middle
  button, double-click dispatch, CSS cursor selection, `onCursorMove`
  including the null on leave, keyboard target filtering, read-only
  gating, `destroy` removing listeners and canvases. If the fake grows
  heavier than the binding it tests, jsdom enters devDependencies;
  decided at plan time.
- State: `getState` identity stable when nothing changed, one
  notification per change, `canUndo` and `canRedo` following the store.
- Actions: `execute` for every `EditorAction`, `updateSelection` as one
  undo entry that follows bound arrows, `commitText` sizing, label
  centering, and empty-text deletion.
- Labels: the bound update helper moves labels with their container on
  move, resize, and rotate; deleting the container deletes the label.
- Overlay visual suite: reference scenes for a single rotated
  selection, a multiple selection with handles, a lasso, snap guides,
  and two peers of which one is an agent.
- Export: PNG of a reference scene compared to a baseline; SVG compared
  to a text snapshot; a contract test that `exportPng` and `renderScene`
  on the same scene produce identical pixels within tolerance.

## 11. Success criteria

- `apps/client` (next series) can mount an editor with `createEditor`
  and drive every toolbar, panel, and menu control through the API
  above without touching `packages/engine` internals.
- The engine still builds and tests without React, Yjs, jsdom, or the
  network; runtime dependencies are unchanged.
- Presence painting on a 1000 element board invalidates the overlay
  only, verified by a test that counts scene frames while
  `setPresence` is called repeatedly.

## 12. Out of scope

Deferred: system clipboard copy and paste between boards (client, on
top of `exportSnapshot` and `importSnapshot`), multitouch and native
pinch, dark mode, in-canvas text editing, image upload and asset
storage, font embedding in SVG, hover highlighting of elements,
`packages/store-yjs`, the React client, and the collaboration server.
