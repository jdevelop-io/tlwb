import { type Camera, type Viewport, worldToScreen } from '../camera'
import type { Rect } from '../geometry/bounds'
import { toWorldPoint } from '../geometry/hit'
import { HANDLE_SIZE } from '../geometry/transform'
import type { InteractionSnapshot } from '../interaction/controller'
import type { BoardElement, ElementId, Point } from '../model/element'
import type { Peer } from '../presence'

export interface OverlayTheme {
  /** Selection outlines, handles, and the lasso stroke. */
  selection: string
  guide: string
  lassoFill: string
  /** Agent badge on remote cursors. */
  agent: string
  /** CSS font shorthand for cursor name labels. */
  labelFont: string
}

/** Foundations tokens: brand coral for selection, soft violet for agents. */
export const DEFAULT_OVERLAY_THEME: OverlayTheme = {
  selection: '#FF6B4A',
  guide: '#FF6B4A',
  lassoFill: 'rgba(255, 107, 74, 0.08)',
  agent: '#6E56CF',
  labelFont: '500 11px Inter, system-ui, sans-serif',
}

export interface RenderOverlayOptions {
  elements: readonly BoardElement[]
  snapshot: InteractionSnapshot
  camera: Camera
  /** CSS pixels; the backing store scales by `devicePixelRatio`. */
  viewport: Viewport
  devicePixelRatio?: number
  peers?: readonly Peer[]
  theme?: OverlayTheme
}

/** Gestures during which the handles would only get in the way. */
const HANDLES_HIDDEN = new Set(['moving', 'resizing', 'rotating', 'creating'])

type Project = (point: Point) => Point

/**
 * Paints the interaction state over the scene, in screen pixels so
 * strokes and handles keep their size at every zoom. Transparent where
 * there is nothing to show: the scene canvas underneath stays visible.
 */
export function renderOverlay(
  canvas: HTMLCanvasElement,
  options: RenderOverlayOptions,
): void {
  const {
    elements,
    snapshot,
    camera,
    viewport,
    devicePixelRatio = 1,
    peers = [],
    theme = DEFAULT_OVERLAY_THEME,
  } = options
  const width = Math.round(viewport.width * devicePixelRatio)
  const height = Math.round(viewport.height * devicePixelRatio)
  if (canvas.width !== width) {
    canvas.width = width
  }
  if (canvas.height !== height) {
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  ctx.clearRect(0, 0, viewport.width, viewport.height)
  const byId = new Map(elements.map((element) => [element.id, element]))
  const project: Project = (point) => worldToScreen(camera, point)
  const zoom = camera.zoom

  paintSelection(ctx, byId, snapshot, project, zoom, theme)
  if (snapshot.lasso) {
    paintLasso(ctx, snapshot.lasso, project, zoom, theme)
  }
  paintGuides(ctx, snapshot, project, viewport, theme)
  paintPeers(ctx, byId, peers, project, theme)
}

/** Screen corners of the element's rotated frame. */
function elementCorners(element: BoardElement, project: Project): Point[] {
  const { width, height } = element
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((local) => project(toWorldPoint(element, local)))
}

function strokePolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  lineWidth: number,
): void {
  const [first, ...rest] = points
  if (!first) {
    return
  }
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (const point of rest) {
    ctx.lineTo(point.x, point.y)
  }
  ctx.closePath()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.stroke()
}

function projectRect(rect: Rect, project: Project, zoom: number): Rect {
  const origin = project(rect)
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * zoom,
    height: rect.height * zoom,
  }
}

