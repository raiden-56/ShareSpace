import { Router } from 'express';
import { z } from 'zod';
import {
  categoryLabel,
  formatMoney,
  inDateRange,
  isoDateSchema,
  pickGranularity,
  spendingByCategory,
  spendingOverTime,
  toCsv,
  minorToDecimalString,
  getCurrency,
  type ReportExpense,
} from '@sharespace/core';
import { fromDateOnly, prisma, toDateOnly, todayIso, toNum, toNumOrNull } from '../db';
import { accessibleGroupIds, requireGroup } from '../lib/access';
import { currentUser } from '../lib/auth';
import { notifyUser } from '../lib/events';
import { notFound, param, parse } from '../lib/http';
import { loadGroupLedger } from '../lib/ledger';
import { expenseListInclude, serializeExpenseSummary } from '../lib/serialize';
import { groupCard } from './groups';
import { finalizeExpiredPolls, serializeActivity } from './plans';
import { sendCsv } from './expenses';

export const notificationsRouter = Router();
export const groupActivityRouter = Router({ mergeParams: true });
export const searchRouter = Router();
export const reportsRouter = Router();
export const dashboardRouter = Router();

// ---------- Reminders ----------

/**
 * Creates due reminders (plans starting within 3 days, polls closing within 24 hours) for a user.
 * Runs when the user loads notifications or the dashboard; the dedupe key makes it idempotent.
 */
async function generateReminders(userId: string) {
  const groupIds = await accessibleGroupIds(userId);
  if (groupIds.length === 0) return;
  const today = todayIso();
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const plans = await prisma.plan.findMany({
    where: {
      groupId: { in: groupIds },
      archivedAt: null,
      status: { in: ['IDEA', 'PLANNING', 'CONFIRMED'] },
      startDate: { gte: toDateOnly(today), lte: toDateOnly(soon) },
    },
    include: { group: { select: { name: true } } },
  });
  for (const p of plans) {
    const start = fromDateOnly(p.startDate);
    await notifyUser(prisma, userId, {
      groupId: p.groupId,
      type: 'PLAN_UPCOMING',
      title: start === today ? 'Plan starts today' : 'Upcoming plan',
      body: `${p.title} (${p.group.name}) starts on ${start}${p.location ? ` · ${p.location}` : ''}`,
      link: `/groups/${p.groupId}/plans/${p.id}`,
      dedupeKey: `plan-upcoming:${p.id}:${start}`,
    });
  }
  for (const groupId of groupIds) await finalizeExpiredPolls(groupId);
  const members = await prisma.groupMember.findMany({ where: { userId, status: 'ACTIVE', groupId: { in: groupIds } }, select: { id: true, groupId: true } });
  const polls = await prisma.poll.findMany({
    where: { groupId: { in: groupIds }, closedAt: null, closesAt: { gt: new Date(), lte: new Date(Date.now() + 86_400_000) } },
    include: { votes: { select: { memberId: true } }, eligible: { select: { memberId: true } } },
  });
  for (const poll of polls) {
    const me = members.find((m) => m.groupId === poll.groupId);
    if (!me) continue;
    const eligibleIds = poll.eligible.map((e) => e.memberId);
    if (eligibleIds.length && !eligibleIds.includes(me.id)) continue;
    if (poll.votes.some((v) => v.memberId === me.id)) continue;
    await notifyUser(prisma, userId, {
      groupId: poll.groupId,
      type: 'POLL_DEADLINE',
      title: 'Poll closing soon',
      body: `"${poll.question}" closes within 24 hours and you have not voted yet`,
      link: poll.planId ? `/groups/${poll.groupId}/plans/${poll.planId}` : `/groups/${poll.groupId}/plans?tab=decisions`,
      dedupeKey: `poll-deadline:${poll.id}`,
    });
  }
}

// ---------- Notifications ----------

notificationsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  await generateReminders(user.id);
  const unreadOnly = req.query.unread === 'true';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  res.json({
    unreadCount,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      groupId: n.groupId,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

notificationsRouter.get('/unread-count', async (req, res) => {
  const user = currentUser(req);
  res.json({ unreadCount: await prisma.notification.count({ where: { userId: user.id, readAt: null } }) });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const user = currentUser(req);
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post('/:id/:state', async (req, res) => {
  const user = currentUser(req);
  const state = param(req, 'state');
  if (state !== 'read' && state !== 'unread') throw notFound();
  const { count } = await prisma.notification.updateMany({
    where: { id: param(req, 'id'), userId: user.id },
    data: { readAt: state === 'read' ? new Date() : null },
  });
  if (count === 0) throw notFound('Notification not found');
  res.json({ ok: true });
});

// ---------- Activity ----------

groupActivityRouter.get('/', async (req, res) => {
  const { group } = await requireGroup(req);
  const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
  const planId = typeof req.query.planId === 'string' ? req.query.planId : undefined;
  const items = await prisma.activityLog.findMany({
    where: {
      groupId: group.id,
      ...(planId ? { planId } : {}),
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 31,
  });
  res.json({ items: items.slice(0, 30).map(serializeActivity), hasMore: items.length > 30 });
});

// ---------- Search ----------

searchRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const empty = { groups: [], members: [], expenses: [], settlements: [], plans: [], polls: [] };
  if (q.length < 2) {
    res.json({ query: q, results: empty });
    return;
  }
  // Every query below is scoped to groups the caller is an active member of.
  const groupIds = await accessibleGroupIds(user.id, { includeArchived: true });
  const contains = { contains: q, mode: 'insensitive' as const };
  const [groups, members, expenses, plans, polls] = await Promise.all([
    prisma.group.findMany({ where: { id: { in: groupIds }, OR: [{ name: contains }, { description: contains }] }, take: 6 }),
    prisma.groupMember.findMany({
      where: { groupId: { in: groupIds }, status: 'ACTIVE', OR: [{ displayName: contains }, { email: contains }] },
      include: { group: { select: { name: true } } },
      take: 8,
    }),
    prisma.expense.findMany({
      where: { groupId: { in: groupIds }, deletedAt: null, OR: [{ title: contains }, { notes: contains }, { description: contains }] },
      include: { group: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 8,
    }),
    prisma.plan.findMany({
      where: { groupId: { in: groupIds }, archivedAt: null, OR: [{ title: contains }, { location: contains }, { description: contains }] },
      include: { group: { select: { name: true } } },
      take: 6,
    }),
    prisma.poll.findMany({ where: { groupId: { in: groupIds }, question: contains }, include: { group: { select: { name: true } } }, take: 6 }),
  ]);
  const matchedMemberIds = members.map((m) => m.id);
  const settlements = await prisma.settlement.findMany({
    where: {
      groupId: { in: groupIds },
      OR: [{ notes: contains }, { methodNote: contains }, { fromMemberId: { in: matchedMemberIds } }, { toMemberId: { in: matchedMemberIds } }],
    },
    include: { fromMember: true, toMember: true, group: { select: { name: true } } },
    orderBy: { date: 'desc' },
    take: 6,
  });
  res.json({
    query: q,
    results: {
      groups: groups.map((g) => ({ id: g.id, title: g.name, subtitle: g.archivedAt ? 'Archived group' : 'Group', link: `/groups/${g.id}` })),
      members: members.map((m) => ({ id: m.id, title: m.displayName, subtitle: m.group.name, link: `/groups/${m.groupId}/members` })),
      expenses: expenses.map((e) => ({
        id: e.id,
        title: e.title,
        subtitle: `${e.group.name} · ${formatMoney(toNum(e.amountMinor), e.currency)} · ${fromDateOnly(e.date)}`,
        link: `/groups/${e.groupId}/expenses/${e.id}`,
      })),
      settlements: settlements.map((s) => ({
        id: s.id,
        title: `${s.fromMember.displayName} → ${s.toMember.displayName}`,
        subtitle: `${s.group.name} · ${formatMoney(toNum(s.amountMinor), s.currency)}${s.status === 'REVERSED' ? ' · reversed' : ''}`,
        link: `/groups/${s.groupId}/balances`,
      })),
      plans: plans.map((p) => ({ id: p.id, title: p.title, subtitle: `${p.group.name} · ${fromDateOnly(p.startDate)}`, link: `/groups/${p.groupId}/plans/${p.id}` })),
      polls: polls.map((p) => ({
        id: p.id,
        title: p.question,
        subtitle: `${p.group.name}${p.closedAt ? ' · closed' : ''}`,
        link: p.planId ? `/groups/${p.groupId}/plans/${p.planId}` : `/groups/${p.groupId}/plans?tab=decisions`,
      })),
    },
  });
});

// ---------- Reports ----------

const reportQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  groupId: z.string().max(64).optional(),
  currency: z.string().max(3).optional(),
});

async function buildReport(userId: string, query: unknown) {
  const q = parse(reportQuerySchema, query);
  const allowed = await accessibleGroupIds(userId, { includeArchived: true });
  if (q.groupId && !allowed.includes(q.groupId)) throw notFound('Group not found');
  const scopeIds = q.groupId ? [q.groupId] : allowed;
  const groups = await prisma.group.findMany({
    where: { id: { in: scopeIds } },
    include: { budget: true, categories: true, members: { select: { id: true, displayName: true, userId: true } } },
  });
  // Amounts in different currencies are never added together: a report covers one currency.
  const currencies = [...new Set(groups.map((g) => g.currency))].sort();
  const currency = q.currency && currencies.includes(q.currency) ? q.currency : (groups[0]?.currency ?? 'INR');
  const inCurrency = groups.filter((g) => g.currency === currency);
  const ids = inCurrency.map((g) => g.id);

  const to = q.to ?? todayIso();
  const from = q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  const expenses = await prisma.expense.findMany({
    where: { groupId: { in: ids }, deletedAt: null, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
    include: { ...expenseListInclude, plan: { select: { id: true, title: true, estimatedBudgetMinor: true } } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  const rows: ReportExpense[] = expenses.map((e) => ({
    id: e.id,
    groupId: e.groupId,
    date: fromDateOnly(e.date),
    category: e.category,
    amountMinor: toNum(e.amountMinor),
    planId: e.planId,
    payers: e.payers.map((p) => ({ memberId: p.memberId, amountMinor: toNum(p.amountMinor) })),
    shares: e.splits.map((s) => ({ memberId: s.memberId, amountMinor: toNum(s.amountMinor) })),
  }));
  const myMemberIds = new Set(inCurrency.flatMap((g) => g.members.filter((m) => m.userId === userId).map((m) => m.id)));
  const memberName = new Map(inCurrency.flatMap((g) => g.members.map((m) => [m.id, { name: m.displayName, userId: m.userId, groupName: g.name }] as const)));
  const customCategories = inCurrency.flatMap((g) => g.categories.map((c) => ({ id: c.id, label: c.label })));

  // Per person: members with accounts are merged across groups; placeholders stay per group.
  const people = new Map<string, { key: string; name: string; paidMinor: number; shareMinor: number; isYou: boolean }>();
  for (const r of rows) {
    const add = (memberId: string, field: 'paidMinor' | 'shareMinor', amount: number) => {
      const info = memberName.get(memberId);
      const key = info?.userId ?? memberId;
      const entry = people.get(key) ?? { key, name: info?.name ?? 'Former member', paidMinor: 0, shareMinor: 0, isYou: info?.userId === userId };
      entry[field] += amount;
      people.set(key, entry);
    };
    r.payers.forEach((p) => add(p.memberId, 'paidMinor', p.amountMinor));
    r.shares.forEach((s) => add(s.memberId, 'shareMinor', s.amountMinor));
  }

  const settlements = await prisma.settlement.findMany({
    where: { groupId: { in: ids }, status: 'RECORDED', date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
    select: { amountMinor: true },
  });

  const planMap = new Map<string, { planId: string; title: string; groupId: string; estimatedMinor: number | null; actualMinor: number; count: number }>();
  for (const e of expenses) {
    if (!e.plan) continue;
    const entry = planMap.get(e.plan.id) ?? { planId: e.plan.id, title: e.plan.title, groupId: e.groupId, estimatedMinor: toNumOrNull(e.plan.estimatedBudgetMinor), actualMinor: 0, count: 0 };
    entry.actualMinor += toNum(e.amountMinor);
    entry.count += 1;
    planMap.set(e.plan.id, entry);
  }

  const budgetVsActual = await Promise.all(
    inCurrency
      .filter((g) => g.budget)
      .map(async (g) => {
        const b = g.budget!;
        const bFrom = b.startDate ? fromDateOnly(b.startDate) : null;
        const bTo = b.endDate ? fromDateOnly(b.endDate) : null;
        const all = await prisma.expense.findMany({ where: { groupId: g.id, deletedAt: null }, select: { amountMinor: true, date: true } });
        const spent = all.filter((e) => inDateRange(fromDateOnly(e.date), bFrom, bTo)).reduce((a, e) => a + toNum(e.amountMinor), 0);
        return { groupId: g.id, groupName: g.name, budgetMinor: toNum(b.totalMinor), spentMinor: spent, startDate: bFrom, endDate: bTo };
      }),
  );

  const granularity = from <= to ? pickGranularity(from, to) : 'day';
  return {
    currency,
    currencies,
    from,
    to,
    granularity,
    groupId: q.groupId ?? null,
    groups: inCurrency.map((g) => ({ id: g.id, name: g.name, accent: g.accent })),
    excludedGroups: groups.filter((g) => g.currency !== currency).map((g) => ({ id: g.id, name: g.name, currency: g.currency })),
    totals: {
      spendingMinor: rows.reduce((a, r) => a + r.amountMinor, 0),
      expenseCount: rows.length,
      myShareMinor: rows.reduce((a, r) => a + r.shares.filter((s) => myMemberIds.has(s.memberId)).reduce((x, s) => x + s.amountMinor, 0), 0),
      myPaidMinor: rows.reduce((a, r) => a + r.payers.filter((p) => myMemberIds.has(p.memberId)).reduce((x, p) => x + p.amountMinor, 0), 0),
      settlementsMinor: settlements.reduce((a, s) => a + toNum(s.amountMinor), 0),
    },
    byCategory: spendingByCategory(rows).map((b) => ({ ...b, label: categoryLabel(b.key, customCategories) })),
    byGroup: inCurrency
      .map((g) => {
        const own = rows.filter((r) => r.groupId === g.id);
        return { groupId: g.id, name: g.name, accent: g.accent, amountMinor: own.reduce((a, r) => a + r.amountMinor, 0), count: own.length };
      })
      .sort((a, b) => b.amountMinor - a.amountMinor),
    byMember: [...people.values()].sort((a, b) => b.shareMinor - a.shareMinor),
    overTime: from <= to ? spendingOverTime(rows, granularity, from, to) : [],
    byPlan: [...planMap.values()].sort((a, b) => b.actualMinor - a.actualMinor),
    budgetVsActual,
    expenses: expenses.slice(0, 100).map(serializeExpenseSummary),
    expensesTruncated: expenses.length > 100,
  };
}

reportsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  res.json(await buildReport(user.id, req.query));
});

reportsRouter.get('/export.csv', async (req, res) => {
  const user = currentUser(req);
  const r = await buildReport(user.id, req.query);
  const dec = getCurrency(r.currency).decimals;
  const amt = (m: number) => minorToDecimalString(m, dec);
  const rows: (string | number)[][] = [
    ...r.byCategory.map((b) => ['Category', b.label, amt(b.amountMinor), b.count]),
    ...r.byGroup.map((b) => ['Group', b.name, amt(b.amountMinor), b.count]),
    ...r.byMember.map((b) => ['Person (share)', b.name, amt(b.shareMinor), '']),
    ...r.byMember.map((b) => ['Person (paid)', b.name, amt(b.paidMinor), '']),
    ...r.overTime.map((b) => [`Period (${r.granularity})`, b.key, amt(b.amountMinor), b.count]),
    ...r.byPlan.map((b) => ['Plan', b.title, amt(b.actualMinor), b.count]),
    ...r.budgetVsActual.map((b) => ['Budget used', b.groupName, amt(b.spentMinor), `of ${amt(b.budgetMinor)}`]),
  ];
  sendCsv(res, `sharespace-report-${r.from}-to-${r.to}.csv`, toCsv(['Section', 'Label', `Amount (${r.currency})`, 'Count'], rows));
});

// ---------- Dashboard ----------

dashboardRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  await generateReminders(user.id);
  const groupIds = await accessibleGroupIds(user.id);
  const cards = await Promise.all(groupIds.map((id) => groupCard(id, user.id)));
  cards.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Outstanding balances, paid totals and group spending are separate metrics, kept per currency.
  const byCurrency = new Map<string, { currency: string; oweMinor: number; owedMinor: number; paidMinor: number; groupSpendingMinor: number }>();
  const reminders: { groupId: string; groupName: string; currency: string; fromMemberId: string; toMemberId: string; amountMinor: number; direction: 'pay' | 'receive' }[] = [];
  const memberIds = new Set<string>();
  for (const card of cards) {
    const entry = byCurrency.get(card.currency) ?? { currency: card.currency, oweMinor: 0, owedMinor: 0, paidMinor: 0, groupSpendingMinor: 0 };
    if (card.myNetMinor < 0) entry.oweMinor += -card.myNetMinor;
    if (card.myNetMinor > 0) entry.owedMinor += card.myNetMinor;
    entry.paidMinor += card.myPaidMinor;
    entry.groupSpendingMinor += card.totalSpendingMinor;
    byCurrency.set(card.currency, entry);
    if (card.myNetMinor !== 0 && card.myMemberId) {
      const ledger = await loadGroupLedger(card.id);
      for (const t of ledger.suggestions) {
        if (t.fromMemberId !== card.myMemberId && t.toMemberId !== card.myMemberId) continue;
        reminders.push({ groupId: card.id, groupName: card.name, currency: card.currency, ...t, direction: t.fromMemberId === card.myMemberId ? 'pay' : 'receive' });
        memberIds.add(t.fromMemberId);
        memberIds.add(t.toMemberId);
      }
    }
  }

  const [recent, activity, plans, members] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId: { in: groupIds }, deletedAt: null },
      include: { ...expenseListInclude, group: { select: { name: true, accent: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    }),
    prisma.activityLog.findMany({ where: { groupId: { in: groupIds } }, include: { group: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.plan.findMany({
      where: { groupId: { in: groupIds }, archivedAt: null, status: { in: ['IDEA', 'PLANNING', 'CONFIRMED'] }, OR: [{ startDate: { gte: toDateOnly(todayIso()) } }, { endDate: { gte: toDateOnly(todayIso()) } }] },
      include: { group: { select: { name: true, accent: true } } },
      orderBy: { startDate: 'asc' },
      take: 5,
    }),
    prisma.groupMember.findMany({ where: { groupId: { in: groupIds } }, select: { id: true, displayName: true, userId: true } }),
  ]);
  const myMemberIds = new Set(members.filter((m) => m.userId === user.id).map((m) => m.id));

  res.json({
    totals: [...byCurrency.values()],
    activeGroups: cards.length,
    pendingSettlements: reminders.length,
    reminders: reminders.sort((a, b) => b.amountMinor - a.amountMinor),
    groups: cards,
    members: members.map((m) => ({ id: m.id, displayName: m.displayName, isYou: m.userId === user.id })),
    recentExpenses: recent.map((e) => ({
      ...serializeExpenseSummary(e),
      groupName: e.group.name,
      groupAccent: e.group.accent,
      myShareMinor: e.splits.filter((s) => myMemberIds.has(s.memberId)).reduce((a, s) => a + toNum(s.amountMinor), 0),
    })),
    upcomingPlans: plans.map((p) => ({
      id: p.id,
      groupId: p.groupId,
      groupName: p.group.name,
      groupAccent: p.group.accent,
      title: p.title,
      type: p.type,
      status: p.status,
      startDate: fromDateOnly(p.startDate),
      endDate: p.endDate ? fromDateOnly(p.endDate) : null,
      location: p.location,
    })),
    recentActivity: activity.map((a) => ({ ...serializeActivity(a), groupName: a.group.name })),
  });
});
