import { execSync } from 'node:child_process';

/** Applies pending migrations (non-destructive) to the dedicated test database. Tests use unique emails per run, so no data is ever wiped. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://sharespace:sharespace@localhost:5433/sharespace_test?schema=public';
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
