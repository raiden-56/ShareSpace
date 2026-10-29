import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against their own API (port 4110, test database) and web server (port 5190),
 * so they never touch development data. Each run registers users with unique emails.
 *
 * Browser: set PW_CHANNEL=chrome (default) or msedge to use an installed browser, or PW_CHANNEL=bundled
 * to use Playwright's downloaded Chromium (`npx playwright install chromium`).
 */
const channel = process.env.PW_CHANNEL ?? 'chrome';
const testDb = process.env.TEST_DATABASE_URL ?? 'postgresql://sharespace:sharespace@localhost:5433/sharespace_test?schema=public';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5190',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(channel === 'bundled' ? {} : { channel }),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...(channel === 'bundled' ? {} : { channel }), viewport: { width: 1280, height: 860 } } },
  ],
  webServer: [
    {
      command: 'npx prisma migrate deploy && npx tsx src/index.ts',
      cwd: './apps/server',
      url: 'http://localhost:4110/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: testDb,
        PORT: '4110',
        APP_URL: 'http://localhost:5190',
        NODE_ENV: 'test',
        AUTH_RATE_LIMIT: '1000',
        STORAGE_DIR: './storage-e2e',
      },
    },
    {
      command: 'npx vite --port 5190 --strictPort',
      cwd: './apps/web',
      url: 'http://localhost:5190',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_URL: 'http://localhost:4110' },
    },
  ],
});
