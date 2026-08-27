import { defineConfig } from '@playwright/test'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://tlwb:tlwb@localhost:5432/tlwb'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // The list reporter keeps console output readable; the HTML report is
  // what the CI job uploads on failure (apps/web/playwright-report), so
  // it must never try to open a browser on a headless runner.
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    // Kept only when a test actually fails, not on every run.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @tlwb/collab-server start',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      // A server that fails to boot on a runner has to say why.
      stdout: 'pipe',
      env: {
        DATABASE_URL: databaseUrl,
        CORS_ORIGIN: 'http://localhost:5173',
        PORT: '3000',
      },
    },
    {
      // The journeys run against the built application: a defect that
      // only shows up in the bundle Caddy serves is exactly what they
      // are here to catch.
      command: 'pnpm build && pnpm preview',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
  ],
})
