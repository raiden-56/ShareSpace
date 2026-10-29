import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from '@sharespace/core';
import { prisma } from '../db';
import { env } from '../env';
import {
  clearSessionCookie,
  createSession,
  getDummyHash,
  hashPassword,
  randomToken,
  sha256,
  SESSION_COOKIE,
  verifyPassword,
} from '../lib/auth';
import { badRequest, conflict, parse, unauthorized } from '../lib/http';
import { log } from '../lib/log';
import { getPreferences } from '../lib/events';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.authRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Please wait a few minutes and try again.', code: 'RATE_LIMITED' } },
});

export function serializeUser(user: { id: string; email: string; name: string; avatarColor: string; createdAt: Date }) {
  return { id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor, createdAt: user.createdAt.toISOString() };
}

authRouter.post('/register', authLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict('An account with this email already exists. Try signing in instead.', 'EMAIL_TAKEN');
  const user = await prisma.user.create({
    data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) },
  });
  await createSession(res, user.id, req.get('user-agent'));
  res.status(201).json({ user: serializeUser(user), preferences: await getPreferences(user.id) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Always run a hash comparison so response time does not reveal whether the email exists.
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) throw unauthorized('Incorrect email or password');
  await createSession(res, user.id, req.get('user-agent'));
  res.json({ user: serializeUser(user), preferences: await getPreferences(user.id) });
});

authRouter.post('/logout', async (req, res) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string') {
    await prisma.userSession.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  if (!req.user) {
    res.json({ user: null, preferences: null });
    return;
  }
  res.json({ user: serializeUser(req.user), preferences: await getPreferences(req.user.id) });
});

/**
 * Password reset request. Email delivery is not configured in this build, so the response never
 * claims an email was sent. In development the reset link is written to the server console.
 */
authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = parse(forgotPasswordSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = randomToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    if (!env.isProduction) log.info(`Password reset link (development only): ${env.appUrl}/reset-password?token=${token}`);
  }
  res.json({ ok: true, emailDelivery: false });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = parse(resetPasswordSchema, req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw badRequest('This reset link is invalid or has expired. Request a new one.');
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(password) } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Resetting a password signs out every existing session.
    prisma.userSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  res.json({ ok: true });
});
