import path from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}. Copy apps/server/.env.example to apps/server/.env.`);
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

/** Public URL of the web app. Render sets RENDER_EXTERNAL_URL automatically; other hosts must set APP_URL. */
function appUrl(): string {
  const value = process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (!value && nodeEnv === 'production') throw new Error('Missing required environment variable APP_URL (the public https URL of the app).');
  return (value ?? 'http://localhost:5180').replace(/\/$/, '');
}

/** Express 'trust proxy' setting: a hop count ("1" behind one load balancer) or a subnet list such as "loopback". */
function trustProxy(): number | string {
  const value = process.env.TRUST_PROXY ?? 'loopback';
  return /^\d+$/.test(value) ? Number(value) : value;
}

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT ?? 4100),
  databaseUrl: required('DATABASE_URL'),
  appUrl: appUrl(),
  storageDir: path.resolve(process.env.STORAGE_DIR ?? './storage'),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  /** Optional path to the built web app (apps/web/dist) to serve from the API in production. */
  webDist: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : null,
  /** Max auth attempts per IP per 15 minutes. */
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT ?? 30),
  /** Needed behind a hosting load balancer so rate limiting sees the real client IP. */
  trustProxy: trustProxy(),
};
