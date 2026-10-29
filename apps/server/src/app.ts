import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { prisma } from './db';
import { env } from './env';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { csrfGuard, loadSession, requireAuth } from './lib/auth';
import { errorHandler } from './lib/http';
import { log } from './lib/log';
import { authRouter } from './routes/auth';
import { attachmentsRouter, expensesRouter, groupExpensesRouter } from './routes/expenses';
import { groupsRouter, invitationsRouter } from './routes/groups';
import { groupExportRouter, meRouter } from './routes/me';
import { dashboardRouter, groupActivityRouter, notificationsRouter, reportsRouter, searchRouter } from './routes/misc';
import { groupPlansRouter, groupPollsRouter, plansRouter } from './routes/plans';
import { groupBalancesRouter, groupSettlementsRouter, settlementsRouter } from './routes/settlements';
import { groupBudgetRouter } from './routes/budget';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // Privacy-aware access log: method, path (no query string), status and duration only.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => log.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
    next();
  });

  const api = express.Router();
  api.use(csrfGuard);
  api.use(loadSession);
  // Used by hosting health checks: reports unhealthy when the database is unreachable.
  api.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  api.use('/auth', authRouter);

  api.use(requireAuth);
  api.use('/me', meRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/groups', groupsRouter);
  api.use('/groups/:groupId/expenses', groupExpensesRouter);
  api.use('/groups/:groupId/balances', groupBalancesRouter);
  api.use('/groups/:groupId/settlements', groupSettlementsRouter);
  api.use('/groups/:groupId/budget', groupBudgetRouter);
  api.use('/groups/:groupId/plans', groupPlansRouter);
  api.use('/groups/:groupId/polls', groupPollsRouter);
  api.use('/groups/:groupId/activity', groupActivityRouter);
  api.use('/groups/:groupId/export', groupExportRouter);
  api.use('/invitations', invitationsRouter);
  api.use('/expenses', expensesRouter);
  api.use('/attachments', attachmentsRouter);
  api.use('/settlements', settlementsRouter);
  api.use('/plans', plansRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/search', searchRouter);
  api.use('/reports', reportsRouter);

  app.use('/api', api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } });
  });

  // Production: serve the built web app from the same origin (keeps cookies first-party and SameSite=Lax effective).
  if (env.webDist && fs.existsSync(path.join(env.webDist, 'index.html'))) {
    app.use(express.static(env.webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(env.webDist!, 'index.html'));
    });
  }
  app.use(errorHandler);
  return app;
}
