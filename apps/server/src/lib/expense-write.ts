import type { Group, Prisma } from '@prisma/client';
import {
  budgetStateWorsened,
  computeSplit,
  convertComponents,
  convertMinor,
  DEFAULT_CATEGORIES,
  formatMoney,
  getCurrency,
  occurrenceDate,
  validatePayers,
  type BudgetState,
  type ExpenseInput,
} from '@sharespace/core';
import { prisma, toBig, toDateOnly, type Tx } from '../db';
import { assertMembersInGroup } from './access';
import { logActivity, notifyGroup } from './events';
import { badRequest, notFound } from './http';
import { loadBudgetSnapshot } from './ledger';

export interface PreparedExpense {
  data: Omit<Prisma.ExpenseUncheckedCreateInput, 'groupId' | 'clientRequestId' | 'createdById' | 'payers' | 'splits' | 'items'>;
  payers: { memberId: string; amountMinor: number; originalAmountMinor: number }[];
  splits: { memberId: string; amountMinor: number; originalAmountMinor: number; inputValue: number | null; position: number }[];
  items: { description: string; quantity: number; unitPriceMinor: number; memberIds: string[]; position: number }[];
}

/**
 * Validates an expense payload against the group and computes all derived amounts with the core
 * split engine. Nothing is written here; callers persist the result inside a transaction.
 */
export async function prepareExpense(group: Group, input: ExpenseInput, previousMemberIds: string[] = []): Promise<PreparedExpense> {
  // Currency handling: balances are always kept in the group's currency.
  let convertedTotal = input.amountMinor;
  let fx: { fxRate: string | null; fxDate: Date | null; fxSource: string | null } = { fxRate: null, fxDate: null, fxSource: null };
  if (input.currency !== group.currency) {
    if (!group.multiCurrency) throw badRequest(`This group records expenses in ${group.currency} only. Enable multiple currencies in group settings.`);
    if (!input.fxRate) throw badRequest(`Enter the exchange rate from ${input.currency} to ${group.currency}.`, { fields: { fxRate: 'Exchange rate is required' } });
    convertedTotal = convertMinor(input.amountMinor, getCurrency(input.currency).decimals, getCurrency(group.currency).decimals, input.fxRate);
    if (convertedTotal <= 0) throw badRequest('The converted amount is too small to record.');
    fx = { fxRate: input.fxRate, fxDate: toDateOnly(input.date), fxSource: 'manual' };
  }

  const payerCheck = validatePayers(input.amountMinor, input.payers);
  if (!payerCheck.ok) throw badRequest(payerCheck.error, { fields: { payers: payerCheck.error } });

  const split = computeSplit({
    method: input.split.method,
    totalMinor: input.amountMinor,
    participants: input.split.participants,
    items: input.split.items,
    adjustments: input.split.adjustments,
  });
  if (!split.ok) throw badRequest(split.error, { fields: { split: split.error }, differenceMinor: split.differenceMinor });

  const memberIds = [
    ...input.payers.map((p) => p.memberId),
    ...split.shares.map((s) => s.memberId),
  ];
  await assertMembersInGroup(group.id, memberIds, { allowInactive: previousMemberIds });

  if (input.planId) {
    const plan = await prisma.plan.findFirst({ where: { id: input.planId, groupId: group.id } });
    if (!plan) throw notFound('Plan not found in this group');
  }

  const isDefaultCategory = DEFAULT_CATEGORIES.some((c) => c.id === input.category);
  if (!isDefaultCategory) {
    const custom = await prisma.groupCategory.findFirst({ where: { id: input.category, groupId: group.id } });
    if (!custom) throw badRequest('Choose a valid category', { fields: { category: 'Choose a valid category' } });
  }

  const payerConverted = convertComponents(input.payers.map((p) => p.amountMinor), convertedTotal);
  const shareConverted = convertComponents(split.shares.map((s) => s.amountMinor), convertedTotal);
  const inputValues = new Map(input.split.participants.map((p) => [p.memberId, p.value ?? null]));
  const keepsInput = ['EXACT', 'PERCENTAGE', 'SHARES', 'ADJUSTMENT'].includes(input.split.method);
  const adj = input.split.method === 'ITEMIZED' ? input.split.adjustments : undefined;

  return {
    data: {
      title: input.title,
      description: input.description,
      notes: input.notes,
      amountMinor: toBig(convertedTotal),
      currency: group.currency,
      originalAmountMinor: toBig(input.amountMinor),
      originalCurrency: input.currency,
      ...fx,
      date: toDateOnly(input.date),
      category: input.category,
      splitMethod: input.split.method,
      taxMinor: toBig(adj?.taxMinor ?? 0),
      serviceMinor: toBig(adj?.serviceMinor ?? 0),
      discountMinor: toBig(adj?.discountMinor ?? 0),
      planId: input.planId ?? null,
      // Repeat schedule restarts from the expense date; copies already created are never duplicated.
      repeatInterval: input.repeat,
      repeatCount: 0,
      repeatNextDate: input.repeat === 'NONE' ? null : toDateOnly(occurrenceDate(input.date, input.repeat, 1)),
    },
    payers: input.payers.map((p, i) => ({ memberId: p.memberId, amountMinor: payerConverted[i]!, originalAmountMinor: p.amountMinor })),
    splits: split.shares.map((s, i) => ({
      memberId: s.memberId,
      amountMinor: shareConverted[i]!,
      originalAmountMinor: s.amountMinor,
      inputValue: keepsInput ? (inputValues.get(s.memberId) ?? null) : null,
      position: i,
    })),
    items:
      input.split.method === 'ITEMIZED'
        ? (input.split.items ?? []).map((it, i) => ({ ...it, position: i }))
        : [],
  };
}

