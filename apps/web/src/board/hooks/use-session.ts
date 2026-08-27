import { useSyncExternalStore } from 'react'
import type { BoardSession, SessionSnapshot } from '../session/board-session'

export function useSession(session: BoardSession): SessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot)
}