function paintSelection(
  ctx: CanvasRenderingContext2D,
  byId: ReadonlyMap<ElementId, BoardElement>,
  snapshot: InteractionSnapshot,
  project: Project,
  zoom: number,
  theme: OverlayTheme,
): void {
  const selected = snapshot.selectedIds
    .map((id) => byId.get(id))
    .filter((element): element is BoardElement => element !== undefined)
  if (selected.length === 0) {
    return
  }
  ctx.save()
  for (const element of selected) {
    strokePolygon(ctx, elementCorners(element, project), theme.selection, 1)
  }
  if (selected.length > 1 && snapshot.selectionBounds) {
    const box = projectRect(snapshot.selectionBounds, project, zoom)
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = theme.selection
    ctx.lineWidth = 1
    ctx.strokeRect(box.x, box.y, box.width, box.height)
    ctx.setLineDash([])
  }
  if (!HANDLES_HIDDEN.has(snapshot.gesture)) {
    for (const handle of snapshot.handles) {
      const at = project(handle)
      ctx.beginPath()
      if (handle.kind === 'rotate') {
        ctx.arc(at.x, at.y, HANDLE_SIZE / 2, 0, Math.PI * 2)
      } else {
        ctx.rect(
          at.x - HANDLE_SIZE / 2,
          at.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE,
        )
      }
      ctx.fillStyle = '#FFFFFF'
      ctx.fill()
      ctx.strokeStyle = theme.selection
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
  ctx.restore()
}

function paintLasso(
  ctx: CanvasRenderingContext2D,
  lasso: Rect,
  project: Project,
  zoom: number,
  theme: OverlayTheme,
): void {
  const box = projectRect(lasso, project, zoom)
  ctx.save()
  ctx.fillStyle = theme.lassoFill
  ctx.fillRect(box.x, box.y, box.width, box.height)
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = theme.selection
  ctx.lineWidth = 1
  ctx.strokeRect(box.x, box.y, box.width, box.height)
  ctx.restore()
}

function paintGuides(
  ctx: CanvasRenderingContext2D,
  snapshot: InteractionSnapshot,
  project: Project,
  viewport: Viewport,
  theme: OverlayTheme,
): void {
  if (snapshot.guides.length === 0) {
    return
  }
  ctx.save()
  ctx.strokeStyle = theme.guide
  ctx.lineWidth = 1
  for (const guide of snapshot.guides) {
    ctx.beginPath()
    if (guide.orientation === 'vertical') {
      const x = project({ x: guide.position, y: 0 }).x
      ctx.moveTo(x, 0)
      ctx.lineTo(x, viewport.height)
    } else {
      const y = project({ x: 0, y: guide.position }).y
      ctx.moveTo(0, y)
      ctx.lineTo(viewport.width, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/** Cursor arrow outline, in CSS pixels from the hot spot. */
const CURSOR_ARROW: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 0, y: 16 },
  { x: 4, y: 12 },
  { x: 7, y: 19 },
  { x: 9, y: 18 },
  { x: 6, y: 11 },
  { x: 11, y: 11 },
]
const LABEL_OFFSET = { x: 12, y: 16 }
const LABEL_HEIGHT = 18
const LABEL_PADDING = 6

function paintPeers(
  ctx: CanvasRenderingContext2D,
  byId: ReadonlyMap<ElementId, BoardElement>,
  peers: readonly Peer[],
  project: Project,
  theme: OverlayTheme,
): void {
  for (const peer of peers) {
    for (const id of peer.selectedIds) {
      const element = byId.get(id)
      if (element) {
        strokePolygon(ctx, elementCorners(element, project), peer.color, 1.5)
      }
    }
    if (!peer.cursor) {
      continue
    }
    const at = project(peer.cursor)
    ctx.save()
    ctx.translate(at.x, at.y)
    ctx.beginPath()
    for (const [i, point] of CURSOR_ARROW.entries()) {
      if (i === 0) {
        ctx.moveTo(point.x, point.y)
      } else {
        ctx.lineTo(point.x, point.y)
      }
    }
    ctx.closePath()
    ctx.fillStyle = peer.color
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1
    ctx.stroke()
    paintPill(ctx, LABEL_OFFSET.x, LABEL_OFFSET.y, peer.name, peer.color, theme)
    if (peer.isAgent) {
      const nameWidth = pillWidth(ctx, peer.name, theme)
      paintPill(
        ctx,
        LABEL_OFFSET.x + nameWidth + 4,
        LABEL_OFFSET.y,
        'AI',
        theme.agent,
        theme,
      )
    }
    ctx.restore()
  }
}

function pillWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  theme: OverlayTheme,
): number {
  ctx.font = theme.labelFont
  return ctx.measureText(text).width + LABEL_PADDING * 2
}

function paintPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  theme: OverlayTheme,
): void {
  const width = pillWidth(ctx, text, theme)
  ctx.fillStyle = color
  ctx.fillRect(x, y, width, LABEL_HEIGHT)
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, x + LABEL_PADDING, y + LABEL_HEIGHT / 2)
}
