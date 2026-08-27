import { StreamableHTTPTransport } from '@hono/mcp'
import type { HttpBindings } from '@hono/node-server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { clientIp } from '../http'
import { createIpLimiter } from '../rate-limit'
import { createMcpServer, type McpDeps } from './server'

type Env = { Bindings: HttpBindings }

/**
 * The MCP endpoint, stateless: one transport and one McpServer per
 * request, nothing kept between two. Mounted under `/mcp` by the HTTP
 * application, so the route here is `/`.
 */
export function createMcpApp(
  deps: McpDeps & { trustProxy: boolean },
): Hono<Env> {
  const app = new Hono<Env>()
  const limiter = createIpLimiter(
    deps.config.mcpLimitPerMin,
    60_000,
    deps.now ?? Date.now,
  )
  app.all(
    '/',
    // Same bound the WebSocket path enforces (`room.ts`'s
    // `maxMessageBytes`): unauthenticated, reachable from the public
    // internet, and read whole into memory before anything looks at a
    // key, so it must never be unbounded.
    bodyLimit({
      maxSize: deps.config.maxMessageBytes,
      onError: (c) => c.json({ error: 'request body too large' }, 413),
    }),
    async (c) => {
      const ip = clientIp(c, deps.trustProxy)
      if (c.req.method === 'POST' && !limiter.take(ip)) {
        return c.json({ error: 'too many requests' }, 429)
      }
      const server = createMcpServer(deps, ip)
      const transport = new StreamableHTTPTransport()
      await server.connect(transport)
      return transport.handleRequest(c)
    },
  )
  return app
}
