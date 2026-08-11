import type { TextElement } from '../model/element'

export interface FontConfig {
  hand: string
  ui: string
}

/**
 * Fallback stacks only: the client passes the exact families once the
 * Foundations fonts are loaded. The engine never loads fonts itself.
 */
export const DEFAULT_FONTS: FontConfig = {
  hand: 'Caveat, cursive',
  ui: 'system-ui, sans-serif',
}

/** Line height as a multiplier on the element font size. */
export const LINE_HEIGHT = 1.25

export function fontString(element: TextElement, fonts: FontConfig): string {
  return `${element.fontSize}px ${fonts[element.fontFamily]}`
}

/** v1 text has no wrapping: lines are exactly the typed newlines. */
export function textLines(element: TextElement): string[] {
  return element.text.split('\n')
}

/** X of the alignment anchor inside the element frame. */
export function textAnchorX(element: TextElement): number {
  switch (element.textAlign) {
    case 'left':
      return 0
    case 'center':
      return element.width / 2
    case 'right':
      return element.width
  }
}
