import { expandToGroups, touchedGroupIds } from '../selection'
import type { BoardChange } from '../store/types'
import type { BoardElement, ElementId, ElementProps, Point } from './element'
import { indexAfter, indexBetween } from './ordering'

/**
 * Deletes the elements and everything that cannot survive them: text
 * labels bound to a deleted container die too, and surviving arrows
 * bound to a deleted element lose that binding.
 */
export function deleteElements(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const doomed = new Set(ids)
  for (const element of elements) {
    if (
      element.type === 'text' &&
      element.containerId !== null &&
      doomed.has(element.containerId)
    ) {
      doomed.add(element.id)
    }
  }
  const changes: BoardChange[] = []
  for (const element of elements) {
    if (element.type !== 'arrow' || doomed.has(element.id)) {
      continue
    }
    const props: ElementProps = {}
    if (element.startBinding && doomed.has(element.startBinding.elementId)) {
      props.startBinding = null
    }
    if (element.endBinding && doomed.has(element.endBinding.elementId)) {
      props.endBinding = null
    }
    if (Object.keys(props).length > 0) {
      changes.push({ kind: 'update', id: element.id, props })
    }
  }
  for (const element of elements) {
    if (doomed.has(element.id)) {
      changes.push({ kind: 'delete', id: element.id })
    }
  }
  return changes
}

/**
 * Clones the elements on top of the scene, preserving their relative
 * order. Groups get fresh shared ids; bindings and label containers are
 * remapped when their target is cloned too, and dropped otherwise. The
 * render seed is kept so a clone looks identical to its source.
 */
export function duplicateElements(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
  offset: Point,
): { changes: BoardChange[]; newIds: ElementId[] } {
  const wanted = new Set(ids)
  const source = elements.filter((element) => wanted.has(element.id))
  const idMap = new Map<ElementId, ElementId>()
  for (const element of source) {
    idMap.set(element.id, crypto.randomUUID())
  }
  const groupMap = new Map<string, string>()
  let lastIndex = elements.at(-1)?.index ?? null
  const changes: BoardChange[] = []
  for (const element of source) {
    const index = indexAfter(lastIndex)
    lastIndex = index
    const clone = {
      ...element,
      id: idMap.get(element.id) as ElementId,
      x: element.x + offset.x,
      y: element.y + offset.y,
      index,
    } as BoardElement
    if (element.groupId !== null) {
      let mapped = groupMap.get(element.groupId)
      if (!mapped) {
        mapped = crypto.randomUUID()
        groupMap.set(element.groupId, mapped)
      }
      clone.groupId = mapped
    }
    if (clone.type === 'arrow') {
      clone.points = clone.points.map((point) => ({ ...point }))
      const start = clone.startBinding
        ? idMap.get(clone.startBinding.elementId)
        : undefined
      const end = clone.endBinding
        ? idMap.get(clone.endBinding.elementId)
        : undefined
      clone.startBinding = start ? { elementId: start } : null
      clone.endBinding = end ? { elementId: end } : null
    } else if (clone.type === 'line' || clone.type === 'draw') {
      clone.points = clone.points.map((point) => ({ ...point }))
    } else if (clone.type === 'text' && clone.containerId !== null) {
      clone.containerId = idMap.get(clone.containerId) ?? null
    }
    changes.push({ kind: 'create', element: clone })
  }
  return {
    changes,
    newIds: source.map((element) => idMap.get(element.id) as ElementId),
  }
}

/** One fresh shared group id over the expanded selection. */
export function groupElements(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const targets = expandToGroups(elements, ids)
  if (targets.length < 2) {
    return []
  }
  const groupId = crypto.randomUUID()
  return targets.map((id) => ({ kind: 'update', id, props: { groupId } }))
}

/** Dissolves every group touched by the selection. */
export function ungroupElements(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const groups = touchedGroupIds(elements, ids)
  return elements
    .filter(
      (element) => element.groupId !== null && groups.has(element.groupId),
    )
    .map((element) => ({
      kind: 'update' as const,
      id: element.id,
      props: { groupId: null },
    }))
}

function selectedInOrder(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardElement[] {
  const wanted = new Set(ids)
  return elements.filter((element) => wanted.has(element.id))
}

export function bringToFront(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const selected = selectedInOrder(elements, ids)
  let lastIndex = elements.at(-1)?.index ?? null
  return selected.map((element) => {
    const index = indexAfter(lastIndex)
    lastIndex = index
    return { kind: 'update' as const, id: element.id, props: { index } }
  })
}

export function sendToBack(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const selected = selectedInOrder(elements, ids)
  const wanted = new Set(ids)
  const bottom =
    elements.find((element) => !wanted.has(element.id))?.index ?? null
  let lower: string | null = null
  return selected.map((element) => {
    const index = indexBetween(lower, bottom)
    lower = index
    return { kind: 'update' as const, id: element.id, props: { index } }
  })
}

/**
 * Moves the selection as one block just above the nearest non-selected
 * element in front of it. Empty batch when nothing is in front.
 */
export function bringForward(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const selected = selectedInOrder(elements, ids)
  const topmost = selected.at(-1)
  if (!topmost) {
    return []
  }
  const wanted = new Set(ids)
  const remaining = elements.filter((element) => !wanted.has(element.id))
  const neighborPosition = remaining.findIndex(
    (element) => element.index > topmost.index,
  )
  if (neighborPosition === -1) {
    return []
  }
  let lower: string | null = (remaining[neighborPosition] as BoardElement).index
  const upper = remaining[neighborPosition + 1]?.index ?? null
  return selected.map((element) => {
    const index = indexBetween(lower, upper)
    lower = index
    return { kind: 'update' as const, id: element.id, props: { index } }
  })
}

/** Mirror of bringForward, jumping below the nearest element behind. */
export function sendBackward(
  elements: readonly BoardElement[],
  ids: readonly ElementId[],
): BoardChange[] {
  const selected = selectedInOrder(elements, ids)
  const bottommost = selected[0]
  if (!bottommost) {
    return []
  }
  const wanted = new Set(ids)
  const remaining = elements.filter((element) => !wanted.has(element.id))
  let neighborPosition = -1
  for (let i = 0; i < remaining.length; i += 1) {
    if ((remaining[i] as BoardElement).index < bottommost.index) {
      neighborPosition = i
    }
  }
  if (neighborPosition === -1) {
    return []
  }
  const upper = (remaining[neighborPosition] as BoardElement).index
  let lower: string | null = remaining[neighborPosition - 1]?.index ?? null
  return selected.map((element) => {
    const index = indexBetween(lower, upper)
    lower = index
    return { kind: 'update' as const, id: element.id, props: { index } }
  })
}
