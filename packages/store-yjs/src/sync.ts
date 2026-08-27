import type { Awareness } from 'y-protocols/awareness'
import { WebsocketProvider } from 'y-websocket'
import type * as Y from 'yjs'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/** The server says the link itself is wrong; reconnecting cannot help. */
const PERMANENT_CLOSE_CODES = new Set([4401, 4403, 4404])

export interface ConnectOptions {
  /** Collaboration server, for example `wss://collab.tlwb.app`. */
  url: string
  boardId: string
  /** Link token; the server enforces read-only or edit from it. */
  token: string
  /** Defaults to true. False mounts the provider without dialing. */
  connect?: boolean
}

export interface BoardConnection {
  provider: WebsocketProvider
  awareness: Awareness
  getStatus(): ConnectionStatus
  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void
  /** Every socket closure; the code is null when closed locally. */
  subscribeClose(listener: (code: number | null) => void): () => void
  /** Resumes after a permanent close, once the caller fixed its cause. */
  reconnect(): void
  destroy(): void
}

/**
 * Thin wrapper over y-websocket: reconnection with backoff, the y-sync
 * and awareness protocols, and resynchronization after a gap are the
 * provider's. Local editing never waits on the connection.
 */
export function connectBoard(
  doc: Y.Doc,
  options: ConnectOptions,
): BoardConnection {
  const connect = options.connect ?? true
  const provider = new WebsocketProvider(options.url, options.boardId, doc, {
    params: { token: options.token },
    connect,
    shouldReconnect: (event) => !PERMANENT_CLOSE_CODES.has(event.code),
  })
  let status: ConnectionStatus = connect ? 'connecting' : 'disconnected'
  const listeners = new Set<(status: ConnectionStatus) => void>()
  const closeListeners = new Set<(code: number | null) => void>()

  provider.on('status', (event: { status: ConnectionStatus }) => {
    status = event.status
    for (const listener of listeners) {
      listener(status)
    }
  })

  provider.on('connection-close', (event: CloseEvent | null) => {
    const code = event?.code ?? null
    for (const listener of closeListeners) {
      listener(code)
    }
  })

  return {
    provider,
    awareness: provider.awareness,
    getStatus: () => status,
    subscribeStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeClose(listener) {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    reconnect: () => provider.connect(),
    destroy() {
      // Cleared before the transition below on purpose: the caller asked
      // for the teardown and does not need to hear about its own effect.
      listeners.clear()
      closeListeners.clear()
      provider.destroy()
      status = 'disconnected'
    },
  }
}
