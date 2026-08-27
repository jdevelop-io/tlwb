import type { Peer } from '@tlwb/engine'
import { useEffect, useState } from 'react'
import type { BoardSession } from '../session/board-session'
import { useSession } from './use-session'

/** Re-subscribes when the session swaps its presence (share, rename). */
export function usePeers(session: BoardSession): Peer[] {
  const snapshot = useSession(session)
  const [peers, setPeers] = useState<Peer[]>([])
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot triggers a resubscribe, it is not read in the effect
  useEffect(() => {
    const presence = session.presence()
    setPeers(presence.getPeers())
    return presence.subscribe(() => setPeers(presence.getPeers()))
  }, [session, snapshot])
  return peers
}
