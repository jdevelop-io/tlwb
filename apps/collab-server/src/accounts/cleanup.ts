import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { disownBoards } from '../db/boards'
import type { Db } from '../db/client'
import { user } from '../db/schema'
import { log } from '../log'
import { revokeApiKey } from './api-keys'

/** A subscription in this state needs no cancellation call: it is
 * already terminal, or (`incomplete_expired`) never actually started. */
const TERMINAL_STATUSES = new Set<Stripe.Subscription.Status>([
  'canceled',
  'incomplete_expired',
])

/**
 * Cancels every one of the customer's subscriptions that is not already
 * terminal, paginating through the full list rather than trusting a
 * single page.
 */
async function cancelSubscriptions(
  stripe: Stripe,
  customer: string,
): Promise<void> {
  let startingAfter: string | undefined
  for (;;) {
    const page = await stripe.subscriptions.list({
      customer,
      status: 'all',
      starting_after: startingAfter,
    })
    for (const sub of page.data) {
      if (!TERMINAL_STATUSES.has(sub.status)) {
        await stripe.subscriptions.cancel(sub.id)
      }
    }
    if (!page.has_more || page.data.length === 0) {
      return
    }
    startingAfter = page.data[page.data.length - 1]?.id
  }
}

/**
 * Runs once, before a user row is actually deleted (Better Auth's
 * `beforeDelete` hook): re-anonymizes their boards so share links keep
 * working, revokes their API key, and cancels any live Stripe
 * subscription. Safe to run on a user with nothing to clean.
 *
 * The billing step is isolated in its own try/catch: a Stripe outage
 * must not throw out of this hook and block the rest of the account's
 * deletion, only fail to cancel the subscription (logged so it can be
 * followed up on).
 */
export function accountCleanup(
  db: Db,
  stripe: Stripe | null,
): (userId: string) => Promise<void> {
  return async (userId) => {
    await disownBoards(db, userId)
    await revokeApiKey(db, userId)
    if (!stripe) {
      return
    }
    try {
      const [row] = await db
        .select({ customer: user.stripeCustomerId })
        .from(user)
        .where(eq(user.id, userId))
      if (!row?.customer) {
        return
      }
      await cancelSubscriptions(stripe, row.customer)
    } catch (error) {
      log({
        event: 'account cleanup: billing step failed',
        userId,
        error: String(error),
      })
    }
  }
}
