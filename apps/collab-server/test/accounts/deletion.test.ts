import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { issueApiKey, resolveApiKey } from '../../src/accounts/api-keys'
import { accountCleanup } from '../../src/accounts/cleanup'
import { findBoard } from '../../src/db/boards'
import { connectDatabase, type Database } from '../../src/db/client'
import { boards, user } from '../../src/db/schema'
import { generateKey, hashKey, resolveRole } from '../../src/keys'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

let database: Database

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

async function createUser(stripeCustomerId?: string): Promise<string> {
  const id = randomUUID()
  await database.db
    .insert(user)
    .values({ id, name: 'Ada', email: `${id}@example.com`, stripeCustomerId })
  return id
}

/** A board inserted directly, owned by `ownerId`, with a known clear view key. */
async function ownedBoard(ownerId: string): Promise<{
  boardId: string
  viewKey: string
}> {
  const boardId = randomUUID()
  const viewKey = generateKey()
  await database.db.insert(boards).values({
    id: boardId,
    editKeyHash: hashKey(generateKey()),
    viewKeyHash: hashKey(viewKey),
    ownerId,
  })
  return { boardId, viewKey }
}

/**
 * A stub matching only the two Stripe methods the cleanup calls.
 * `list` paginates `pageSize` at a time via `starting_after`, the way
 * the real API does, so a call that reads only the first page misses
 * subscriptions past it; a call that forgets `status: 'all'` gets back
 * the wrong set.
 */
function createStripeStub(
  subscriptions: { id: string; status: Stripe.Subscription.Status }[],
  pageSize = 100,
) {
  const state = {
    listCalls: [] as Record<string, unknown>[],
    cancelCalls: [] as string[],
  }
  const stripe = {
    subscriptions: {
      list: async (params: Record<string, unknown>) => {
        state.listCalls.push(params)
        const pool =
          params.status === 'all'
            ? subscriptions
            : subscriptions.filter((sub) => sub.status === params.status)
        const start = params.starting_after
          ? pool.findIndex((sub) => sub.id === params.starting_after) + 1
          : 0
        const data = pool.slice(start, start + pageSize)
        return { data, has_more: start + pageSize < pool.length }
      },
      cancel: async (id: string) => {
        state.cancelCalls.push(id)
      },
    },
  } as unknown as Stripe
  return { state, stripe }
}

describe('accountCleanup', () => {
  it('re-anonymizes boards, revokes the api key, cancels every non-terminal subscription', async () => {
    const { state, stripe } = createStripeStub([
      { id: 'sub_1', status: 'active' },
      { id: 'sub_2', status: 'canceled' },
      { id: 'sub_3', status: 'trialing' },
      { id: 'sub_4', status: 'past_due' },
      { id: 'sub_5', status: 'incomplete_expired' },
    ])
    const userA = await createUser('cus_1')
    const boardA1 = await ownedBoard(userA)
    const boardA2 = await ownedBoard(userA)
    const { key } = await issueApiKey(database.db, userA, {
      name: 'test',
      boardIds: null,
    })

    // A board owned by someone else must survive this untouched: the
    // strongest proof `disownBoards` is scoped to the deleted user.
    const userB = await createUser()
    const boardB = await ownedBoard(userB)

    await accountCleanup(database.db, stripe)(userA)

    const foundA1 = await findBoard(database.db, boardA1.boardId)
    const foundA2 = await findBoard(database.db, boardA2.boardId)
    expect(foundA1?.ownerId).toBeNull()
    expect(foundA2?.ownerId).toBeNull()
    // The board rows themselves, and their share keys, are untouched:
    // a share link for either board still resolves.
    expect(resolveRole(boardA1.viewKey, foundA1 as never)).toBe('view')
    expect(resolveRole(boardA2.viewKey, foundA2 as never)).toBe('view')

    const foundB = await findBoard(database.db, boardB.boardId)
    expect(foundB?.ownerId).toBe(userB)

    expect(await resolveApiKey(database.db, key)).toBeNull()

    // Every subscription not already terminal is cancelled, a
    // trialing or past-due one included: only the already-canceled and
    // the never-started `incomplete_expired` one are left alone. The
    // list call asked for every status, not just `active`.
    expect(state.listCalls).toEqual([
      { customer: 'cus_1', status: 'all', starting_after: undefined },
    ])
    expect(state.cancelCalls.sort()).toEqual(['sub_1', 'sub_3', 'sub_4'])
  })

  it('paginates through every page of subscriptions', async () => {
    const subs = Array.from({ length: 3 }, (_, i) => ({
      id: `sub_${i}`,
      status: 'active' as const,
    }))
    const { state, stripe } = createStripeStub(subs, 1)
    const userA = await createUser('cus_page')

    await accountCleanup(database.db, stripe)(userA)

    expect(state.listCalls).toEqual([
      { customer: 'cus_page', status: 'all', starting_after: undefined },
      { customer: 'cus_page', status: 'all', starting_after: 'sub_0' },
      { customer: 'cus_page', status: 'all', starting_after: 'sub_1' },
    ])
    expect(state.cancelCalls.sort()).toEqual(['sub_0', 'sub_1', 'sub_2'])
  })

  it('still disowns boards and revokes the key when the billing step throws', async () => {
    const stripe = {
      subscriptions: {
        list: async () => {
          throw new Error('stripe is down')
        },
        cancel: async () => undefined,
      },
    } as unknown as Stripe
    const userA = await createUser('cus_down')
    const board = await ownedBoard(userA)
    const { key } = await issueApiKey(database.db, userA, {
      name: 'test',
      boardIds: null,
    })

    // A Stripe outage must not throw out of the cleanup: the rest of
    // the deletion still runs, and the hook itself still resolves so
    // Better Auth actually deletes the user row.
    await expect(
      accountCleanup(database.db, stripe)(userA),
    ).resolves.toBeUndefined()

    expect((await findBoard(database.db, board.boardId))?.ownerId).toBeNull()
    expect(await resolveApiKey(database.db, key)).toBeNull()
  })

  it('tolerates a user with nothing to clean', async () => {
    const { state, stripe } = createStripeStub([])
    const userA = await createUser()
    await expect(
      accountCleanup(database.db, stripe)(userA),
    ).resolves.toBeUndefined()
    expect(state.listCalls).toEqual([])
    expect(state.cancelCalls).toEqual([])
  })

  it('skips the subscription step entirely with no stripe configured', async () => {
    const userA = await createUser('cus_1')
    const board = await ownedBoard(userA)
    const { key } = await issueApiKey(database.db, userA, {
      name: 'test',
      boardIds: null,
    })

    // A null stripe must not be dereferenced; boards and the key are
    // still cleaned up.
    await accountCleanup(database.db, null)(userA)

    expect((await findBoard(database.db, board.boardId))?.ownerId).toBeNull()
    expect(await resolveApiKey(database.db, key)).toBeNull()
  })

  it('skips the subscription lookup for a user with no stripe customer', async () => {
    const { state, stripe } = createStripeStub([
      { id: 'sub_1', status: 'active' },
    ])
    const userA = await createUser()

    await accountCleanup(database.db, stripe)(userA)

    // No customer id on the user: `subscriptions.list` is never
    // called, whatever subscriptions the stub could otherwise answer.
    expect(state.listCalls).toEqual([])
    expect(state.cancelCalls).toEqual([])
  })
})
