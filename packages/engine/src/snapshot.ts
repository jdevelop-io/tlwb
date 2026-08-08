import { z } from 'zod'
import type { BoardElement } from './model/element'
import type { BoardChange, BoardMeta, BoardStore } from './store/types'

const pointSchema = z.object({ x: z.number(), y: z.number() })

const baseShape = {
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  angle: z.number(),
  strokeColor: z.string(),
  fillColor: z.string().nullable(),
  strokeWidth: z.number(),
  strokeStyle: z.enum(['solid', 'dashed']),
  sketchiness: z.number(),
  opacity: z.number(),
  seed: z.number(),
  index: z.string(),
  groupId: z.string().nullable(),
}

const bindingSchema = z.object({ elementId: z.string() }).nullable()

const elementSchema = z.discriminatedUnion('type', [
  z.object({ ...baseShape, type: z.literal('rectangle') }),
  z.object({ ...baseShape, type: z.literal('ellipse') }),
  z.object({ ...baseShape, type: z.literal('diamond') }),
  z.object({ ...baseShape, type: z.literal('line'), points: z.array(pointSchema) }),
  z.object({
    ...baseShape,
    type: z.literal('arrow'),
    points: z.array(pointSchema),
    startBinding: bindingSchema,
    endBinding: bindingSchema,
  }),
  z.object({ ...baseShape, type: z.literal('draw'), points: z.array(pointSchema) }),
  z.object({
    ...baseShape,
    type: z.literal('text'),
    text: z.string(),
    fontSize: z.number(),
    fontFamily: z.enum(['hand', 'ui']),
    textAlign: z.enum(['left', 'center', 'right']),
    containerId: z.string().nullable(),
  }),
  z.object({ ...baseShape, type: z.literal('image'), assetHash: z.string() }),
])

const snapshotSchema = z.object({
  schema: z.literal(1),
  meta: z.object({ name: z.string(), createdAt: z.number() }),
  elements: z.array(elementSchema),
})

export interface BoardSnapshot {
  schema: 1
  meta: BoardMeta
  elements: BoardElement[]
}

export function exportSnapshot(store: BoardStore): BoardSnapshot {
  return {
    schema: 1,
    meta: store.getMeta(),
    elements: store.listElements(),
  }
}

export function importSnapshot(
  store: BoardStore,
  snapshot: BoardSnapshot,
): void {
  const deletions = store
    .listElements()
    .map((element): BoardChange => ({ kind: 'delete', id: element.id }))
  const creations = snapshot.elements.map(
    (element): BoardChange => ({ kind: 'create', element }),
  )
  store.applyChanges([...deletions, ...creations], 'remote')
  store.setMeta(snapshot.meta)
}

export function parseSnapshot(data: unknown): BoardSnapshot {
  return snapshotSchema.parse(data) as BoardSnapshot
}
