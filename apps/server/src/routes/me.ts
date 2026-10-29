import { Router } from 'express';
import { z } from 'zod';
import {
  changePasswordSchema,
  DEFAULT_PREFERENCES,
  getCurrency,
  minorToDecimalString,
  preferencesUpdateSchema,
  profileSchema,
  ROLE_LABELS,
  toCsv,
} from '@sharespace/core';
import { fromDateOnly, fromDateOnlyOrNull, prisma, toNum, toNumOrNull } from '../db';
import { requireGroup } from '../lib/access';
import { clearSessionCookie, currentUser, hashPassword, verifyPassword } from '../lib/auth';
import { getPreferences } from '../lib/events';
import { badRequest, notFound, param, parse, unauthorized } from '../lib/http';
import { removeFile } from '../lib/storage';
import { serializeUser } from './auth';
import { sendCsv, slug } from './expenses';

export const meRouter = Router();
export const groupExportRouter = Router({ mergeParams: true });

meRouter.patch('/profile', async (req, res) => {
  const user = currentUser(req);
  const input = parse(profileSchema, req.body);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { name: input.name, avatarColor: input.avatarColor } });
  res.json({ user: serializeUser(updated) });
});

meRouter.put('/password', async (req, res) => {
  const user = currentUser(req);
  const input = parse(changePasswordSchema, req.body);
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) throw badRequest('Your current password is incorrect.', { fields: { currentPassword: 'Incorrect password' } });
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } }),
    // Changing the password signs out every other session.
    prisma.userSession.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: req.sessionId } }, data: { revokedAt: new Date() } }),
  ]);
  res.json({ ok: true });
});

meRouter.get('/preferences', async (req, res) => {
  const user = currentUser(req);
  res.json({ preferences: await getPreferences(user.id) });
});

meRouter.patch('/preferences', async (req, res) => {
  const user = currentUser(req);
  const input = parse(preferencesUpdateSchema, req.body);
  const current = await getPreferences(user.id);
  const next = { ...DEFAULT_PREFERENCES, ...current, ...input, notifications: { ...current.notifications, ...(input.notifications ?? {}) } };
  await prisma.userPreference.upsert({ where: { userId: user.id }, create: { userId: user.id, data: next }, update: { data: next } });
  res.json({ preferences: next });
});

meRouter.get('/sessions', async (req, res) => {
  const user = currentUser(req);
  const sessions = await prisma.userSession.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
  });
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === req.sessionId,
    })),
  });
});

meRouter.post('/sessions/revoke-others', async (req, res) => {
  const user = currentUser(req);
  const { count } = await prisma.userSession.updateMany({
    where: { userId: user.id, revokedAt: null, id: { not: req.sessionId } },
    data: { revokedAt: new Date() },
  });
  res.json({ revoked: count });
});

