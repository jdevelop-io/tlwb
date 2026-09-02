import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { disownBoards } from '../db/boards'
import type { Db } from '../db/client'
import { user } from '../db/schema'
import { revokeApiKey } from './api-keys'

/**
 * Runs once, before a user row is actually deleted (Better Auth's
 * `beforeDelete` hook): re-anonymizes their boards so share links keep
 * working, revokes their API key, and cancels any active Stripe
 * subscription. Safe to run on a user with nothing to clean.
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
    const [row] = await db
      .select({ customer: user.stripeCustomerId })
      .from(user)
      .where(eq(user.id, userId))
    if (!row?.customer) {
      return
    }
    const subs = await stripe.subscriptions.list({
      customer: row.customer,
      status: 'active',
    })
    for (const sub of subs.data) {
      await stripe.subscriptions.cancel(sub.id)
    }
  }
}
