import { getHandles } from '../../src/geometry/transform'
import type { InteractionSnapshot } from '../../src/interaction/controller'
import { createElement } from '../../src/model/create'
import type { BoardElement, Point } from '../../src/model/element'
import type { Peer } from '../../src/presence'
import { selectionBounds } from '../../src/selection'

/** Every id, index, and seed is fixed: these scenes must never vary. */
export function shapesScene(): BoardElement[] {
  return [
    createElement('rectangle', {
      id: 'rect-1',
      index: 'a0',
      seed: 101,
      x: 40,
      y: 40,
      width: 180,
      height: 120,
    }),
    createElement('rectangle', {
      id: 'rect-2',
      index: 'a1',
      seed: 102,
      x: 260,
      y: 40,
      width: 180,
      height: 120,
      strokeColor: '#C0392B',
      fillColor: '#FADDD8',
      strokeStyle: 'dashed',
    }),
    createElement('ellipse', {
      id: 'ellipse-1',
      index: 'a2',
      seed: 103,
      x: 480,
      y: 40,
      width: 200,
      height: 120,
      sketchiness: 2,
    }),
    createElement('diamond', {
      id: 'diamond-1',
      index: 'a3',
      seed: 104,
      x: 40,
      y: 220,
      width: 160,
      height: 140,
      fillColor: '#D6E9F8',
    }),
    createElement('line', {
      id: 'line-1',
      index: 'a4',
      seed: 105,
      x: 260,
      y: 230,
      width: 200,
      height: 90,
      points: [
        { x: 0, y: 90 },
        { x: 100, y: 0 },
        { x: 200, y: 60 },
      ],
    }),
    createElement('arrow', {
      id: 'arrow-1',
      index: 'a5',
      seed: 106,
      x: 500,
      y: 220,
      width: 180,
      height: 120,
      strokeWidth: 3,
      points: [
        { x: 0, y: 120 },
        { x: 180, y: 0 },
      ],
    }),
    createElement('rectangle', {
      id: 'rect-3',
      index: 'a6',
      seed: 107,
      x: 280,
      y: 400,
      width: 160,
      height: 100,
      angle: Math.PI / 8,
      opacity: 0.5,
    }),
  ]
}

export function freehandScene(): BoardElement[] {
  const points: Point[] = Array.from({ length: 48 }, (_, i) => ({
    x: i * 12,
    y: 80 + Math.sin(i / 4) * 60,
  }))
  return [
    createElement('draw', {
      id: 'draw-1',
      index: 'a0',
      seed: 201,
      x: 80,
      y: 180,
      width: 570,
      height: 160,
      strokeWidth: 3,
      points,
    }),
  ]
}

export function textScene(): BoardElement[] {
  return [
    createElement('text', {
      id: 'text-1',
      index: 'a0',
      seed: 301,
      x: 80,
      y: 80,
      width: 480,
      height: 130,
      text: 'tlwb sketches ideas\nacross two lines',
      fontSize: 44,
    }),
    createElement('text', {
      id: 'text-2',
      index: 'a1',
      seed: 302,
      x: 80,
      y: 320,
      width: 480,
      height: 60,
      text: 'centered label',
      fontSize: 30,
      textAlign: 'center',
    }),
  ]
}

export interface OverlayScene {
  elements: BoardElement[]
  snapshot: InteractionSnapshot
  peers: Peer[]
}

/** A rotated rectangle selected, with its handles and two snap guides. */
export function overlaySelectionScene(): OverlayScene {
  const elements = shapesScene()
  const selectedIds = ['rect-3']
  const bounds = selectionBounds(elements, selectedIds)
  return {
    elements,
    snapshot: {
      activeTool: 'select',
      selectedIds,
      selectionBounds: bounds,
      handles: bounds ? getHandles(bounds, 1) : [],
      gesture: 'idle',
      lasso: null,
      guides: [
        { orientation: 'vertical', position: 280 },
        { orientation: 'horizontal', position: 400 },
      ],
    },
    peers: [],
  }
}

/** A lasso in progress over a multiple selection, watched by two peers. */
export function overlayPresenceScene(): OverlayScene {
  const elements = shapesScene()
  const selectedIds = ['rect-1', 'rect-2']
  const bounds = selectionBounds(elements, selectedIds)
  return {
    elements,
    snapshot: {
      activeTool: 'select',
      selectedIds,
      selectionBounds: bounds,
      handles: bounds ? getHandles(bounds, 1) : [],
      gesture: 'lasso',
      lasso: { x: 20, y: 20, width: 440, height: 160 },
      guides: [],
    },
    peers: [
      {
        id: 'ada',
        name: 'Ada',
        color: '#2E86DE',
        cursor: { x: 540, y: 120 },
        selectedIds: ['ellipse-1'],
        isAgent: false,
      },
      {
        id: 'bot',
        name: 'Claude',
        color: '#8B7CF6',
        cursor: { x: 120, y: 300 },
        selectedIds: ['diamond-1'],
        isAgent: true,
      },
    ],
  }
}
