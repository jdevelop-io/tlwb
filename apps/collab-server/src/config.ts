export interface AccountsConfig {
  secret: string
  github: { clientId: string; clientSecret: string } | null
  google: { clientId: string; clientSecret: string } | null
}

export interface BillingConfig {
  secretKey: string
  webhookSecret: string
  priceMonthly: string
  priceYearly: string
}

export interface Config {
  databaseUrl: string
  port: number
  corsOrigin: string
  maxMessageBytes: number
  maxDocBytes: number
  maxAssetBytes: number
  maxAwarenessBytes: number
  roomIdleMs: number
  compactAfterUpdates: number
  rateLimitPer10s: number
  createLimitPerMin: number
  trustProxy: boolean
  /** Origin the share URLs returned by MCP are built on. */
  publicUrl: string
  mcpLimitPerMin: number
  /** Renders per IP per minute, stricter than `mcpLimitPerMin`. */
  mcpRenderLimitPerMin: number
  mcpPresenceMs: number
  mcpMaxBatch: number
  mcpMaxImagePixels: number
  accounts: AccountsConfig | null
  billing: BillingConfig | null
  freeBoardCap: number
  mcpQuotaFree: number
  mcpQuotaPro: number
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

type Env = Record<string, string | undefined>

function required(env: Env, name: string): string {
  const value = env[name]
  if (!value) {
    throw new ConfigError(`${name} is required`)
  }
  return value
}

function integer(
  env: Env,
  name: string,
  fallback: number,
  minimum = 1,
): number {
  const raw = env[name]
  if (raw === undefined) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum) {
    throw new ConfigError(`${name} must be a positive integer`)
  }
  return value
}

function boolean(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]
  if (raw === undefined) {
    return fallback
  }
  if (raw !== 'true' && raw !== 'false') {
    throw new ConfigError(`${name} must be true or false`)
  }
  return raw === 'true'
}

function provider(
  env: Env,
  idName: string,
  secretName: string,
): { clientId: string; clientSecret: string } | null {
  const clientId = env[idName]
  const clientSecret = env[secretName]
  if (!clientId && !clientSecret) {
    return null
  }
  if (!clientId || !clientSecret) {
    throw new ConfigError(`${idName} and ${secretName} go together`)
  }
  return { clientId, clientSecret }
}

function accountsConfig(env: Env): AccountsConfig | null {
  const secret = env.AUTH_SECRET
  if (!secret) {
    return null
  }
  const github = provider(env, 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET')
  const google = provider(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')
  if (!github && !google) {
    throw new ConfigError('AUTH_SECRET needs at least one OAuth provider')
  }
  return { secret, github, google }
}

function billingConfig(env: Env): BillingConfig | null {
  if (!env.STRIPE_SECRET_KEY) {
    return null
  }
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: required(env, 'STRIPE_WEBHOOK_SECRET'),
    priceMonthly: required(env, 'STRIPE_PRICE_MONTHLY'),
    priceYearly: required(env, 'STRIPE_PRICE_YEARLY'),
  }
}

/** Reads and validates the environment; throws ConfigError on the first problem. */
export function loadConfig(env: Env): Config {
  // Always required, wildcard included: a wide-open API must be
  // something an operator wrote down, not something a forgotten
  // NODE_ENV handed them.
  const corsOrigin = required(env, 'CORS_ORIGIN')
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    // 0 asks the OS for an ephemeral port; the tests rely on it.
    port: integer(env, 'PORT', 3000, 0),
    corsOrigin,
    maxMessageBytes: integer(env, 'MAX_MESSAGE_BYTES', 1_048_576),
    maxDocBytes: integer(env, 'MAX_DOC_BYTES', 5_242_880),
    maxAssetBytes: integer(env, 'MAX_ASSET_BYTES', 10_485_760),
    maxAwarenessBytes: integer(env, 'MAX_AWARENESS_BYTES', 16_384),
    roomIdleMs: integer(env, 'ROOM_IDLE_MS', 60_000),
    compactAfterUpdates: integer(env, 'COMPACT_AFTER_UPDATES', 500),
    rateLimitPer10s: integer(env, 'RATE_LIMIT_PER_10S', 200),
    createLimitPerMin: integer(env, 'CREATE_LIMIT_PER_MIN', 10),
    // Off by default: with nothing in front, X-Forwarded-For is
    // written by the client itself. The shipped Compose file turns it
    // on, where the server is only reachable through Caddy.
    trustProxy: boolean(env, 'TRUST_PROXY', false),
    publicUrl: env.PUBLIC_URL || corsOrigin,
    mcpLimitPerMin: integer(env, 'MCP_LIMIT_PER_MIN', 120),
    mcpRenderLimitPerMin: integer(env, 'MCP_RENDER_LIMIT_PER_MIN', 20),
    mcpPresenceMs: integer(env, 'MCP_PRESENCE_MS', 5000, 0),
    mcpMaxBatch: integer(env, 'MCP_MAX_BATCH', 200),
    // Rasterizing is synchronous native work: nothing else on the
    // event loop runs while it lasts, so the ceiling bounds a stall
    // every live WebSocket session pays for. 4M pixels measures at
    // roughly 75ms, where 16M measured at 283ms.
    mcpMaxImagePixels: integer(env, 'MCP_MAX_IMAGE_PIXELS', 4_000_000),
    accounts: accountsConfig(env),
    billing: billingConfig(env),
    freeBoardCap: integer(env, 'FREE_BOARD_CAP', 10),
    mcpQuotaFree: integer(env, 'MCP_QUOTA_FREE', 1000),
    mcpQuotaPro: integer(env, 'MCP_QUOTA_PRO', 50000),
  }
}
