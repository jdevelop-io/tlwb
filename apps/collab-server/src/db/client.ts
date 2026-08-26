import { fileURLToPath } from 'node:url'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = PostgresJsDatabase<typeof schema>

export interface Database {
  db: Db
  close(): Promise<void>
}

/** Connects and applies pending migrations; the image is the deployment. */
export async function connectDatabase(url: string): Promise<Database> {
  const sql = postgres(url)
  const db = drizzle(sql, { schema })
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  })
  return {
    db,
    close: async () => {
      await sql.end()
    },
  }
}
