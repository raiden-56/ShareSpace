import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { unauthorized } from './http';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'ss_session';

/** Hash format: scrypt$N$r$p$salt$hash (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** A dummy hash so login timing does not reveal whether an email is registered. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('not-a-real-password-0');
  return dummyHash;
}

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: env.sessionTtlDays * 24 * 60 * 60 * 1000,
  };
}

export async function createSession(res: Response, userId: string, userAgent: string | undefined): Promise<void> {
  const token = randomToken();
  await prisma.userSession.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent: userAgent?.slice(0, 200) ?? null,
      expiresAt: new Date(Date.now() + env.sessionTtlDays * 86_400_000),
    },
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _maxAge, ...opts } = cookieOptions();
  res.clearCookie(SESSION_COOKIE, opts);
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    sessionId?: string;
  }
}

/** Loads the user from the session cookie when present. Does not reject anonymous requests. */
export async function loadSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return next();
  const session = await prisma.userSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return next();
  req.user = session.user;
  req.sessionId = session.id;
  // Touch at most once a minute to avoid a write per request.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

export function currentUser(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must carry a custom
 * header (which cross-site forms cannot send without a CORS preflight we never allow) and, when
 * the browser sends an Origin header, it must match the app origin.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'ShareSpace') {
    res.status(403).json({ error: { message: 'Request blocked by CSRF protection', code: 'CSRF' } });
    return;
  }
  const origin = req.get('origin');
  const devOrigin = !env.isProduction && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin ?? '');
  if (origin && origin !== env.appUrl && !devOrigin) {
    res.status(403).json({ error: { message: 'Request blocked by CSRF protection', code: 'CSRF' } });
    return;
  }
  next();
}
