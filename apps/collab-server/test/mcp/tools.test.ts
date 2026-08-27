import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { type Config, loadConfig } from '../../src/config'
import { connectDatabase } from '../../src/db/client'
import { createMcpServer, type McpDeps } from '../../src/mcp/server'
import {
  MAX_POINTS_PER_ELEMENT,
  MAX_TEXT_LENGTH,
} from '../../src/mcp/tools/elements'
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
      'add_elements',
      'create_board',
      'delete_elements',
      'get_board_screenshot',
      'read_board',
      'update_elements',
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

describe('add_elements', () => {
  it('creates elements with engine defaults, in input order, and returns their ids', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [
        { type: 'rectangle', id: 'box', x: 0, y: 0, width: 100, height: 50 },
        { type: 'text', x: 10, y: 10, width: 80, height: 30, text: 'Hello' },
        {
          type: 'arrow',
          x: 100,
          y: 25,
          width: 50,
          height: 0,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
          ],
          startBinding: { elementId: 'box' },
        },
      ],
    })
    expect(result.isError).toBeFalsy()
    const { ids } = jsonOf<{ ids: string[] }>(result)
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe('box')

    const read = jsonOf<{
      elements: {
        id: string
        type: string
        index: string
        strokeColor: string
        text?: string
        startBinding?: unknown
      }[]
    }>(await call(client, 'read_board', { board: board.viewUrl }))
    expect(read.elements.map((e) => e.id)).toEqual(ids)
    expect(read.elements[0]?.strokeColor).toBe('#1A1A1A')
    expect(read.elements[1]?.text).toBe('Hello')
    expect(read.elements[2]?.startBinding).toEqual({ elementId: 'box' })
    expect(
      (read.elements[0]?.index ?? '') < (read.elements[1]?.index ?? ''),
    ).toBe(true)
  })

  it('refuses a view link', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.viewUrl,
      elements: [{ type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `board ${board.boardId} is view-only with this link`,
    )
  })

  it('refuses image elements with its own message', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [{ type: 'image', x: 0, y: 0, width: 1, height: 1 }],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('image elements cannot be added over MCP')
  })

  it('refuses a batch over MCP_MAX_BATCH at the schema', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: Array.from({ length: 4 }, () => ({
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      })),
    })
    expect(result.isError).toBe(true)
  })

  it('refuses a points array over MAX_POINTS_PER_ELEMENT at the schema', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [
        {
          type: 'draw',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          points: Array.from({ length: MAX_POINTS_PER_ELEMENT + 1 }, () => ({
            x: 0,
            y: 0,
          })),
        },
      ],
    })
    expect(result.isError).toBe(true)
  })

  it('refuses text over MAX_TEXT_LENGTH at the schema', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [
        {
          type: 'text',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          text: 'a'.repeat(MAX_TEXT_LENGTH + 1),
        },
      ],
    })
    expect(result.isError).toBe(true)
  })

  it('refuses the whole batch when an id collides with an existing element, without replacing it', async () => {
    const client = await connect()
    const board = await newBoard(client)
    await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [
        { type: 'rectangle', id: 'box', x: 0, y: 0, width: 100, height: 50 },
      ],
    })
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [
        { type: 'ellipse', id: 'box', x: 0, y: 0, width: 1, height: 1 },
      ],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('element box already exists')
    const read = jsonOf<{ elements: { id: string; type: string }[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.elements.map((e) => ({ id: e.id, type: e.type }))).toEqual([
      { id: 'box', type: 'rectangle' },
    ])
  })

  it('refuses the whole batch on a duplicate id within the batch, creating nothing', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [
        { type: 'ellipse', id: 'dup', x: 0, y: 0, width: 1, height: 1 },
        { type: 'diamond', id: 'dup', x: 0, y: 0, width: 1, height: 1 },
      ],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('element dup already exists')
    const read = jsonOf<{ elements: unknown[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.elements).toEqual([])
  })
})

