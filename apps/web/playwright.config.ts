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
  // The chrome is absolutely positioned around the canvas, so what
  // overlaps what depends on the viewport. The narrow one is the
  // smallest the application is meant for.
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'narrow', use: { viewport: { width: 1024, height: 768 } } },
  ],
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
        // Accounts, seeded and OAuth-free: the e2e suite signs sessions
        // in directly (see e2e/session-helper.ts) rather than driving a
        // real OAuth redirect. The cap is set low so the free-tier
        // journey can actually hit it within one short test.
        AUTH_SECRET: 'e2e-secret-at-least-32-characters!!!',
        GITHUB_CLIENT_ID: 'e2e',
        GITHUB_CLIENT_SECRET: 'e2e',
        FREE_BOARD_CAP: '2',
        // The default (10/min) is an anti-abuse budget sized for a real
        // client, not for several suites hosting boards concurrently
        // from the same loopback address across parallel workers; left
        // at the default, unrelated tests throttle each other into
        // spurious failures that have nothing to do with the behaviour
        // under test.
        CREATE_LIMIT_PER_MIN: '100',
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
