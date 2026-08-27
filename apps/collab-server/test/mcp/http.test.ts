import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config'
import { connectDatabase } from '../../src/db/client'
import { createApp } from '../../src/http'
import { createRooms, type RoomRegistry } from '../../src/rooms'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>
let rooms: RoomRegistry

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await rooms?.shutdown()
  await database.close()
})

function app(overrides: Record<string, string> = {}, now?: () => number) {
  const config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    ROOM_IDLE_MS: '50',
    ...overrides,
  })
  rooms = createRooms({ db: database.db, config })
  return createApp({ db: database.db, config, rooms, now })
}

function rpc(
  method: string,
  params: Record<string, unknown> = {},
  ip = '10.0.0.1',
) {
  return new Request('http://server/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}

/** The first JSON-RPC result of a JSON or SSE-framed response. */
async function resultOf(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  const line = text.split('\n').find((l) => l.startsWith('data:')) ?? text
  return JSON.parse(line.replace(/^data:\s*/, '')).result
}

describe('POST /mcp', () => {
  it('answers a tools/list through the streamable HTTP transport', async () => {
    const response = await app({ TRUST_PROXY: 'true' }).request(
      rpc('tools/list'),
    )
    expect(response.status).toBe(200)
    const result = await resultOf(response)
    const names = (result.tools as { name: string }[]).map((t) => t.name)
    expect(names).toContain('create_board')
    expect(names).toHaveLength(6)
  })

  it('limits requests per address', async () => {
    let now = 0
    const limited = app(
      { TRUST_PROXY: 'true', MCP_LIMIT_PER_MIN: '2' },
      () => now,
    )
    expect(
      (await limited.request(rpc('tools/list', {}, '10.1.1.1'))).status,
    ).toBe(200)
    expect(
      (await limited.request(rpc('tools/list', {}, '10.1.1.1'))).status,
    ).toBe(200)
    const refused = await limited.request(rpc('tools/list', {}, '10.1.1.1'))
    expect(refused.status).toBe(429)
    expect(
      (await limited.request(rpc('tools/list', {}, '10.1.1.2'))).status,
    ).toBe(200)
    now = 60_000
    expect(
      (await limited.request(rpc('tools/list', {}, '10.1.1.1'))).status,
    ).toBe(200)
  })

  it('runs a tool call end to end over HTTP', async () => {
    const response = await app({ TRUST_PROXY: 'true' }).request(
      rpc('tools/call', { name: 'create_board', arguments: {} }),
    )
    expect(response.status).toBe(200)
    const result = await resultOf(response)
    const text = (result.content as { text: string }[])[0]?.text ?? ''
    expect(JSON.parse(text).editUrl).toMatch(/^http:\/\/a\/b\/.+#edit=/)
  })
})
