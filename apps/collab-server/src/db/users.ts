import { eq } from 'drizzle-orm'
import type { Db } from './client'
import { user } from './schema'

export async function setPlan(
  db: Db,
  userId: string,
  plan: 'free' | 'pro',
): Promise<void> {
  await db.update(user).set({ plan }).where(eq(user.id, userId))
}

export async function setStripeCustomer(
  db: Db,
  userId: string,
  customerId: string,
): Promise<void> {
  await db
    .update(user)
    .set({ stripeCustomerId: customerId })
    .where(eq(user.id, userId))
}

export async function findUserByStripeCustomer(
  db: Db,
  customerId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.stripeCustomerId, customerId))
  return row
}
