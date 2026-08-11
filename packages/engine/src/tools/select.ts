import { getElementBounds, type Rect } from '../geometry/bounds'
import { hitTestScene } from '../geometry/hit'
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
import { boundArrowUpdates } from '../model/bindings'
import type { BoardElement, ElementId, Point } from '../model/element'
import { duplicateElements } from '../model/operations'
import { elementsInRect, expandToGroups, selectionBounds } from '../selection'
import type { BoardChange, BoardStore } from '../store/types'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'
import { HIT_TOLERANCE } from './types'

type Session =
  | { kind: 'idle' }
  | {
      kind: 'moving'
      origin: Point
      start: Map<ElementId, Point>
      guides: SnapGuide[]
      /** True once the gesture applied a batch; cancel undoes it then. */
      wrote: boolean
    }
  | { kind: 'lasso'; origin: Point; rect: Rect }
  | {
      kind: 'resizing'
      handle: ResizeHandleKind
      origin: Point
      startBounds: Rect
      start: Map<ElementId, BoardElement>
      wrote: boolean
    }
  | { kind: 'rotating'; id: ElementId; center: Point; wrote: boolean }

function rectFromCorners(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/** Applies a batch, then re-anchors arrows bound to the touched ids. */
function applyWithArrows(
  store: BoardStore,
  changes: BoardChange[],
  touchedIds: ReadonlySet<ElementId>,
): void {
  store.applyChanges(changes)
  const arrows = boundArrowUpdates(store.listElements(), touchedIds)
  if (arrows.length > 0) {
    store.applyChanges(arrows)
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
    const start = new Map<ElementId, Point>()
    for (const id of ids) {
      const element = context.store.getElement(id)
      if (element) {
        start.set(id, { x: element.x, y: element.y })
      }
    }
    session = { kind: 'moving', origin: input.world, start, guides: [], wrote }
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
        let ids: readonly ElementId[] = selected.includes(hit.id)
          ? selected
          : group
        if (!selected.includes(hit.id)) {
          context.setSelection([...group])
        }
        store.stopCapturing()
        let wrote = false
        if (input.altKey) {
          const { changes, newIds } = duplicateElements(elements, ids, {
            x: 0,
            y: 0,
          })
          store.applyChanges(changes)
          context.setSelection(newIds)
          ids = newIds
          wrote = true
        }
        startMove(input, context, ids, wrote)
        return
      }

      if (!input.shiftKey) {
        context.setSelection([])
      }
      session = {
        kind: 'lasso',
        origin: input.world,
        rect: rectFromCorners(input.world, input.world),
      }
    },

    onPointerMove(input, context) {
      const store = context.store
      switch (session.kind) {
        case 'idle':
          return
        case 'moving': {
          const raw = {
            x: input.world.x - session.origin.x,
            y: input.world.y - session.origin.y,
          }
          const elements = store.listElements()
          const movedIds = new Set(session.start.keys())
          let movingBounds: Rect | null = null
          const others: Rect[] = []
          for (const element of elements) {
            const startPosition = session.start.get(element.id)
            if (!startPosition) {
              others.push(getElementBounds(element))
              continue
            }
            const bounds = getElementBounds({
              ...element,
              x: startPosition.x + raw.x,
              y: startPosition.y + raw.y,
            } as BoardElement)
            movingBounds = movingBounds
              ? {
                  x: Math.min(movingBounds.x, bounds.x),
                  y: Math.min(movingBounds.y, bounds.y),
                  width:
                    Math.max(
                      movingBounds.x + movingBounds.width,
                      bounds.x + bounds.width,
                    ) - Math.min(movingBounds.x, bounds.x),
                  height:
                    Math.max(
                      movingBounds.y + movingBounds.height,
                      bounds.y + bounds.height,
                    ) - Math.min(movingBounds.y, bounds.y),
                }
              : bounds
          }
          if (!movingBounds) {
            return
          }
          const threshold = SNAP_THRESHOLD / context.getCamera().zoom
          const snap = snapMovedBounds(movingBounds, others, threshold)
          const dx = raw.x + snap.dx
          const dy = raw.y + snap.dy
          const changes: BoardChange[] = [...session.start].map(
            ([id, startPosition]) => ({
              kind: 'update',
              id,
              props: { x: startPosition.x + dx, y: startPosition.y + dy },
            }),
          )
          applyWithArrows(store, changes, movedIds)
          session.guides = snap.guides
          session.wrote = true
          return
        }
        case 'lasso': {
          session.rect = rectFromCorners(session.origin, input.world)
          const elements = store.listElements()
          context.setSelection(
            expandToGroups(elements, elementsInRect(elements, session.rect)),
          )
          return
        }
        case 'resizing': {
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
          if (to.width === 0 || to.height === 0) {
            return
          }
          const startBounds = session.startBounds
          const changes: BoardChange[] = [...session.start].map(
            ([id, element]) => ({
              kind: 'update',
              id,
              props: scaleElement(element, startBounds, to),
            }),
          )
          applyWithArrows(store, changes, new Set(session.start.keys()))
          session.wrote = true
          return
        }
        case 'rotating': {
          const angle = rotationAngle(
            session.center,
            input.world,
            input.shiftKey,
          )
          applyWithArrows(
            store,
            [{ kind: 'update', id: session.id, props: { angle } }],
            new Set([session.id]),
          )
          session.wrote = true
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
        lasso: session.kind === 'lasso' ? session.rect : null,
        guides: session.kind === 'moving' ? session.guides : [],
      }
    },
  }
}
