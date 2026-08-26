import { z } from 'zod'
import type { BoardElement } from './element'

// zod 4 numbers reject NaN and infinities by default, which is the
// guard a trust boundary needs against a malformed remote element.
const base = {
  id: z.string().min(1),
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
  index: z.string().min(1),
  groupId: z.string().nullable(),
}

// The hash addresses the asset over HTTP, where it is a path segment
// the server matches against this exact shape. An element still under
// construction carries an empty placeholder until its upload lands.
const assetHash = z.union([z.literal(''), z.string().regex(/^[a-f0-9]{64}$/)])

const point = z.object({ x: z.number(), y: z.number() })
const binding = z.object({ elementId: z.string() }).nullable()

const elementSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('rectangle') }),
  z.object({ ...base, type: z.literal('ellipse') }),
  z.object({ ...base, type: z.literal('diamond') }),
  z.object({ ...base, type: z.literal('line'), points: z.array(point) }),
  z.object({
    ...base,
    type: z.literal('arrow'),
    points: z.array(point),
    startBinding: binding,
    endBinding: binding,
  }),
  z.object({ ...base, type: z.literal('draw'), points: z.array(point) }),
  z.object({
    ...base,
    type: z.literal('text'),
    text: z.string(),
    fontSize: z.number(),
    fontFamily: z.enum(['hand', 'ui']),
    textAlign: z.enum(['left', 'center', 'right']),
    containerId: z.string().nullable(),
  }),
  z.object({ ...base, type: z.literal('image'), assetHash }),
])

/**
 * Whether a value received from outside the engine (network, agent,
 * import) is a well-formed element. Extra properties are tolerated:
 * the engine ignores what it does not know.
 */
export function validateElement(value: unknown): value is BoardElement {
  return elementSchema.safeParse(value).success
}
