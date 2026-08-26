import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { connectBoard } from '../src/sync'

describe('connectBoard', () => {
  it('derives the status from the provider and passes the token', () => {
    const connection = connectBoard(new Y.Doc(), {
      url: 'ws://localhost:1',
      boardId: 'board-1',
      token: 'secret',
      connect: false,
    })
    const seen: string[] = []
    const unsubscribe = connection.subscribeStatus((status) =>
      seen.push(status),
    )

    expect(connection.getStatus()).toBe('disconnected')
    expect(connection.provider.url).toContain('token=secret')
    expect(connection.provider.roomname).toBe('board-1')

    connection.provider.emit('status', [{ status: 'connecting' }])
    connection.provider.emit('status', [{ status: 'connected' }])
    expect(connection.getStatus()).toBe('connected')
    expect(seen).toEqual(['connecting', 'connected'])

    unsubscribe()
    connection.provider.emit('status', [{ status: 'disconnected' }])
    expect(connection.getStatus()).toBe('disconnected')
    expect(seen).toEqual(['connecting', 'connected'])

    connection.destroy()
  })

  it('reports disconnected after destroy even mid-connection', () => {
    const connection = connectBoard(new Y.Doc(), {
      url: 'ws://localhost:1',
      boardId: 'board-1',
      token: 'secret',
      connect: false,
    })

    connection.provider.emit('status', [{ status: 'connecting' }])
    connection.destroy()

    expect(connection.getStatus()).toBe('disconnected')
  })

  it('reports close codes and stops reconnecting only on 4401, 4403, 4404', () => {
    const connection = connectBoard(new Y.Doc(), {
      url: 'ws://localhost:1',
      boardId: 'board-1',
      token: 'secret',
      connect: false,
    })
    const codes: Array<number | null> = []
    connection.subscribeClose((code) => codes.push(code))
    connection.provider.emit('connection-close', [
      { code: 4422 } as CloseEvent,
      connection.provider,
    ])
    connection.provider.emit('connection-close', [null, connection.provider])
    expect(codes).toEqual([4422, null])

    const reconnects = (code: number) =>
      connection.provider.shouldReconnect(
        { code } as CloseEvent,
        connection.provider,
      )
    expect(reconnects(4401)).toBe(false)
    expect(reconnects(4403)).toBe(false)
    expect(reconnects(4404)).toBe(false)
    expect(reconnects(4409)).toBe(true)
    expect(reconnects(4422)).toBe(true)
    expect(reconnects(4429)).toBe(true)
    expect(reconnects(1006)).toBe(true)
    connection.destroy()
  })
})
