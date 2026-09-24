import {
  bigint,
  bigserial,
  customType,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
