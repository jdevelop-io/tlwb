import { StreamableHTTPTransport } from '@hono/mcp'
import type { HttpBindings } from '@hono/node-server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { clientIp } from '../http'
import { createIpLimiter } from '../rate-limit'
import type { Caller } from './caller'
import { createMcpServer, type McpDeps } from './server'

type Env = { Bindings: HttpBindings }

// Matches `API_KEY_PREFIX` in `src/accounts/api-keys.ts` of a deployment
// that composes `mcpKeys`: this module never imports that (optional,
// deployment-only) module, so the prefix is named again here rather
// than reaching for it.
const API_KEY_PREFIX = 'tlwb_'

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
      const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
      let caller: Caller = { kind: 'anonymous', ip }
      // With nothing to resolve a key against, or a bearer that is not
      // one of this deployment's own keys, the bearer is noise: the
      // caller stays anonymous rather than being refused.
      if (bearer?.startsWith(API_KEY_PREFIX) && deps.extension.mcpKeys) {
        const keyed = await deps.extension.mcpKeys.resolve(bearer)
        caller =
          keyed === 'invalid'
            ? { kind: 'invalid', ip }
            : {
                kind: 'keyed',
                ip,
                userId: keyed.userId,
                boardIds: keyed.boardIds,
              }
      }
      if (
        c.req.method === 'POST' &&
        caller.kind !== 'keyed' &&
        !limiter.take(ip)
      ) {
        return c.json({ error: 'too many requests' }, 429)
      }
      const server = createMcpServer(deps, caller)
      const transport = new StreamableHTTPTransport()
      await server.connect(transport)
      return transport.handleRequest(c)
    },
  )
  return app
}
