import path from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}. Copy apps/server/.env.example to apps/server/.env.`);
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT ?? 4100),
  databaseUrl: required('DATABASE_URL'),
  appUrl: (process.env.APP_URL ?? 'http://localhost:5180').replace(/\/$/, ''),
  storageDir: path.resolve(process.env.STORAGE_DIR ?? './storage'),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  /** Optional path to the built web app (apps/web/dist) to serve from the API in production. */
  webDist: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : null,
  /** Max auth attempts per IP per 15 minutes. */
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT ?? 30),
};
