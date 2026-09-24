import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

export const boards = pgTable(
  'boards',
  {
    id: text('id').primaryKey(),
    editKeyHash: bytea('edit_key_hash').notNull(),
    viewKeyHash: bytea('view_key_hash').notNull(),
    snapshot: bytea('snapshot'),
    snapshotSeq: bigint('snapshot_seq', { mode: 'number' })
      .notNull()
      .default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ownerId: text('owner_id'),
    sharedAt: timestamp('shared_at', { withTimezone: true }),
    agentAt: timestamp('agent_at', { withTimezone: true }),
  },
  // `countOwnedBoards` and `listOwnedBoards` filter on this. The id is
  // opaque: whoever the extension's `identify` says a request is.
  (table) => [index('boards_owner_id_idx').on(table.ownerId)],
)

export const boardUpdates = pgTable(
  'board_updates',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    update: bytea('update').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.seq] })],
)

export const assets = pgTable(
  'assets',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    hash: text('hash').notNull(),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.hash] })],
)

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    plan: text('plan').notNull().default('free'),
    stripeCustomerId: text('stripe_customer_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // `findUserByStripeCustomer` filters on this for every billing webhook.
  (table) => [index('user_stripe_customer_id_idx').on(table.stripeCustomerId)],
)

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// Better Auth 1.7 identifies an external account by (issuer, accountId):
// the provider's trusted issuer, not the local provider id, which is only
// the configuration key.
export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('account_issuer_account_id_idx').on(
      table.issuer,
      table.accountId,
    ),
  ],
)

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    keyHash: bytea('key_hash').notNull(),
    name: text('name').notNull().default(''),
    /** Null means every board the user owns; otherwise the allowed ids. */
    boardIds: text('board_ids').array(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  // `resolveApiKey` filters on this for every keyed MCP call.
  (table) => [index('api_keys_key_hash_idx').on(table.keyHash)],
)

export const mcpUsage = pgTable(
  'mcp_usage',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.month] })],
)
