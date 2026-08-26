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
    })
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

  it('requires CORS_ORIGIN in production and allows any origin otherwise', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production' }),
    ).toThrow(new ConfigError('CORS_ORIGIN is required'))
    expect(loadConfig({ DATABASE_URL: 'postgres://x' }).corsOrigin).toBe('*')
  })

  it('fails naming a non-numeric limit', () => {
    expect(() => loadConfig({ ...minimal, MAX_DOC_BYTES: 'big' })).toThrow(
      new ConfigError('MAX_DOC_BYTES must be a positive integer'),
    )
    expect(() => loadConfig({ ...minimal, PORT: '-1' })).toThrow(
      new ConfigError('PORT must be a positive integer'),
    )
  })
})
