import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as api from '../src/index'

describe('public surface', () => {
  it('exports exactly what a deployment composes with', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'ConfigError',
        'boards',
        'claimBoard',
        'clientIp',
        'connectDatabase',
        'countOwnedBoards',
        'createIpLimiter',
        'deleteBoardRows',
        'disownBoards',
        'exceedsPixelBudget',
        'findBoard',
        'identify',
        'listOwnedBoards',
        'loadConfig',
        'loadImages',
        'log',
        'readBoardStore',
        'renderPng',
        'resolveRole',
        'startServer',
      ].sort(),
    )
  })

  it('runs the extension migration after its own, before listening', async () => {
    const seen: string[] = []
    const server = await api.startServer(
      api.loadConfig({
        DATABASE_URL: process.env.DATABASE_URL,
        CORS_ORIGIN: 'http://a',
        PORT: '0',
      }),
      {
        migrate: async (db) => {
          const rows = await db.execute(sql`
            select table_name from information_schema.tables
            where table_name = 'boards'
          `)
          seen.push(rows.length === 1 ? 'boards ready' : 'boards missing')
        },
      },
    )
    try {
      expect(seen).toEqual(['boards ready'])
      const health = await fetch(`http://localhost:${server.port}/health`)
      expect(health.status).toBe(200)
    } finally {
      await server.close()
    }
  })
})
