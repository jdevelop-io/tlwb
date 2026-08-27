import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { type Config, loadConfig } from '../../src/config'
import { connectDatabase } from '../../src/db/client'
import { createMcpServer, type McpDeps } from '../../src/mcp/server'
import { createIpLimiter } from '../../src/rate-limit'
import { createRooms, type RoomRegistry } from '../../src/rooms'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>
let rooms: RoomRegistry
let config: Config

beforeAll(async () => {
  database = await connectDatabase(url)
  config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://web.test',
    ROOM_IDLE_MS: '50',
    MCP_PRESENCE_MS: '0',
    MCP_MAX_BATCH: '3',
    MCP_MAX_IMAGE_PIXELS: '100000',
  })
  rooms = createRooms({ db: database.db, config })
})

afterAll(async () => {
  await rooms.shutdown()
  await database.close()
})

const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close()
  }
})

async function connect(
  overrides: Partial<McpDeps> = {},
  ip = '10.0.0.1',
): Promise<Client> {
  const deps: McpDeps = {
    db: database.db,
    config,
    rooms,
    createLimiter: createIpLimiter(1000, 60_000),
    ...overrides,
  }
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const server = createMcpServer(deps, ip)
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientTransport)
  clients.push(client)
  return client
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult
}

function textOf(result: CallToolResult): string {
  const block = result.content.find((c) => c.type === 'text')
  if (block?.type !== 'text') {
    throw new Error('no text block')
  }
  return block.text
}

function jsonOf<T>(result: CallToolResult): T {
  return JSON.parse(textOf(result)) as T
}

async function newBoard(client: Client, name?: string) {
  const result = await call(client, 'create_board', name ? { name } : {})
  expect(result.isError).toBeFalsy()
  return jsonOf<{ boardId: string; editUrl: string; viewUrl: string }>(result)
}

describe('tool listing', () => {
  it('advertises the six tools', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_board',
      'read_board',
    ])
  })
})

describe('create_board', () => {
  it('returns share URLs on the public origin, with the key in the fragment', async () => {
    const client = await connect()
    const board = await newBoard(client)
    expect(board.editUrl).toMatch(
      new RegExp(
        `^http://web\\.test/b/${board.boardId}#edit=[A-Za-z0-9_-]{43}$`,
      ),
    )
    expect(board.viewUrl).toMatch(
      new RegExp(
        `^http://web\\.test/b/${board.boardId}#view=[A-Za-z0-9_-]{43}$`,
      ),
    )
  })

  it('names the board and stamps its creation time', async () => {
    const client = await connect({ now: () => 1_700_000_000_000 })
    const board = await newBoard(client, 'Architecture')
    const read = jsonOf<{ meta: { name: string; createdAt: number } }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.meta).toEqual({
      name: 'Architecture',
      createdAt: 1_700_000_000_000,
    })
  })

  it('is bounded by the creation limiter of the calling address', async () => {
    const limiter = createIpLimiter(1, 60_000)
    const client = await connect({ createLimiter: limiter }, '10.9.9.9')
    await newBoard(client)
    const refused = await call(client, 'create_board', {})
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toBe(
      'too many boards created from this address, retry later',
    )
  })
})

describe('read_board', () => {
  it('returns meta and elements of an empty board', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const read = jsonOf<{ elements: unknown[] }>(
      await call(client, 'read_board', { board: board.editUrl }),
    )
    expect(read.elements).toEqual([])
  })

  it.each([
    [
      'not a url',
      'board must be a share URL like https://<host>/b/<id>#edit=<key> or #view=<key>',
    ],
    ['http://web.test/b/missing12#edit=k', 'board missing12 not found'],
  ])('answers %s with a tool error', async (board, message) => {
    const client = await connect()
    const result = await call(client, 'read_board', { board })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(message)
  })

  it('refuses a wrong key by name', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'read_board', {
      board: `http://web.test/b/${board.boardId}#edit=wrong`,
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(`key does not match board ${board.boardId}`)
  })

  it('answers a schema violation as an error result, not a crash', async () => {
    const client = await connect()
    const result = await call(client, 'read_board', { board: 42 })
    expect(result.isError).toBe(true)
  })
})
