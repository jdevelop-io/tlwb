import type { FontConfig } from '@tlwb/engine'

/** Ink first, then the six markers of the product design. */
export const STROKE_COLORS: readonly string[] = [
  '#1A1A1A',
  '#E03131',
  '#F76707',
  '#2F9E44',
  '#1971C2',
  '#7048E8',
  '#F59F00',
]

/** No fill, then the pastel of each marker, same order. */
export const FILL_COLORS: readonly (string | null)[] = [
  null,
  '#FFC9C9',
  '#FFD8A8',
  '#B2F2BB',
  '#A5D8FF',
  '#D0BFFF',
  '#FFEC99',
]

export const FONTS: FontConfig = {
  hand: 'Caveat, cursive',
  ui: 'Inter, system-ui, sans-serif',
}
