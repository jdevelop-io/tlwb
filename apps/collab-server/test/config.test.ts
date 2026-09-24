import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config'

const minimal = { DATABASE_URL: 'postgres://x', CORS_ORIGIN: 'http://a' }

describe('loadConfig', () => {
  it('applies the defaults', () => {
    const config = loadConfig(minimal)
    expect(config).toEqual({
      databaseUrl: 'postgres://x',
      port: 3000,
      corsOrigin: 'http://a',
      maxMessageBytes: 1_048_576,
      maxDocBytes: 5_242_880,
      maxAssetBytes: 10_485_760,
      maxAwarenessBytes: 16_384,
      roomIdleMs: 60_000,
      compactAfterUpdates: 500,
      rateLimitPer10s: 200,
      createLimitPerMin: 10,
      trustProxy: false,
      publicUrl: 'http://a',
      mcpLimitPerMin: 120,
      mcpRenderLimitPerMin: 20,
      mcpPresenceMs: 5000,
      mcpMaxBatch: 200,
      mcpMaxImagePixels: 4_000_000,
    })
  })

  it('knows nothing about accounts, billing, caps, or quotas', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      CORS_ORIGIN: '*',
      AUTH_SECRET: 's',
      STRIPE_SECRET_KEY: 'sk',
      FREE_BOARD_CAP: '1',
      MCP_QUOTA_FREE: '1',
    })
    expect(Object.keys(config)).not.toContain('accounts')
    expect(Object.keys(config)).not.toContain('billing')
    expect(Object.keys(config)).not.toContain('freeBoardCap')
    expect(Object.keys(config)).not.toContain('mcpQuotaFree')
    expect(Object.keys(config)).not.toContain('authLimitPerMin')
  })

  it('reads overrides', () => {
    const config = loadConfig({ ...minimal, PORT: '8080', ROOM_IDLE_MS: '5' })
    expect(config.port).toBe(8080)
    expect(config.roomIdleMs).toBe(5)
    expect(loadConfig({ ...minimal, PORT: '0' }).port).toBe(0)
  })

  it('fails naming a missing DATABASE_URL', () => {
    expect(() => loadConfig({ CORS_ORIGIN: 'http://a' })).toThrow(
      new ConfigError('DATABASE_URL is required'),
    )
  })

  it('requires CORS_ORIGIN everywhere, and takes an explicit wildcard', () => {
    // A wide-open API is a deliberate act, never a default: a server
    // started with bare tsx and no NODE_ENV must say so out loud.
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow(
      new ConfigError('CORS_ORIGIN is required'),
    )
    expect(
      loadConfig({ DATABASE_URL: 'postgres://x', CORS_ORIGIN: '*' }).corsOrigin,
    ).toBe('*')
  })

  it('reads TRUST_PROXY as a boolean', () => {
    expect(loadConfig({ ...minimal, TRUST_PROXY: 'true' }).trustProxy).toBe(
      true,
    )
    expect(loadConfig({ ...minimal, TRUST_PROXY: 'false' }).trustProxy).toBe(
      false,
    )
    expect(() => loadConfig({ ...minimal, TRUST_PROXY: 'yes' })).toThrow(
      new ConfigError('TRUST_PROXY must be true or false'),
    )
  })

  it('fails naming a non-numeric limit', () => {
    expect(() => loadConfig({ ...minimal, MAX_DOC_BYTES: 'big' })).toThrow(
      new ConfigError('MAX_DOC_BYTES must be a positive integer'),
    )
    expect(() => loadConfig({ ...minimal, PORT: '-1' })).toThrow(
      new ConfigError('PORT must be a positive integer'),
    )
  })

  it('reads PUBLIC_URL and the MCP settings from the environment', () => {
    const config = loadConfig({
      ...minimal,
      PUBLIC_URL: 'https://tlwb.example',
      MCP_LIMIT_PER_MIN: '5',
      MCP_RENDER_LIMIT_PER_MIN: '2',
      MCP_PRESENCE_MS: '100',
      MCP_MAX_BATCH: '3',
      MCP_MAX_IMAGE_PIXELS: '1000',
    })
    expect(config.publicUrl).toBe('https://tlwb.example')
    expect(config.mcpLimitPerMin).toBe(5)
    expect(config.mcpRenderLimitPerMin).toBe(2)
    expect(config.mcpPresenceMs).toBe(100)
    expect(config.mcpMaxBatch).toBe(3)
    expect(config.mcpMaxImagePixels).toBe(1000)
  })
})
