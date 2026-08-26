import type { Awareness } from 'y-protocols/awareness'
import { WebsocketProvider } from 'y-websocket'
import type * as Y from 'yjs'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

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
  })
  let status: ConnectionStatus = connect ? 'connecting' : 'disconnected'
  const listeners = new Set<(status: ConnectionStatus) => void>()

  provider.on('status', (event: { status: ConnectionStatus }) => {
    status = event.status
    for (const listener of listeners) {
      listener(status)
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
    destroy() {
      listeners.clear()
      provider.destroy()
    },
  }
}