export async function writeExpenseChildren(tx: Tx, expenseId: string, prepared: PreparedExpense): Promise<void> {
  await tx.expensePayer.createMany({
    data: prepared.payers.map((p) => ({
      expenseId,
      memberId: p.memberId,
      amountMinor: toBig(p.amountMinor),
      originalAmountMinor: toBig(p.originalAmountMinor),
    })),
  });
  await tx.expenseSplit.createMany({
    data: prepared.splits.map((s) => ({
      expenseId,
      memberId: s.memberId,
      amountMinor: toBig(s.amountMinor),
      originalAmountMinor: toBig(s.originalAmountMinor),
      inputValue: s.inputValue === null ? null : toBig(s.inputValue),
      position: s.position,
    })),
  });
  for (const item of prepared.items) {
    await tx.expenseItem.create({
      data: {
        expenseId,
        position: item.position,
        description: item.description,
        quantity: item.quantity,
        unitPriceMinor: toBig(item.unitPriceMinor),
        participants: { create: item.memberIds.map((memberId) => ({ memberId })) },
      },
    });
  }
}

/**
 * Sends one budget warning each time spending crosses into a worse state
 * (normal → approaching → exceeded). Recovering resets the marker so a later crossing warns again.
 */
export async function checkBudgetAlert(tx: Tx, group: Group, actor: { id: string; name: string }): Promise<void> {
  const budget = await tx.budget.findUnique({ where: { groupId: group.id } });
  if (!budget) return;
  const snapshot = await loadBudgetSnapshot(group.id, tx);
  if (!snapshot) return;
  const previous = budget.lastAlertState as BudgetState;
  const current = snapshot.status.state;
  if (previous === current) return;
  await tx.budget.update({ where: { id: budget.id }, data: { lastAlertState: current } });
  if (!budgetStateWorsened(previous, current)) return;
  const pct = Math.floor(snapshot.status.usedBps / 100);
  const body =
    current === 'EXCEEDED'
      ? `${group.name} has exceeded its budget: ${formatMoney(snapshot.status.spentMinor, group.currency)} of ${formatMoney(snapshot.status.budgetMinor, group.currency)} spent.`
      : `${group.name} has used ${pct}% of its budget (${formatMoney(snapshot.status.spentMinor, group.currency)} of ${formatMoney(snapshot.status.budgetMinor, group.currency)}).`;
  await notifyGroup(tx, {
    groupId: group.id,
    type: 'BUDGET_WARNING',
    title: current === 'EXCEEDED' ? 'Budget exceeded' : 'Approaching budget limit',
    body,
    link: `/groups/${group.id}/budget`,
  });
  await logActivity(tx, {
    groupId: group.id,
    actorUserId: actor.id,
    actorName: actor.name,
    type: 'BUDGET_WARNING',
    entityType: 'budget',
    entityId: budget.id,
    summary: current === 'EXCEEDED' ? 'Group spending exceeded the budget' : `Group spending reached ${pct}% of the budget`,
  });
}

type Snapshot = Record<string, unknown>;

/** Human-readable summary of what changed between two expense snapshots. */
export function describeChanges(before: Snapshot, after: Snapshot): string {
  const labels: Record<string, string> = {
    title: 'title',
    description: 'description',
    notes: 'notes',
    amountMinor: 'amount',
    originalAmountMinor: 'amount',
    originalCurrency: 'currency',
    fxRate: 'exchange rate',
    date: 'date',
    category: 'category',
    splitMethod: 'split method',
    planId: 'plan',
    payers: 'payers',
    shares: 'shares',
    items: 'items',
    adjustments: 'tax / discounts',
  };
  const changed = new Set<string>();
  for (const key of Object.keys(labels)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.add(labels[key]!);
  }
  return changed.size ? `Changed ${[...changed].join(', ')}` : 'No changes';
}
