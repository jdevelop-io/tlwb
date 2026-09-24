import type { FontConfig } from '@tlwb/engine'

/** Ink first, then the six markers, in the Paper swatch order. */
export const STROKE_COLORS: readonly string[] = [
  '#1A1A1A',
  '#E5484D',
  '#FA8C16',
  '#F5C518',
  '#46A758',
  '#3B82F6',
  '#8E4EC6',
]

/** No fill, then the pastel of each marker, same order. */
export const FILL_COLORS: readonly (string | null)[] = [
  null,
  '#FDE8E8',
  '#FEF0DE',
  '#FDF6D8',
  '#E7F4E9',
  '#E4EEFD',
  '#F3EAFA',
]

/** The board's own white: every export of it. */
export const BOARD_BACKGROUND = '#FFFFFF'

export const FONTS: FontConfig = {
  hand: 'Caveat, cursive',
  ui: 'Inter, system-ui, sans-serif',
}
