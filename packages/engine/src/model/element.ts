export type ElementId = string

export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'draw'
  | 'text'
  | 'image'

export type StrokeStyle = 'solid' | 'dashed'

export interface Point {
  x: number
  y: number
}

export interface ElementBase {
  id: ElementId
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  angle: number
  strokeColor: string
  fillColor: string | null
  strokeWidth: number
  strokeStyle: StrokeStyle
  sketchiness: number
  opacity: number
  seed: number
  index: string
  groupId: string | null
}

export interface RectangleElement extends ElementBase {
  type: 'rectangle'
}

export interface EllipseElement extends ElementBase {
  type: 'ellipse'
}

export interface DiamondElement extends ElementBase {
  type: 'diamond'
}

export interface LineElement extends ElementBase {
  type: 'line'
  points: Point[]
}

export interface ArrowBinding {
  elementId: ElementId
}

export interface ArrowElement extends ElementBase {
  type: 'arrow'
  points: Point[]
  startBinding: ArrowBinding | null
  endBinding: ArrowBinding | null
}

export interface DrawElement extends ElementBase {
  type: 'draw'
  points: Point[]
}

export type TextAlign = 'left' | 'center' | 'right'
export type FontFamily = 'hand' | 'ui'

export interface TextElement extends ElementBase {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: FontFamily
  textAlign: TextAlign
  containerId: ElementId | null
}

export interface ImageElement extends ElementBase {
  type: 'image'
  assetHash: string
}

export type BoardElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | LineElement
  | ArrowElement
  | DrawElement
  | TextElement
  | ImageElement

/**
 * Writable properties across all variants, used by update changes and
 * by the createElement factory overrides. `id` and `type` are never
 * updatable.
 */
export type ElementProps = Partial<Omit<ElementBase, 'id' | 'type'>> &
  Partial<Pick<LineElement, 'points'>> &
  Partial<Pick<ArrowElement, 'startBinding' | 'endBinding'>> &
  Partial<
    Pick<TextElement, 'text' | 'fontSize' | 'fontFamily' | 'textAlign' | 'containerId'>
  > &
  Partial<Pick<ImageElement, 'assetHash'>>
