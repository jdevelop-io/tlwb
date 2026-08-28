import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// A board over the pixel ceiling must be refused before a single asset
// is loaded, not after: `loadImages` is wrapped so its call count is
// observable, while everything else keeps its real behaviour.
vi.mock('../../src/mcp/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/mcp/render')>()
  return { ...actual, loadImages: vi.fn(actual.loadImages) }
})

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { loadConfig } from '../../src/config'
import { connectDatabase } from '../../src/db/client'
import { loadImages } from '../../src/mcp/render'
import { createMcpServer, type McpDeps } from '../../src/mcp/server'
import { createIpLimiter } from '../../src/rate-limit'
import { createRooms, type RoomRegistry } from '../../src/rooms'

const url = process.env.DATABASE_URL as string
let database: Awaited<ReturnType<typeof connectDatabase>>
let rooms: RoomRegistry
let config: ReturnType<typeof loadConfig>

beforeAll(async () => {
  database = await connectDatabase(url)
  config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://web.test',
    ROOM_IDLE_MS: '50',
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
  vi.mocked(loadImages).mockClear()
})

async function connect(): Promise<Client> {
  const deps: McpDeps = {
    db: database.db,
    config,
    rooms,
    createLimiter: createIpLimiter(1000, 60_000),
    renderLimiter: createIpLimiter(1000, 60_000),
  }
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const server = createMcpServer(deps, '10.0.0.1')
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

function jsonOf<T>(result: CallToolResult): T {
  const block = result.content.find((c) => c.type === 'text')
  if (block?.type !== 'text') {
    throw new Error('no text block')
  }
  return JSON.parse(block.text) as T
}

async function newBoard(client: Client) {
  const result = await call(client, 'create_board', {})
  return jsonOf<{ boardId: string; editUrl: string; viewUrl: string }>(result)
}

describe('image loading order', () => {
  it('never loads an asset for a board over the pixel budget', async () => {
    const client = await connect()
    const board = await newBoard(client)
    await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [{ type: 'rectangle', x: 0, y: 0, width: 1000, height: 1000 }],
    })

    const screenshot = await call(client, 'get_board_screenshot', {
      board: board.viewUrl,
    })
    expect(screenshot.isError).toBe(true)
    expect(vi.mocked(loadImages)).not.toHaveBeenCalled()

    const read = await call(client, 'read_board', {
      board: board.viewUrl,
      image: true,
    })
    expect(read.isError).toBe(true)
    expect(vi.mocked(loadImages)).not.toHaveBeenCalled()
  })

  it('loads assets once the board fits the pixel budget', async () => {
    const client = await connect()
    const board = await newBoard(client)
    await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
    })

    const screenshot = await call(client, 'get_board_screenshot', {
      board: board.viewUrl,
    })
    expect(screenshot.isError).toBeFalsy()
    expect(vi.mocked(loadImages)).toHaveBeenCalledTimes(1)

    const read = await call(client, 'read_board', {
      board: board.viewUrl,
      image: true,
    })
    expect(read.isError).toBeFalsy()
    expect(vi.mocked(loadImages)).toHaveBeenCalledTimes(2)
  })
})
