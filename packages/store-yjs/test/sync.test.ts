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
})
