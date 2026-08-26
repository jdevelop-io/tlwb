import type { Server as HttpServer } from 'node:http'
import { serve } from '@hono/node-server'
import type { Config } from './config'
import { connectDatabase } from './db/client'
import { createApp } from './http'
import { log } from './log'
import { CLOSE } from './protocol'
import { createRooms } from './rooms'
import { attachWebSocket } from './ws'

export interface RunningServer {
  port: number
  close(): Promise<void>
}

export async function startServer(config: Config): Promise<RunningServer> {
  const database = await connectDatabase(config.databaseUrl)
  const rooms = createRooms({ db: database.db, config })
  const app = createApp({ db: database.db, config })

  const { server, port } = await new Promise<{
    server: HttpServer
    port: number
  }>((resolve) => {
    const instance = serve({ fetch: app.fetch, port: config.port }, (info) => {
      resolve({ server: instance as HttpServer, port: info.port })
    })
  })
  const wss = attachWebSocket(server, { db: database.db, config, rooms })
  log({ event: 'listening', port })

  return {
    port,
    async close() {
      // Stop accepting new connections first: an upgrade landing during
      // the drain below would create a room `rooms.shutdown()` already
      // finished with, and its live socket would keep this close()
      // pending indefinitely. `attachWebSocket` is the only thing that
      // ever adds an 'upgrade' listener to this server.
      server.removeAllListeners('upgrade')
      for (const client of wss.clients) {
        client.close(CLOSE.shuttingDown, 'server shutting down')
      }
      await rooms.shutdown()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      await database.close()
      log({ event: 'stopped' })
    },
  }
}
