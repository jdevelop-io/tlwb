import { getElementBounds, type Rect } from '../geometry/bounds'
import { hitTestScene } from '../geometry/hit'
import { distance } from '../geometry/points'
import {
  SNAP_THRESHOLD,
  type SnapGuide,
  snapMovedBounds,
} from '../geometry/snap'
import {
  getHandles,
  hitTestHandles,
  type ResizeHandleKind,
  resizeRect,
  rotationAngle,
  scaleElement,
} from '../geometry/transform'
import { applyWithArrows } from '../model/bindings'
import type { BoardElement, ElementId, Point } from '../model/element'
import { duplicateElements } from '../model/operations'
import { elementsInRect, expandToGroups, selectionBounds } from '../selection'
import type { BoardChange } from '../store/types'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'
import { DRAG_THRESHOLD, HIT_TOLERANCE } from './types'

type Session =
  | { kind: 'idle' }
  | {
      kind: 'moving'
      origin: Point
      start: Map<ElementId, Point>
      /**
       * Bounds of every non-moved element, captured once when the
       * session opens instead of rebuilt from live state each frame:
       * otherwise an arrow re-anchored onto the dragged selection by a
       * previous frame's batch would feed back into this frame's snap
       * targets, letting the selection snap to its own trailing arrow.
       */
      others: Rect[]
      guides: SnapGuide[]
      /** True once the gesture applied a batch; cancel undoes it then. */
      wrote: boolean
    }
  | {
      kind: 'lasso'
      origin: Point
      rect: Rect
      /**
       * Selection the gesture started from, preserved when the lasso is
       * drawn with shift held so it extends instead of replacing.
       */
      base: readonly ElementId[]
    }
  | {
      kind: 'resizing'
      handle: ResizeHandleKind
      origin: Point
      startBounds: Rect
      start: Map<ElementId, BoardElement>
      wrote: boolean
    }
  | {
      kind: 'rotating'
      id: ElementId
      origin: Point
      center: Point
      wrote: boolean
    }