async function boardWithBox(client: Client) {
  const board = await newBoard(client)
  await call(client, 'add_elements', {
    board: board.editUrl,
    elements: [
      { type: 'rectangle', id: 'box', x: 0, y: 0, width: 100, height: 50 },
      {
        type: 'text',
        id: 'label',
        x: 0,
        y: 0,
        width: 50,
        height: 20,
        text: 'a',
      },
    ],
  })
  return board
}

describe('update_elements', () => {
  it('patches the named properties and keeps the others', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'update_elements', {
      board: board.editUrl,
      updates: [
        { id: 'box', x: 40, fillColor: '#FFEE00' },
        { id: 'label', text: 'b' },
      ],
    })
    expect(result.isError).toBeFalsy()
    expect(jsonOf(result)).toEqual({ updated: ['box', 'label'] })
    const read = jsonOf<{ elements: Record<string, unknown>[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    const box = read.elements.find((e) => e.id === 'box')
    expect(box).toMatchObject({ x: 40, width: 100, fillColor: '#FFEE00' })
    expect(read.elements.find((e) => e.id === 'label')).toMatchObject({
      text: 'b',
    })
  })

  it('refuses the batch when an id is unknown', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'update_elements', {
      board: board.editUrl,
      updates: [
        { id: 'box', x: 1 },
        { id: 'ghost', x: 1 },
      ],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('element ghost not found')
    const read = jsonOf<{ elements: Record<string, unknown>[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.elements.find((e) => e.id === 'box')).toMatchObject({ x: 0 })
  })

  // Documents the real engine behaviour (extra properties are
  // tolerated, `packages/engine/src/model/validate.ts`), not the
  // schema-level rejection an earlier version of the specification
  // described: `box` is a rectangle, so `text`, `containerId`, and
  // `points` are foreign to it, yet the whole patch is accepted and the
  // fields persist and round-trip through `read_board`.
  it('tolerates a foreign property, persisting it rather than rejecting it', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'update_elements', {
      board: board.editUrl,
      updates: [
        {
          id: 'box',
          text: 'nope',
          containerId: 'ghost',
          points: [{ x: 1, y: 2 }],
        },
      ],
    })
    expect(result.isError).toBeFalsy()
    expect(jsonOf(result)).toEqual({ updated: ['box'] })
    const read = jsonOf<{ elements: Record<string, unknown>[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.elements.find((e) => e.id === 'box')).toMatchObject({
      type: 'rectangle',
      text: 'nope',
      containerId: 'ghost',
      points: [{ x: 1, y: 2 }],
    })
  })

  it('refuses a view link', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'update_elements', {
      board: board.viewUrl,
      updates: [{ id: 'box', x: 1 }],
    })
    expect(textOf(result)).toBe(
      `board ${board.boardId} is view-only with this link`,
    )
  })
})

describe('delete_elements', () => {
  it('deletes the named elements', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'delete_elements', {
      board: board.editUrl,
      ids: ['label'],
    })
    expect(jsonOf(result)).toEqual({ deleted: ['label'] })
    const read = jsonOf<{ elements: { id: string }[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.elements.map((e) => e.id)).toEqual(['box'])
  })

  it('refuses the batch when an id is unknown', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'delete_elements', {
      board: board.editUrl,
      ids: ['box', 'ghost'],
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('element ghost not found')
    const read = jsonOf<{ elements: { id: string }[] }>(
      await call(client, 'read_board', { board: board.viewUrl }),
    )
    expect(read.elements).toHaveLength(2)
  })
})

function imageOf(result: CallToolResult): { data: string; mimeType: string } {
  const block = result.content.find((c) => c.type === 'image')
  if (block?.type !== 'image') {
    throw new Error('no image block')
  }
  return block
}

