import {
  computeBalances,
  computeBudgetStatus,
  inDateRange,
  suggestSettlements,
  type LedgerExpense,
  type LedgerSettlement,
  type MemberBalance,
  type Transfer,
  type BudgetStatus,
} from '@sharespace/core';
import { fromDateOnly, prisma, toNum, type Tx } from '../db';

export interface GroupLedger {
  memberIds: string[];
  balances: MemberBalance[];
  suggestions: Transfer[];
  totalSpendingMinor: number;
  expenseCount: number;
}

/**
 * Builds the group's balances from source records only (non-deleted expenses and recorded settlements).
 * Nothing is cached, so edits, deletions and reversals can never be double-applied.
 */
export async function loadGroupLedger(groupId: string, db: Tx | typeof prisma = prisma): Promise<GroupLedger> {
  const [members, expenses, settlements] = await Promise.all([
    db.groupMember.findMany({ where: { groupId }, select: { id: true }, orderBy: { joinedAt: 'asc' } }),
    db.expense.findMany({
      where: { groupId, deletedAt: null },
      select: {
        id: true,
        amountMinor: true,
        payers: { select: { memberId: true, amountMinor: true } },
        splits: { select: { memberId: true, amountMinor: true } },
      },
    }),
    db.settlement.findMany({
      where: { groupId, status: 'RECORDED' },
      select: { id: true, fromMemberId: true, toMemberId: true, amountMinor: true, status: true },
    }),
  ]);

  const ledgerExpenses: LedgerExpense[] = expenses.map((e) => ({
    id: e.id,
    amountMinor: toNum(e.amountMinor),
    payers: e.payers.map((p) => ({ memberId: p.memberId, amountMinor: toNum(p.amountMinor) })),
    shares: e.splits.map((s) => ({ memberId: s.memberId, amountMinor: toNum(s.amountMinor) })),
  }));
  const ledgerSettlements: LedgerSettlement[] = settlements.map((s) => ({
    id: s.id,
    fromMemberId: s.fromMemberId,
    toMemberId: s.toMemberId,
    amountMinor: toNum(s.amountMinor),
    status: s.status,
  }));

  const memberIds = members.map((m) => m.id);
  const balances = computeBalances(memberIds, ledgerExpenses, ledgerSettlements);
  return {
    memberIds,
    balances,
    suggestions: suggestSettlements(balances),
    totalSpendingMinor: ledgerExpenses.reduce((a, e) => a + e.amountMinor, 0),
    expenseCount: ledgerExpenses.length,
  };
}

export interface BudgetSnapshot {
  status: BudgetStatus;
  categories: { category: string; budgetMinor: number; spentMinor: number; status: BudgetStatus }[];
}

/** Budget usage from recorded expenses within the budget period. Settlements are never counted. */
export async function loadBudgetSnapshot(groupId: string, db: Tx | typeof prisma = prisma): Promise<BudgetSnapshot | null> {
  const budget = await db.budget.findUnique({ where: { groupId }, include: { categories: true } });
  if (!budget) return null;
  const expenses = await db.expense.findMany({
    where: { groupId, deletedAt: null },
    select: { amountMinor: true, date: true, category: true },
  });
  const from = budget.startDate ? fromDateOnly(budget.startDate) : null;
  const to = budget.endDate ? fromDateOnly(budget.endDate) : null;
  const inRange = expenses.filter((e) => inDateRange(fromDateOnly(e.date), from, to));
  const spent = inRange.reduce((a, e) => a + toNum(e.amountMinor), 0);
  return {
    status: computeBudgetStatus(toNum(budget.totalMinor), spent, budget.warningThresholdPct),
    categories: budget.categories.map((c) => {
      const catSpent = inRange.filter((e) => e.category === c.category).reduce((a, e) => a + toNum(e.amountMinor), 0);
      return {
        category: c.category,
        budgetMinor: toNum(c.amountMinor),
        spentMinor: catSpent,
        status: computeBudgetStatus(toNum(c.amountMinor), catSpent, budget.warningThresholdPct),
      };
    }),
  };
}
