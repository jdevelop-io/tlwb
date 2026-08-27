import { type BoardElement, getElementBounds } from '@tlwb/engine'
import { z } from 'zod'
import type { AgentPresence } from '../agent-client'

const point = z.object({ x: z.number(), y: z.number() })
const binding = z.object({ elementId: z.string() }).nullable()

const style = {
  angle: z.number().optional().describe('Radians'),
  strokeColor: z.string().optional(),
  fillColor: z.string().nullable().optional(),
  strokeWidth: z.number().optional(),
  strokeStyle: z.enum(['solid', 'dashed']).optional(),
  sketchiness: z.number().optional().describe('0 clean, 1 hand-drawn, 2 rough'),
  opacity: z.number().optional().describe('0 to 1'),
  groupId: z.string().nullable().optional(),
}

const box = {
  id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional: set it to bind an arrow to this element in the same batch',
    ),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  ...style,
}

const textProps = {
  fontSize: z.number().optional(),
  fontFamily: z.enum(['hand', 'ui']).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  containerId: z.string().nullable().optional(),
}

const points = z.array(point).describe('Relative to x and y, in world units')

/**
 * The engine's element variants with a required core and optional style;
 * `createElement` fills the rest. `image` is accepted here so the tool
 * can refuse it with its own message instead of a schema error.
 */
export const elementInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rectangle'), ...box }),
  z.object({ type: z.literal('ellipse'), ...box }),
  z.object({ type: z.literal('diamond'), ...box }),
  z.object({ type: z.literal('line'), ...box, points }),
  z.object({
    type: z.literal('arrow'),
    ...box,
    points,
    startBinding: binding.optional(),
    endBinding: binding.optional(),
  }),
  z.object({ type: z.literal('draw'), ...box, points }),
  z.object({
    type: z.literal('text'),
    ...box,
    text: z.string(),
    ...textProps,
  }),
  z.object({ type: z.literal('image'), ...box }),
])
export type ElementInput = z.infer<typeof elementInput>

export const elementPatch = z.object({
  id: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  ...style,
  points: points.optional(),
  startBinding: binding.optional(),
  endBinding: binding.optional(),
  text: z.string().optional(),
  ...textProps,
})
export type ElementPatch = z.infer<typeof elementPatch>

export function elementInputSchema(maxBatch: number) {
  return z.array(elementInput).min(1).max(maxBatch)
}

export function elementPatchSchema(maxBatch: number) {
  return z.array(elementPatch).min(1).max(maxBatch)
}

export function idsSchema(maxBatch: number) {
  return z.array(z.string()).min(1).max(maxBatch)
}

export const agentNameParam = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .optional()
  .describe('Name shown on the agent avatar; defaults to "Agent"')

/** Cursor on the last touched element, selection on all of them. */
export function presenceFor(
  touched: readonly BoardElement[],
  name: string | undefined,
): AgentPresence {
  const last = touched.at(-1)
  const cursor = last
    ? (() => {
        const bounds = getElementBounds(last)
        return {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        }
      })()
    : null
  return {
    name: name ?? 'Agent',
    cursor,
    selectedIds: touched.map((element) => element.id),
  }
}
