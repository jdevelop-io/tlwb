import { useEffect, useRef, useState } from 'react'
import type { BoardSession } from '../session/board-session'
import { useSession } from './use-session'

export interface CloseCodeState {
  /** The server no longer knows this link (4401, 4404). */
  linkDead: boolean
  /** A write was refused on a link that only grants viewing (4403). */
  editRefused: boolean
}

/**
 * Turns the connection's close codes into what the board has to tell
 * the user, and into the key transitions they call for. Transient codes
 * are handed to `onTransient` instead, since they say nothing about the
 * link itself.
 */
export function useCloseCode(
  session: BoardSession,
  onTransient: (message: string) => void,
): CloseCodeState {
  const snapshot = useSession(session)
  const [linkDead, setLinkDead] = useState(false)
  const [editRefused, setEditRefused] = useState(false)
  // Kept in a ref so a caller passing an inline function does not
  // reopen the effect on every render.
  const transient = useRef(onTransient)
  transient.current = onTransient

  useEffect(() => {
    const code = snapshot.closeCode
    if (code === 4401 || code === 4404) {
      session.forgetKeys()
      setLinkDead(true)
    } else if (code === 4403) {
      if (snapshot.role === 'view') {
        // Already demoted (or handed a view link to begin with), so
        // there is no key left to give up: the refused change is still
        // in the document and every fresh connection pushes it again.
        // Saying so beats leaving the user silently disconnected.
        setEditRefused(true)
      } else {
        session.becomeViewer()
      }
    } else if (code === 4409 || code === 4422 || code === 4429) {
      transient.current('Change refused by the server')
    }
    // Consumed once: clearing it here makes an identical repeat a real
    // transition next time, so the effect fires again instead of the
    // code lingering unchanged.
    if (code !== null) {
      session.acknowledgeClose()
    }
  }, [session, snapshot.closeCode, snapshot.role])

  return { linkDead, editRefused }
}
