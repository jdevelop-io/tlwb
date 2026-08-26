import type { FontFamily, TextAlign } from '../model/element'

export interface FontConfig {
  hand: string
  ui: string
}

/** What sizing a text needs; a `TextElement` satisfies it. */
export interface TextSpec {
  text: string
  fontSize: number
  fontFamily: FontFamily
}

export interface TextSize {
  width: number
  height: number
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

export function fontString(spec: TextSpec, fonts: FontConfig): string {
  return `${spec.fontSize}px ${fonts[spec.fontFamily]}`
}

/** v1 text has no wrapping: lines are exactly the typed newlines. */
export function textLines(spec: { text: string }): string[] {
  return spec.text.split('\n')
}

/** X of the alignment anchor inside the element frame. */
export function textAnchorX(element: {
  width: number
  textAlign: TextAlign
}): number {
  switch (element.textAlign) {
    case 'left':
      return 0
    case 'center':
      return element.width / 2
    case 'right':
      return element.width
  }
}

/**
 * Size of a text as the scene paints it: the widest line measured by
 * the context, the height from the line count. Any 2D context works;
 * the editor keeps one offscreen for this, and the host uses it to
 * size its DOM editor so editing and rendering agree.
 */
export function measureText(
  spec: TextSpec,
  fonts: FontConfig,
  ctx: CanvasRenderingContext2D,
): TextSize {
  ctx.font = fontString(spec, fonts)
  let width = 0
  const lines = textLines(spec)
  for (const line of lines) {
    width = Math.max(width, ctx.measureText(line).width)
  }
  return { width, height: lines.length * spec.fontSize * LINE_HEIGHT }
}
