import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config'
import * as dbClient from '../src/db/client'
import { startServer } from '../src/server'

afterEach(() => vi.restoreAllMocks())

describe('startServer', () => {
  it('closes the database when the extension migration throws', async () => {
    const close = vi.fn(async () => undefined)
    vi.spyOn(dbClient, 'connectDatabase').mockResolvedValue({
      db: {} as never,
      close,
    })
    const config = loadConfig({
      DATABASE_URL: 'postgres://unused/unused',
      CORS_ORIGIN: '*',
    })

    await expect(
      startServer(config, {
        migrate: async () => {
          throw new Error('migration boom')
        },
      }),
    ).rejects.toThrow('migration boom')

    expect(close).toHaveBeenCalledOnce()
  })
})
