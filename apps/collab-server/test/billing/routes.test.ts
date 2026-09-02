import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config'
import { connectDatabase, type Database } from '../../src/db/client'
import { session, user } from '../../src/db/schema'
import { createApp } from '../../src/http'
import { createRooms } from '../../src/rooms'
import { sessionCookie } from '../session-cookie'

const url =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

const AUTH_SECRET = 'test-secret-at-least-32-characters!!'
const WEBHOOK_SECRET = 'whsec_test_secret'
const PRICE_MONTHLY = 'price_month_test'
const PRICE_YEARLY = 'price_year_test'

let database: Database

beforeAll(async () => {
  database = await connectDatabase(url)
})

afterAll(async () => {
  await database.close()
})

function app(stripe: Stripe, overrides: Record<string, string> = {}) {
  const config = loadConfig({
    DATABASE_URL: url,
    CORS_ORIGIN: 'http://a',
    AUTH_SECRET,
    GITHUB_CLIENT_ID: 'gid',
    GITHUB_CLIENT_SECRET: 'gsec',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_MONTHLY: PRICE_MONTHLY,
    STRIPE_PRICE_YEARLY: PRICE_YEARLY,
    ...overrides,
  })
  return createApp({
    db: database.db,
    config,
    rooms: createRooms({ db: database.db, config }),
    stripe,
  })
}

async function createUser(
  name: string,
  email: string,
  plan: 'free' | 'pro' = 'free',
  stripeCustomerId?: string,
): Promise<string> {
  const id = randomUUID()
  await database.db
    .insert(user)
    .values({ id, name, email, plan, stripeCustomerId })
  return id
}

async function cookieFor(userId: string): Promise<string> {
  const token = randomUUID()
  await database.db.insert(session).values({
    id: randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return sessionCookie(token, AUTH_SECRET)
}

async function planOf(userId: string): Promise<string | undefined> {
  const [row] = await database.db
    .select({ plan: user.plan })
    .from(user)
    .where(eq(user.id, userId))
  return row?.plan
}

/**
 * A stub matching the three Stripe methods the routes call, plus real
 * webhook signature verification (`new Stripe(...).webhooks` is a
 * genuine Stripe SDK object, not a fake): the signature path is
 * exercised for real, everything else is a recorded call.
 */
function createStripeStub() {
  const state = {
    checkoutCalls: [] as Record<string, unknown>[],
    portalCalls: [] as Record<string, unknown>[],
    customerCreateCalls: 0,
  }
  const stripe = {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.checkoutCalls.push(params)
          return { url: 'https://stripe.test/c' }
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.portalCalls.push(params)
          return { url: 'https://stripe.test/p' }
        },
      },
    },
    customers: {
      create: async () => {
        state.customerCreateCalls += 1
        return { id: 'cus_test' }
      },
    },
    webhooks: new Stripe('sk_test_x').webhooks,
  } as unknown as Stripe
  return { state, stripe }
}

function signedRequest(
  stripe: Stripe,
  secret: string,
  payload: string,
): { headers: { 'stripe-signature': string }; body: string } {
  return {
    headers: {
      'stripe-signature': stripe.webhooks.generateTestHeaderString({
        payload,
        secret,
      }),
    },
    body: payload,
  }
}

describe('POST /billing/checkout', () => {
  it('requires a session', async () => {
    const { stripe } = createStripeStub()
    const a = app(stripe)
    const response = await a.request('http://server/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interval: 'month' }),
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'sign in required' })
  })

  it('answers the redirect url, storing the stripe customer once and reusing it after', async () => {
    const { state, stripe } = createStripeStub()
    const a = app(stripe)
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)

    const first = await a.request('http://server/billing/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ interval: 'month' }),
    })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ url: 'https://stripe.test/c' })
    expect(state.customerCreateCalls).toBe(1)

    const [row] = await database.db
      .select({ stripeCustomerId: user.stripeCustomerId })
      .from(user)
      .where(eq(user.id, userA))
    expect(row?.stripeCustomerId).toBe('cus_test')

    const second = await a.request('http://server/billing/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ interval: 'month' }),
    })
    expect(second.status).toBe(200)
    // The user is already linked to a Stripe customer: no second one
    // is created, and the checkout session reuses it.
    expect(state.customerCreateCalls).toBe(1)
    expect(state.checkoutCalls[1]).toMatchObject({ customer: 'cus_test' })
  })

  it('picks the yearly price for interval "year" and the monthly price otherwise', async () => {
    const { state, stripe } = createStripeStub()
    const a = app(stripe)
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)

    await a.request('http://server/billing/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ interval: 'month' }),
    })
    await a.request('http://server/billing/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ interval: 'year' }),
    })

    expect(state.checkoutCalls[0]).toMatchObject({
      line_items: [{ price: PRICE_MONTHLY, quantity: 1 }],
    })
    expect(state.checkoutCalls[1]).toMatchObject({
      line_items: [{ price: PRICE_YEARLY, quantity: 1 }],
    })
  })
})

describe('POST /billing/portal', () => {
  it('requires a session', async () => {
    const { stripe } = createStripeStub()
    const a = app(stripe)
    const response = await a.request('http://server/billing/portal', {
      method: 'POST',
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'sign in required' })
  })

  it('requires a stripe customer', async () => {
    const { stripe } = createStripeStub()
    const a = app(stripe)
    const userA = await createUser('Ada', `ada-${randomUUID()}@example.com`)
    const cookie = await cookieFor(userA)

    const response = await a.request('http://server/billing/portal', {
      method: 'POST',
      headers: { cookie },
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'no subscription yet' })
  })

  it('answers the portal url for a user with a stripe customer', async () => {
    const { state, stripe } = createStripeStub()
    const a = app(stripe)
    const userA = await createUser(
      'Ada',
      `ada-${randomUUID()}@example.com`,
      'free',
      'cus_existing',
    )
    const cookie = await cookieFor(userA)

    const response = await a.request('http://server/billing/portal', {
      method: 'POST',
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: 'https://stripe.test/p' })
    expect(state.portalCalls[0]).toMatchObject({ customer: 'cus_existing' })
  })
})