meRouter.delete('/sessions/:sessionId', async (req, res) => {
  const user = currentUser(req);
  const { count } = await prisma.userSession.updateMany({
    where: { id: param(req, 'sessionId'), userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw notFound('Session not found');
  if (param(req, 'sessionId') === req.sessionId) clearSessionCookie(res);
  res.json({ ok: true });
});

/** Personal data export (JSON): profile, preferences, memberships and every record that involves the user. */
meRouter.get('/export', async (req, res) => {
  const user = currentUser(req);
  const memberships = await prisma.groupMember.findMany({ where: { userId: user.id }, include: { group: true } });
  const memberIds = memberships.map((m) => m.id);
  const [payers, splits, settlements, comments, notifications] = await Promise.all([
    prisma.expensePayer.findMany({ where: { memberId: { in: memberIds } }, include: { expense: true } }),
    prisma.expenseSplit.findMany({ where: { memberId: { in: memberIds } }, include: { expense: true } }),
    prisma.settlement.findMany({ where: { OR: [{ fromMemberId: { in: memberIds } }, { toMemberId: { in: memberIds } }] } }),
    prisma.comment.findMany({ where: { authorId: user.id, deletedAt: null } }),
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 500 }),
  ]);
  const exp = (e: { id: string; groupId: string; title: string; date: Date; currency: string; amountMinor: bigint; deletedAt: Date | null }) => ({
    expenseId: e.id,
    groupId: e.groupId,
    title: e.title,
    date: fromDateOnly(e.date),
    currency: e.currency,
    expenseAmountMinor: toNum(e.amountMinor),
    deleted: !!e.deletedAt,
  });
  const body = {
    exportedAt: new Date().toISOString(),
    note: 'Amounts are integer minor units (e.g. paise for INR).',
    profile: serializeUser(user),
    preferences: await getPreferences(user.id),
    memberships: memberships.map((m) => ({
      groupId: m.groupId,
      groupName: m.group.name,
      currency: m.group.currency,
      memberId: m.id,
      displayName: m.displayName,
      role: ROLE_LABELS[m.role],
      status: m.status,
      joinedAt: m.joinedAt.toISOString(),
    })),
    payments: payers.map((p) => ({ ...exp(p.expense), paidMinor: toNum(p.amountMinor) })),
    shares: splits.map((s) => ({ ...exp(s.expense), shareMinor: toNum(s.amountMinor) })),
    settlements: settlements.map((s) => ({
      id: s.id,
      groupId: s.groupId,
      fromMemberId: s.fromMemberId,
      toMemberId: s.toMemberId,
      amountMinor: toNum(s.amountMinor),
      currency: s.currency,
      method: s.method,
      date: fromDateOnly(s.date),
      status: s.status,
    })),
    comments: comments.map((c) => ({ id: c.id, expenseId: c.expenseId, body: c.body, createdAt: c.createdAt.toISOString() })),
    notifications: notifications.map((n) => ({ title: n.title, body: n.body, createdAt: n.createdAt.toISOString(), read: !!n.readAt })),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="sharespace-personal-data.json"');
  res.setHeader('Cache-Control', 'no-store');
  res.json(body);
});

/**
 * Account deletion. Shared financial history is preserved for the other members: the user's member
 * records stay (under their display name) but are detached from the account. Groups where the user
 * is the only account holder are deleted with all their data. Ownership of other groups moves to
 * the next admin or longest-standing member.
 */
meRouter.delete('/', async (req, res) => {
  const user = currentUser(req);
  const { password } = parse(z.object({ password: z.string().min(1).max(128) }), req.body);
  if (!(await verifyPassword(password, user.passwordHash))) throw unauthorized('Incorrect password');
  const owned = await prisma.group.findMany({ where: { ownerId: user.id }, select: { id: true } });
  const removedFiles: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const { id } of owned) {
      const successor = await tx.groupMember.findFirst({
        where: { groupId: id, status: 'ACTIVE', userId: { not: null, notIn: [user.id] } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      });
      if (successor) {
        await tx.groupMember.update({ where: { id: successor.id }, data: { role: 'OWNER' } });
        await tx.group.update({ where: { id }, data: { ownerId: successor.userId! } });
      } else {
        const files = await tx.attachment.findMany({ where: { groupId: id }, select: { storageKey: true } });
        removedFiles.push(...files.map((f) => f.storageKey));
        await tx.group.delete({ where: { id } });
      }
    }
    await tx.groupMember.updateMany({ where: { userId: user.id, status: 'ACTIVE' }, data: { status: 'LEFT', leftAt: new Date() } });
    await tx.user.delete({ where: { id: user.id } });
  });
  await Promise.all(removedFiles.map((k) => removeFile(k).catch(() => undefined)));
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Group exports ----------

groupExportRouter.get('/members.csv', async (req, res) => {
  const { group } = await requireGroup(req);
  const members = await prisma.groupMember.findMany({ where: { groupId: group.id }, orderBy: { joinedAt: 'asc' } });
  const csv = toCsv(
    ['Name', 'Email', 'Role', 'Status', 'Has account', 'Joined'],
    members.map((m) => [m.displayName, m.email ?? '', ROLE_LABELS[m.role], m.status, m.userId ? 'Yes' : 'No', m.joinedAt.toISOString().slice(0, 10)]),
  );
  sendCsv(res, `${slug(group.name)}-members.csv`, csv);
});

/** Complete JSON backup of one group (amounts are integer minor units). */
groupExportRouter.get('/backup.json', async (req, res) => {
  const { group } = await requireGroup(req);
  const full = await prisma.group.findUniqueOrThrow({
    where: { id: group.id },
    include: {
      members: true,
      categories: true,
      expenses: { include: { payers: true, splits: true, items: { include: { participants: true } } } },
      settlements: true,
      budget: { include: { categories: true } },
      plans: { include: { participants: true, itinerary: true, checklist: true } },
      polls: { include: { options: true, votes: true } },
    },
  });
  const dec = getCurrency(full.currency).decimals;
  const body = {
    format: 'sharespace-group-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    group: { id: full.id, name: full.name, description: full.description, type: full.type, currency: full.currency, currencyDecimals: dec, createdAt: full.createdAt.toISOString(), archivedAt: full.archivedAt?.toISOString() ?? null },
    members: full.members.map((m) => ({ id: m.id, displayName: m.displayName, email: m.email, role: m.role, status: m.status, hasAccount: !!m.userId })),
    categories: full.categories.map((c) => ({ id: c.id, label: c.label })),
    expenses: full.expenses.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      notes: e.notes,
      date: fromDateOnly(e.date),
      category: e.category,
      amountMinor: toNum(e.amountMinor),
      currency: e.currency,
      originalAmountMinor: toNum(e.originalAmountMinor),
      originalCurrency: e.originalCurrency,
      fxRate: e.fxRate,
      splitMethod: e.splitMethod,
      planId: e.planId,
      deleted: !!e.deletedAt,
      payers: e.payers.map((p) => ({ memberId: p.memberId, amountMinor: toNum(p.amountMinor) })),
      shares: e.splits.map((s) => ({ memberId: s.memberId, amountMinor: toNum(s.amountMinor), inputValue: toNumOrNull(s.inputValue) })),
      items: e.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceMinor: toNum(i.unitPriceMinor), memberIds: i.participants.map((p) => p.memberId) })),
      adjustments: { taxMinor: toNum(e.taxMinor), serviceMinor: toNum(e.serviceMinor), discountMinor: toNum(e.discountMinor) },
    })),
    settlements: full.settlements.map((s) => ({
      id: s.id,
      fromMemberId: s.fromMemberId,
      toMemberId: s.toMemberId,
      amountMinor: toNum(s.amountMinor),
      method: s.method,
      date: fromDateOnly(s.date),
      status: s.status,
      notes: s.notes,
      reversalReason: s.reversalReason,
    })),
    budget: full.budget
      ? {
          totalMinor: toNum(full.budget.totalMinor),
          startDate: fromDateOnlyOrNull(full.budget.startDate),
          endDate: fromDateOnlyOrNull(full.budget.endDate),
          warningThresholdPct: full.budget.warningThresholdPct,
          categories: full.budget.categories.map((c) => ({ category: c.category, amountMinor: toNum(c.amountMinor) })),
        }
      : null,
    plans: full.plans.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      status: p.status,
      startDate: fromDateOnly(p.startDate),
      endDate: fromDateOnlyOrNull(p.endDate),
      location: p.location,
      estimatedBudgetMinor: toNumOrNull(p.estimatedBudgetMinor),
      participantIds: p.participants.map((x) => x.memberId),
      itinerary: p.itinerary.sort((a, b) => a.position - b.position).map((i) => ({ title: i.title, date: fromDateOnlyOrNull(i.date), startTime: i.startTime, endTime: i.endTime, location: i.location })),
      checklist: p.checklist.sort((a, b) => a.position - b.position).map((c) => ({ title: c.title, completed: !!c.completedAt, dueDate: fromDateOnlyOrNull(c.dueDate) })),
    })),
    polls: full.polls.map((p) => ({ question: p.question, closedAt: p.closedAt?.toISOString() ?? null, options: p.options.map((o) => ({ label: o.label, votes: p.votes.filter((v) => v.optionId === o.id).length })) })),
  };
  res.setHeader('Content-Disposition', `attachment; filename="${slug(full.name)}-backup.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.json(body);
});


