import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://sharespace:sharespace@localhost:5433/sharespace_test?schema=public',
      STORAGE_DIR: './storage-test',
      AUTH_RATE_LIMIT: '1000',
      APP_URL: 'http://localhost:5180',
    },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