describe('POST /billing/webhook', () => {
  it('rejects a missing signature', async () => {
    const { stripe } = createStripeStub()
    const a = app(stripe)
    const response = await a.request('http://server/billing/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'customer.subscription.updated' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'missing signature' })
  })

  it('rejects a bad signature', async () => {
    const { stripe } = createStripeStub()
    const a = app(stripe)
    const payload = JSON.stringify({ type: 'customer.subscription.updated' })
    // Signed with the wrong secret: a real verification must reject
    // this, not accept whatever header shape shows up.
    const request = signedRequest(stripe, 'whsec_wrong_secret', payload)

    const response = await a.request('http://server/billing/webhook', {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'bad signature' })
  })

  it('flips the plan with the subscription state and stays idempotent on replay', async () => {
    const { stripe } = createStripeStub()
    const a = app(stripe)
    // A unique customer id per test run: the lookup is keyed on it, and
    // this database is not truncated between runs.
    const customerId = `cus_sub_${randomUUID()}`
    const userA = await createUser(
      'Ada',
      `ada-${randomUUID()}@example.com`,
      'free',
      customerId,
    )

    const activated = signedRequest(
      stripe,
      WEBHOOK_SECRET,
      JSON.stringify({
        id: 'evt_active',
        type: 'customer.subscription.updated',
        data: { object: { customer: customerId, status: 'active' } },
      }),
    )
    const activatedResponse = await a.request('http://server/billing/webhook', {
      method: 'POST',
      headers: activated.headers,
      body: activated.body,
    })
    expect(activatedResponse.status).toBe(200)
    expect(await planOf(userA)).toBe('pro')

    const deleted = signedRequest(
      stripe,
      WEBHOOK_SECRET,
      JSON.stringify({
        id: 'evt_deleted',
        type: 'customer.subscription.deleted',
        // A deleted subscription is never active, whatever status the
        // payload happens to still carry: the event type alone decides.
        data: { object: { customer: customerId, status: 'active' } },
      }),
    )
    const deletedResponse = await a.request('http://server/billing/webhook', {
      method: 'POST',
      headers: deleted.headers,
      body: deleted.body,
    })
    expect(deletedResponse.status).toBe(200)
    expect(await planOf(userA)).toBe('free')

    // Replaying the same event writes the same absolute state again,
    // not a second downgrade.
    const replay = await a.request('http://server/billing/webhook', {
      method: 'POST',
      headers: deleted.headers,
      body: deleted.body,
    })
    expect(replay.status).toBe(200)
    expect(await planOf(userA)).toBe('free')
  })

  it('treats a non-active status on an update as free, not only "active" as pro', async () => {
    const { stripe } = createStripeStub()
    const a = app(stripe)
    const customerId = `cus_status_${randomUUID()}`
    const userA = await createUser(
      'Ada',
      `ada-${randomUUID()}@example.com`,
      'pro',
      customerId,
    )
    const request = signedRequest(
      stripe,
      WEBHOOK_SECRET,
      JSON.stringify({
        id: 'evt_canceled',
        type: 'customer.subscription.updated',
        data: { object: { customer: customerId, status: 'canceled' } },
      }),
    )

    const response = await a.request('http://server/billing/webhook', {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    })
    expect(response.status).toBe(200)
    expect(await planOf(userA)).toBe('free')
  })

  it('ignores event types outside the subscription/checkout set', async () => {
    const { stripe } = createStripeStub()
    const a = app(stripe)
    const customerId = `cus_ignore_${randomUUID()}`
    const userA = await createUser(
      'Ada',
      `ada-${randomUUID()}@example.com`,
      'free',
      customerId,
    )
    const request = signedRequest(
      stripe,
      WEBHOOK_SECRET,
      JSON.stringify({
        id: 'evt_invoice',
        type: 'invoice.paid',
        data: { object: { customer: customerId, status: 'active' } },
      }),
    )

    const response = await a.request('http://server/billing/webhook', {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    })
    expect(response.status).toBe(200)
    expect(await planOf(userA)).toBe('free')
  })

  it('answers 200 without writing anything for an unknown customer', async () => {
    const { stripe } = createStripeStub()
    const a = app(stripe)
    const request = signedRequest(
      stripe,
      WEBHOOK_SECRET,
      JSON.stringify({
        id: 'evt_unknown',
        type: 'customer.subscription.updated',
        data: { object: { customer: 'cus_does_not_exist', status: 'active' } },
      }),
    )

    const response = await a.request('http://server/billing/webhook', {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true })
  })
})

describe('without STRIPE_SECRET_KEY configured', () => {
  it('does not mount /billing routes', async () => {
    const config = loadConfig({
      DATABASE_URL: url,
      CORS_ORIGIN: 'http://a',
      AUTH_SECRET,
      GITHUB_CLIENT_ID: 'gid',
      GITHUB_CLIENT_SECRET: 'gsec',
    })
    expect(config.billing).toBeNull()
    const a = createApp({
      db: database.db,
      config,
      rooms: createRooms({ db: database.db, config }),
    })

    const response = await a.request('http://server/billing/checkout', {
      method: 'POST',
    })
    expect(response.status).toBe(404)
  })
})
