import type { HttpBindings } from '@hono/node-server'
import type { Context, Hono } from 'hono'
import type { Config } from './config'
import type { Db } from './db/client'
import type { IpLimiter } from './rate-limit'
import type { RoomRegistry } from './rooms'

export type Env = { Bindings: HttpBindings }

/** Whoever a request is, by an id this server never interprets. */
export interface Principal {
  id: string
}

export interface McpKeys {
  /** A bearer presented to /mcp: who it belongs to and which boards it
   * may reach (null: every board its share links resolve). */
  resolve(
    bearer: string,
  ): Promise<{ userId: string; boardIds: string[] | null } | 'invalid'>
  /** One tool call is about to run for this key's owner. False refuses it. */
  spend(userId: string): Promise<boolean>
}

export interface ExtensionContext {
  db: Db
  config: Config
  rooms: RoomRegistry
  /** The visitor's address, honouring TRUST_PROXY the way the core does. */
  clientIp(c: Context<Env>): string
  /** A per-address token bucket refilled every minute. */
  createIpLimiter(perMinute: number): IpLimiter
}

/**
 * What a deployment may add on top of the anonymous server. Every
 * member is optional; with none of them, everyone is anonymous, any
 * principal may create boards, bearers on /mcp are ignored, and no
 * extra route exists.
 */
export interface Extension {
  /** Who this request is, from its headers. Absent, or null: anonymous. */
  identify?(headers: Headers): Promise<Principal | null>
  /** May this principal create one more board? Absent: always. */
  canCreateBoard?(principalId: string): Promise<boolean>
  /** Bearer keys presented to /mcp. Absent: anonymous callers only. */
  mcpKeys?: McpKeys
  /** Runs once, right after this server's own migrations, before listening. */
  migrate?(db: Db): Promise<void>
  /** Extra routes, registered before the core ones. */
  mount?(app: Hono<Env>, ctx: ExtensionContext): void
}

export async function identify(
  extension: Extension,
  headers: Headers,
): Promise<Principal | null> {
  return extension.identify ? extension.identify(headers) : null
}
