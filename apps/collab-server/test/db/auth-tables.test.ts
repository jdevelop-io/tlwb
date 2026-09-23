import { getAuthTables } from 'better-auth/db'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { additionalUserFields } from '../../src/accounts/auth'
import { account, session, user, verification } from '../../src/db/schema'

/**
 * Better Auth writes through the Drizzle adapter by property name, so
 * a field it expects and the schema lacks only surfaces at runtime, on
 * the first real sign-in. Pin the two together here instead.
 */
describe('Better Auth tables', () => {
  const tables = getAuthTables({
    user: { additionalFields: additionalUserFields },
  })
  const drizzleTables = { user, session, account, verification }

  it.each(Object.entries(tables))(
    'declares every field of %s',
    (_model, table) => {
      const drizzleTable =
        drizzleTables[table.modelName as keyof typeof drizzleTables]
      const columns = Object.keys(getTableColumns(drizzleTable))
      const missing = Object.entries(table.fields)
        .map(([name, field]) => field.fieldName ?? name)
        .filter((field) => !columns.includes(field))
      expect(missing).toEqual([])
    },
  )

  it('scopes account identity by issuer and account id', () => {
    const { indexes } = getTableConfig(account)
    const unique = indexes.filter((index) => index.config.unique)
    const columns = unique.map((index) =>
      index.config.columns.map((column) => 'name' in column && column.name),
    )
    expect(columns).toContainEqual(['issuer', 'account_id'])
  })
})
