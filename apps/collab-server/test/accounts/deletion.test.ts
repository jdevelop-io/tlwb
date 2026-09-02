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
 * A stub matching only the two Stripe methods the cleanup calls;
 * `list` filters by `status` the way the real API does, so a call that
 * forgets to ask for `status: 'active'` gets back the wrong set.
 */
function createStripeStub(subscriptions: { id: string; status: string }[]) {
  const state = {
    listCalls: [] as Record<string, unknown>[],
    cancelCalls: [] as string[],
  }
  const stripe = {
    subscriptions: {
      list: async (params: Record<string, unknown>) => {
        state.listCalls.push(params)
        return {
          data: subscriptions.filter((sub) => sub.status === params.status),
        }
      },
      cancel: async (id: string) => {
        state.cancelCalls.push(id)
      },
    },
  } as unknown as Stripe
  return { state, stripe }
}

describe('accountCleanup', () => {
  it('re-anonymizes boards, revokes the api key, cancels the subscription', async () => {
    const { state, stripe } = createStripeStub([
      { id: 'sub_1', status: 'active' },
      { id: 'sub_2', status: 'canceled' },
    ])
    const userA = await createUser('cus_1')
    const boardA1 = await ownedBoard(userA)
    const boardA2 = await ownedBoard(userA)
    const key = await issueApiKey(database.db, userA)

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

    // Only the active subscription is cancelled: the list call asked
    // for `status: 'active'`, and the canceled one it filtered out
    // never reaches `cancel`.
    expect(state.listCalls).toEqual([{ customer: 'cus_1', status: 'active' }])
    expect(state.cancelCalls).toEqual(['sub_1'])
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
    const key = await issueApiKey(database.db, userA)

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