describe('get_board_screenshot', () => {
  it('returns a PNG image block', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'get_board_screenshot', {
      board: board.viewUrl,
    })
    expect(result.isError).toBeFalsy()
    const image = imageOf(result)
    expect(image.mimeType).toBe('image/png')
    expect(Buffer.from(image.data, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    )
  })

  it('refuses a render over MCP_MAX_IMAGE_PIXELS', async () => {
    const client = await connect()
    const board = await newBoard(client)
    await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [{ type: 'rectangle', x: 0, y: 0, width: 1000, height: 1000 }],
    })
    const result = await call(client, 'get_board_screenshot', {
      board: board.viewUrl,
      scale: 1,
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `board ${board.boardId} is too large to render; lower scale`,
    )
  })

  it('bounds scale at the schema', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const result = await call(client, 'get_board_screenshot', {
      board: board.viewUrl,
      scale: 9,
    })
    expect(result.isError).toBe(true)
  })
})

describe('read_board with image', () => {
  it('adds a PNG block after the JSON text', async () => {
    const client = await connect()
    const board = await boardWithBox(client)
    const result = await call(client, 'read_board', {
      board: board.viewUrl,
      image: true,
    })
    expect(result.content.map((c) => c.type)).toEqual(['text', 'image'])
    expect(jsonOf<{ elements: unknown[] }>(result).elements).toHaveLength(2)
  })
})

/** Log lines this tool call produced, parsed and filtered by tool name. */
async function logsFor(
  tool: string,
  run: () => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((line) => {
    lines.push(String(line))
  })
  try {
    await run()
  } finally {
    spy.mockRestore()
  }
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.tool === tool)
}

describe('tool call logging', () => {
  it('carries the board id on both a success and a failure, never the key', async () => {
    const client = await connect()
    const board = await newBoard(client)
    const key = board.editUrl.split('#edit=')[1] as string

    const events = await logsFor('read_board', async () => {
      await call(client, 'read_board', { board: board.editUrl })
      await call(client, 'read_board', {
        board: `http://web.test/b/${board.boardId}#edit=wrong`,
      })
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ boardId: board.boardId, ok: true })
    expect(typeof events[0]?.ms).toBe('number')
    expect(events[1]).toMatchObject({ boardId: board.boardId, ok: false })
    for (const event of events) {
      expect(JSON.stringify(event)).not.toContain(key)
    }
  })

  it('has no board id for create_board until it succeeds', async () => {
    const refusingLimiter = createIpLimiter(0, 60_000)
    const client = await connect({ createLimiter: refusingLimiter })

    const refused = await logsFor('create_board', () =>
      call(client, 'create_board', {}),
    )
    expect(refused).toHaveLength(1)
    expect(refused[0]?.ok).toBe(false)
    expect(refused[0]?.boardId).toBeUndefined()

    const successClient = await connect()
    const succeeded = await logsFor('create_board', () =>
      call(successClient, 'create_board', {}),
    )
    expect(succeeded).toHaveLength(1)
    expect(succeeded[0]?.ok).toBe(true)
    expect(typeof succeeded[0]?.boardId).toBe('string')
  })
})

describe('relative share URLs (CORS_ORIGIN=*, no PUBLIC_URL)', () => {
  it('creates a board whose relative link every other tool still accepts', async () => {
    const relativeConfig = loadConfig({
      DATABASE_URL: url,
      CORS_ORIGIN: '*',
      ROOM_IDLE_MS: '50',
    })
    const client = await connect({ config: relativeConfig })
    const board = await newBoard(client)
    expect(board.editUrl).toMatch(/^\/b\/.+#edit=/)
    expect(board.viewUrl).toMatch(/^\/b\/.+#view=/)

    const read = await call(client, 'read_board', { board: board.editUrl })
    expect(read.isError).toBeFalsy()
    const added = await call(client, 'add_elements', {
      board: board.editUrl,
      elements: [{ type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }],
    })
    expect(added.isError).toBeFalsy()
  })
})
