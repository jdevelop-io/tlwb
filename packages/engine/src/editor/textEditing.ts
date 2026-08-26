import { hitTestElement, hitTestElementInterior } from '../geometry/hit'
import { isBindable, labelFrame } from '../model/bindings'
import { createElement } from '../model/create'
import type {
  BoardElement,
  ElementId,
  ElementProps,
  Point,
  TextElement,
} from '../model/element'
import { deleteElements } from '../model/operations'
import type { TextSize, TextSpec } from '../render/text'
import type { BoardChange } from '../store/types'

export type Measure = (spec: TextSpec) => TextSize

export type DoubleClickTarget =
  | { kind: 'edit'; id: ElementId }
  | { kind: 'label'; containerId: ElementId }
  | { kind: 'create' }
  | { kind: 'none' }

/**
 * What a double-click means, topmost element first: edit the text under
 * the point, label the shape under it (or edit the label it already
 * has), start a text on empty canvas, nothing on any other element. A
 * shape counts as hit anywhere inside, hollow or not, unlike a single
 * click that grabs its outline.
 */
export function resolveDoubleClick(
  elements: readonly BoardElement[],
  world: Point,
  tolerance: number,
): DoubleClickTarget {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i] as BoardElement
    if (element.opacity === 0) {
      continue
    }
    if (element.type === 'text') {
      if (hitTestElement(element, world, tolerance)) {
        return { kind: 'edit', id: element.id }
      }
      continue
    }
    if (isBindable(element)) {
      if (!hitTestElementInterior(element, world, tolerance)) {
        continue
      }
      const label = elements.find(
        (candidate) =>
          candidate.type === 'text' && candidate.containerId === element.id,
      )
      return label
        ? { kind: 'edit', id: label.id }
        : { kind: 'label', containerId: element.id }
    }
    if (hitTestElement(element, world, tolerance)) {
      return { kind: 'none' }
    }
  }
  return { kind: 'create' }
}

/**
 * Changes committing edited text: the text and its measured size, a
 * label recentered in its container, or a delete when the text is
 * blank. Empty for an unknown id or a non-text element.
 */
export function commitTextChanges(
  elements: readonly BoardElement[],
  id: ElementId,
  text: string,
  measure: Measure,
): BoardChange[] {
  const element = elements.find((candidate) => candidate.id === id)
  if (element?.type !== 'text') {
    return []
  }
  if (text.trim() === '') {
    return deleteElements(elements, [id])
  }
  const size = measure({
    text,
    fontSize: element.fontSize,
    fontFamily: element.fontFamily,
  })
  const props: ElementProps = {
    text,
    width: size.width,
    height: size.height,
  }
  const container = element.containerId
    ? elements.find((candidate) => candidate.id === element.containerId)
    : undefined
  if (container) {
    Object.assign(props, labelFrame(container, size))
  }
  return [{ kind: 'update', id, props }]
}

/** A new empty label: center aligned, one line tall, centered in its container. */
export function createLabel(
  container: BoardElement,
  index: string,
  defaults: ElementProps,
  measure: Measure,
): TextElement {
  const fontSize = defaults.fontSize ?? 20
  const fontFamily = defaults.fontFamily ?? 'hand'
  const size = measure({ text: '', fontSize, fontFamily })
  return createElement('text', {
    index,
    ...defaults,
    ...labelFrame(container, size),
    width: size.width,
    height: size.height,
    textAlign: 'center',
    containerId: container.id,
  }) as TextElement
}
