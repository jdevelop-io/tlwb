import { z } from 'zod'
import type { ElementId, Point } from './model/element'

/**
 * One remote collaborator as the overlay paints it. The host derives it
 * from its presence transport (Yjs awareness in the client); the engine
 * never learns where it came from.
 */
export interface Peer {
  id: string
  name: string
  color: string
  /** World coordinates; null when the peer has no cursor to show. */
  cursor: Point | null
  selectedIds: ElementId[]
  isAgent: boolean
}

// zod 4 numbers reject NaN and infinities by default, which is the
// guard the overlay needs against a malformed remote cursor.
const peerSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  cursor: z.object({ x: z.number(), y: z.number() }).nullable(),
  selectedIds: z.array(z.string()),
  isAgent: z.boolean(),
})

/** Keeps the well-formed peers and drops the rest without throwing. */
export function sanitizePeers(peers: readonly unknown[]): Peer[] {
  const kept: Peer[] = []
  for (const peer of peers) {
    const parsed = peerSchema.safeParse(peer)
    if (parsed.success) {
      kept.push(parsed.data)
    }
  }
  return kept
}
