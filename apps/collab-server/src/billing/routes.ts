import { Hono } from 'hono'
import Stripe from 'stripe'
import { type Auth, sessionUser } from '../accounts/auth'
import type { Config } from '../config'
import type { Db } from '../db/client'
import {
  findUserByStripeCustomer,
  setPlan,
  setStripeCustomer,
} from '../db/users'
import { log } from '../log'

export interface BillingDeps {
  db: Db
  config: Config
  auth: Auth | null
  /** Injected by tests. */
  stripe?: Stripe
}

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function createBillingApp(deps: BillingDeps): Hono {
  const billing = deps.config.billing
  if (!billing) {
    throw new Error('billing app mounted without billing config')
  }
  const stripe = deps.stripe ?? new Stripe(billing.secretKey)
  const app = new Hono()
  const base = deps.config.publicUrl === '*' ? '' : deps.config.publicUrl

  app.post('/checkout', async (c) => {
    const user = await sessionUser(deps.auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    const body = await c.req.json().catch(() => ({}))
    const price =
      body.interval === 'year' ? billing.priceYearly : billing.priceMonthly
    let customer = user.stripeCustomerId
    if (!customer) {
      customer = (await stripe.customers.create({ email: user.email })).id
      await setStripeCustomer(deps.db, user.id, customer)
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price, quantity: 1 }],
      success_url: `${base}/dashboard?checkout=success`,
      cancel_url: `${base}/dashboard`,
    })
    return c.json({ url: session.url })
  })

  app.post('/portal', async (c) => {
    const user = await sessionUser(deps.auth, c.req.raw.headers)
    if (!user) {
      return c.json({ error: 'sign in required' }, 401)
    }
    if (!user.stripeCustomerId) {
      return c.json({ error: 'no subscription yet' }, 409)
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${base}/dashboard`,
    })
    return c.json({ url: session.url })
  })

  app.post('/webhook', async (c) => {
    const signature = c.req.header('stripe-signature')
    if (!signature) {
      return c.json({ error: 'missing signature' }, 400)
    }
    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        await c.req.text(),
        signature,
        billing.webhookSecret,
      )
    } catch {
      return c.json({ error: 'bad signature' }, 400)
    }
    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted' ||
      event.type === 'checkout.session.completed'
    ) {
      const object = event.data.object as {
        customer?: string | { id: string }
      }
      const customerId =
        typeof object.customer === 'string'
          ? object.customer
          : object.customer?.id
      const user = customerId
        ? await findUserByStripeCustomer(deps.db, customerId)
        : undefined
      if (user) {
        // The absolute state, not a delta: replays and reordering land
        // on the same answer. A completed checkout is always active (it
        // carries no subscription status); a deleted subscription is
        // always inactive; an update goes by its own status.
        const active =
          event.type === 'checkout.session.completed' ||
          (event.type === 'customer.subscription.updated' &&
            ACTIVE_STATUSES.has(
              (event.data.object as { status: string }).status,
            ))
        await setPlan(deps.db, user.id, active ? 'pro' : 'free')
        log({ event: 'plan updated', userId: user.id, active })
      }
    }
    return c.json({ received: true })
  })

  return app
}
