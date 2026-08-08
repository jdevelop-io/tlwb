import type {
  BoardElement,
  ElementId,
  ElementProps,
  ElementType,
} from './element'

const variantDefaults: Record<ElementType, Record<string, unknown>> = {
  rectangle: {},
  ellipse: {},
  diamond: {},
  line: { points: [] },
  arrow: { points: [], startBinding: null, endBinding: null },
  draw: { points: [] },
  text: {
    text: '',
    fontSize: 20,
    fontFamily: 'hand',
    textAlign: 'left',
    containerId: null,
  },
  image: { assetHash: '' },
}

export function createElement(
  type: ElementType,
  options: { index: string; id?: ElementId } & ElementProps,
): BoardElement {
  const { id, index, ...overrides } = options
  return {
    id: id ?? crypto.randomUUID(),
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: '#1A1A1A',
    fillColor: null,
    strokeWidth: 2,
    strokeStyle: 'solid',
    sketchiness: 1,
    opacity: 1,
    seed: Math.floor(Math.random() * 2 ** 31),
    index,
    groupId: null,
    ...variantDefaults[type],
    ...overrides,
  } as BoardElement
}
