import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // One shared database and a migrator that is not concurrency-safe:
    // files run one after the other.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb',
    },
  },
})