function rectFromCorners(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/**
 * Click, shift-click, drag-move, drag-resize, drag-rotate, and lasso, all
 * driven through the same pressed-handle / pressed-element / empty-canvas
 * priority order. Every mutating session is one undo entry: it opens with
 * `stopCapturing()` and closes with it on release, and `onCancel` undoes
 * that entry to restore the pre-gesture geometry.
 */
export function createSelectTool(): Tool {
  let session: Session = { kind: 'idle' }

  const startMove = (
    input: PointerInput,
    context: ToolContext,
    ids: readonly ElementId[],
    wrote: boolean,
  ): void => {
    const wanted = new Set(ids)
    const start = new Map<ElementId, Point>()
    for (const id of ids) {
      const element = context.store.getElement(id)
      if (element) {
        start.set(id, { x: element.x, y: element.y })
      }
    }
    const others = context.store
      .listElements()
      .filter((element) => !wanted.has(element.id))
      .map((element) => getElementBounds(element))
    session = {
      kind: 'moving',
      origin: input.world,
      start,
      others,
      guides: [],
      wrote,
    }
  }

  return {
    type: 'select',

    onPointerDown(input, context) {
      const store = context.store
      const elements = store.listElements()
      const zoom = context.getCamera().zoom
      const selected = context.getSelection()

      if (selected.length > 0) {
        const bounds = selectionBounds(elements, selected)
        if (bounds) {
          const handles = getHandles(bounds, zoom)
          const handle = hitTestHandles(handles, input.world, zoom)
          if (handle === 'rotate' && selected.length === 1) {
            const id = selected[0] as ElementId
            const element = store.getElement(id)
            if (element) {
              store.stopCapturing()
              session = {
                kind: 'rotating',
                id,
                origin: input.world,
                center: {
                  x: element.x + element.width / 2,
                  y: element.y + element.height / 2,
                },
                wrote: false,
              }
              return
            }
          }
          if (handle && handle !== 'rotate') {
            store.stopCapturing()
            const start = new Map<ElementId, BoardElement>()
            for (const id of selected) {
              const element = store.getElement(id)
              if (element) {
                start.set(id, element)
              }
            }
            session = {
              kind: 'resizing',
              handle,
              origin: input.world,
              startBounds: bounds,
              start,
              wrote: false,
            }
            return
          }
        }
      }

      const hit = hitTestScene(elements, input.world, HIT_TOLERANCE / zoom)
      if (hit) {
        const group = expandToGroups(elements, [hit.id])
        if (input.shiftKey) {
          const set = new Set(selected)
          const allIn = group.every((id) => set.has(id))
          for (const id of group) {
            if (allIn) {
              set.delete(id)
            } else {
              set.add(id)
            }
          }
          context.setSelection(
            elements
              .filter((element) => set.has(element.id))
              .map((element) => element.id),
          )
          session = { kind: 'idle' }
          return
        }
        const ids: readonly ElementId[] = selected.includes(hit.id)
          ? selected
          : group
        if (!selected.includes(hit.id)) {
          context.setSelection([...group])
        }
        store.stopCapturing()

        if (input.altKey) {
          const { changes, newIds } = duplicateElements(elements, ids, {
            x: 0,
            y: 0,
          })
          // `store.applyChanges` below is a handoff: it emits
          // synchronously to the host's subscribers. The session must
          // already describe a resumable, written gesture before that
          // emission, so a reentrant `onCancel` mid-emission undoes the
          // clones instead of finding an idle session that orphans
          // them. Clone positions equal the originals' (offset zero),
          // so the start map can be built from the pre-write snapshot.
          const wanted = new Set(ids)
          const start = new Map<ElementId, Point>()
          let index = 0
          for (const element of elements) {
            if (!wanted.has(element.id)) {
              continue
            }
            const newId = newIds[index]
            index += 1
            if (newId) {
              start.set(newId, { x: element.x, y: element.y })
            }
          }
          session = {
            kind: 'moving',
            origin: input.world,
            start,
            others: elements.map((element) => getElementBounds(element)),
            guides: [],
            wrote: true,
          }
          store.applyChanges(changes)
          context.setSelection(newIds)
          return
        }

        startMove(input, context, ids, false)
        return
      }

      if (!input.shiftKey) {
        context.setSelection([])
      }
      session = {
        kind: 'lasso',
        origin: input.world,
        rect: rectFromCorners(input.world, input.world),
        base: input.shiftKey ? [...selected] : [],
      }
    },

    onPointerMove(input, context) {
      const store = context.store
      switch (session.kind) {
        case 'idle':
          return
        case 'moving': {
          const zoom = context.getCamera().zoom
          if (
            !session.wrote &&
            distance(session.origin, input.world) < DRAG_THRESHOLD / zoom
          ) {
            // Nothing has been written yet: a click that never crosses
            // the drag threshold must stay a no-op, or its first
            // pointermove would open an empty undo entry.
            return
          }
          const raw = {
            x: input.world.x - session.origin.x,
            y: input.world.y - session.origin.y,
          }
          const movedIds = new Set(session.start.keys())
          let movingBounds: Rect | null = null
          for (const [id, startPosition] of session.start) {
            const element = store.getElement(id)
            if (!element) {
              continue
            }
            const bounds = getElementBounds({
              ...element,
              x: startPosition.x + raw.x,
              y: startPosition.y + raw.y,
            } as BoardElement)
            movingBounds = movingBounds
              ? unionRect(movingBounds, bounds)
              : bounds
          }
          if (!movingBounds) {
            return
          }
          const threshold = SNAP_THRESHOLD / zoom
          const snap = snapMovedBounds(movingBounds, session.others, threshold)
          const dx = raw.x + snap.dx
          const dy = raw.y + snap.dy
          const changes: BoardChange[] = [...session.start].map(
            ([id, startPosition]) => ({
              kind: 'update',
              id,
              props: { x: startPosition.x + dx, y: startPosition.y + dy },
            }),
          )
          session.guides = snap.guides
          session.wrote = true
          applyWithArrows(store, changes, movedIds)
          return
        }
        case 'lasso': {
          session.rect = rectFromCorners(session.origin, input.world)
          const elements = store.listElements()
          const inside = new Set(
            expandToGroups(elements, elementsInRect(elements, session.rect)),
          )
          for (const id of session.base) {
            inside.add(id)
          }
          // Ordered by z-index, like the shift-click branch above.
          context.setSelection(
            elements
              .filter((element) => inside.has(element.id))
              .map((element) => element.id),
          )
          return
        }
        case 'resizing': {
          const zoom = context.getCamera().zoom
          if (
            !session.wrote &&
            distance(session.origin, input.world) < DRAG_THRESHOLD / zoom
          ) {
            // Same guard as the moving branch: a handle press that never
            // travels must write nothing. Without it, a sub-threshold
            // twitch still produces a small but real resize, and it opens
            // an undo entry whose undo appears to do nothing because the
            // visible change it reverts is so small.
            return
          }
          const delta = {
            x: input.world.x - session.origin.x,
            y: input.world.y - session.origin.y,
          }
          const to = resizeRect(
            session.startBounds,
            session.handle,
            delta,
            input.shiftKey,
          )
          if (to.width === 0 && to.height === 0) {
            // Only the single-point degenerate case is rejected: a flat
            // line has height 0 (or width 0) by construction, and its
            // side handles must stay usable.
            return
          }
          const startBounds = session.startBounds
          const changes: BoardChange[] = [...session.start].map(
            ([id, element]) => ({
              kind: 'update',
              id,
              // `startBounds` is the rotated AABB (from
              // `selectionBounds`), while `scaleElement` maps between
              // unrotated frames: resizing a rotated element through
              // this path is only exact when its angle is zero.
              props: scaleElement(element, startBounds, to),
            }),
          )
          session.wrote = true
          applyWithArrows(store, changes, new Set(session.start.keys()))
          return
        }
        case 'rotating': {
          const zoom = context.getCamera().zoom
          if (
            !session.wrote &&
            distance(session.origin, input.world) < DRAG_THRESHOLD / zoom
          ) {
            // Same guard as the moving branch: pressing the rotate
            // handle without travelling must not write the sliver of
            // angle the pointer jitter would otherwise produce.
            return
          }
          const angle = rotationAngle(
            session.center,
            input.world,
            input.shiftKey,
          )
          session.wrote = true
          applyWithArrows(
            store,
            [{ kind: 'update', id: session.id, props: { angle } }],
            new Set([session.id]),
          )
          return
        }
      }
    },

    onPointerUp(_input, context) {
      if (session.kind !== 'idle') {
        context.store.stopCapturing()
      }
      session = { kind: 'idle' }
    },

    onCancel(context) {
      if (
        (session.kind === 'moving' ||
          session.kind === 'resizing' ||
          session.kind === 'rotating') &&
        session.wrote
      ) {
        // The gesture is exactly the open capture entry; undoing it
        // restores every element and bound arrow it touched.
        context.store.undo()
      }
      session = { kind: 'idle' }
    },

    getOverlay(): ToolOverlay {
      return {
        // The session kinds are named after the gestures themselves, so
        // they are the reported states one for one.
        gesture: session.kind,
        lasso: session.kind === 'lasso' ? session.rect : null,
        guides: session.kind === 'moving' ? session.guides : [],
      }
    },
  }
}
