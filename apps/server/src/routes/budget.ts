import { Router } from 'express';
import {
  budgetSchema,
  computeBudgetStatus,
  formatMoney,
  inDateRange,
  pickGranularity,
  spendingByCategory,
  spendingOverTime,
} from '@sharespace/core';
import { fromDateOnly, fromDateOnlyOrNull, prisma, toBig, toDateOnly, todayIso, toNum } from '../db';
import { requireGroup } from '../lib/access';
import { currentUser } from '../lib/auth';
import { logActivity } from '../lib/events';
import { checkBudgetAlert } from '../lib/expense-write';
import { notFound, parse } from '../lib/http';
import { expenseListInclude, serializeExpenseSummary } from '../lib/serialize';

export const groupBudgetRouter = Router({ mergeParams: true });

groupBudgetRouter.get('/', async (req, res) => {
  const { group } = await requireGroup(req);
  const budget = await prisma.budget.findUnique({ where: { groupId: group.id }, include: { categories: true } });
  if (!budget) {
    res.json({ budget: null });
    return;
  }
  const from = fromDateOnlyOrNull(budget.startDate);
  const to = fromDateOnlyOrNull(budget.endDate);
  const expenses = await prisma.expense.findMany({
    where: { groupId: group.id, deletedAt: null },
    include: expenseListInclude,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  const inRange = expenses.filter((e) => inDateRange(fromDateOnly(e.date), from, to));
  const rows = inRange.map((e) => ({
    id: e.id,
    groupId: e.groupId,
    date: fromDateOnly(e.date),
    category: e.category,
    amountMinor: toNum(e.amountMinor),
    payers: [],
    shares: [],
  }));
  const spent = rows.reduce((a, r) => a + r.amountMinor, 0);
  const total = toNum(budget.totalMinor);
  const status = computeBudgetStatus(total, spent, budget.warningThresholdPct);
  const dates = rows.map((r) => r.date).sort();
  const trendFrom = from ?? dates[0] ?? todayIso();
  const trendTo = to && to < todayIso() ? to : todayIso();
  const granularity = trendFrom <= trendTo ? pickGranularity(trendFrom, trendTo) : 'day';

  // Cumulative spending series, so it can be read against the budget line.
  let running = 0;
  const trend = (trendFrom <= trendTo ? spendingOverTime(rows, granularity, trendFrom, trendTo) : []).map((b) => {
    running += b.amountMinor;
    return { key: b.key, amountMinor: b.amountMinor, cumulativeMinor: running };
  });

  res.json({
    budget: {
      id: budget.id,
      totalMinor: total,
      currency: budget.currency,
      startDate: from,
      endDate: to,
      warningThresholdPct: budget.warningThresholdPct,
      categories: budget.categories.map((c) => ({ category: c.category, amountMinor: toNum(c.amountMinor) })),
      updatedAt: budget.updatedAt.toISOString(),
    },
    status,
    categories: budget.categories.map((c) => {
      const catSpent = rows.filter((r) => r.category === c.category).reduce((a, r) => a + r.amountMinor, 0);
      return { category: c.category, ...computeBudgetStatus(toNum(c.amountMinor), catSpent, budget.warningThresholdPct) };
    }),
    byCategory: spendingByCategory(rows),
    trend,
    granularity,
    recent: inRange.slice(0, 5).map(serializeExpenseSummary),
  });
});

groupBudgetRouter.put('/', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'manageSettings');
  const input = parse(budgetSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.budget.findUnique({ where: { groupId: group.id } });
    const data = {
      totalMinor: toBig(input.totalMinor),
      currency: group.currency,
      startDate: input.startDate ? toDateOnly(input.startDate) : null,
      endDate: input.endDate ? toDateOnly(input.endDate) : null,
      warningThresholdPct: input.warningThresholdPct,
    };
    const budget = existing
      ? await tx.budget.update({ where: { id: existing.id }, data: { ...data, lastAlertState: 'NORMAL' } })
      : await tx.budget.create({ data: { ...data, groupId: group.id } });
    await tx.budgetCategory.deleteMany({ where: { budgetId: budget.id } });
    if (input.categories.length) {
      await tx.budgetCategory.createMany({
        data: input.categories.map((c) => ({ budgetId: budget.id, category: c.category, amountMinor: toBig(c.amountMinor) })),
      });
    }
    await logActivity(tx, {
      groupId: group.id,
      actorUserId: user.id,
      actorName: user.name,
      type: existing ? 'BUDGET_CHANGED' : 'BUDGET_CREATED',
      entityType: 'budget',
      entityId: budget.id,
      summary: `${user.name} ${existing ? 'changed' : 'set'} the budget to ${formatMoney(input.totalMinor, group.currency)}`,
    });
    await checkBudgetAlert(tx, group, user);
  });
  res.json({ ok: true });
});

groupBudgetRouter.delete('/', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'manageSettings');
  const existing = await prisma.budget.findUnique({ where: { groupId: group.id } });
  if (!existing) throw notFound('No budget set');
  await prisma.$transaction(async (tx) => {
    await tx.budget.delete({ where: { id: existing.id } });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'BUDGET_REMOVED', entityType: 'budget', entityId: existing.id, summary: `${user.name} removed the budget` });
  });
  res.json({ ok: true });
});
