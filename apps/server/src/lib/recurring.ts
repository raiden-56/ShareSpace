import type { NextFunction, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { dueOccurrences, formatMoney, REPEAT_LABELS } from '@sharespace/core';
import { fromDateOnly, prisma, todayIso, toDateOnly, toNum } from '../db';
import { accessibleGroupIds } from './access';
import { logActivity, notifyGroup } from './events';
import { checkBudgetAlert } from './expense-write';
import { log } from './log';
import { expenseDetailInclude, expenseSnapshot } from './serialize';

const templateInclude = {
  payers: true,
  splits: true,
  items: { include: { participants: true } },
  group: true,
} satisfies Prisma.ExpenseInclude;

/**
 * Adds every repeat of a repeating expense that is due today or earlier. There is no background
 * scheduler: this runs when the app is used (see `recurringSync`) and right after a repeating
 * expense is saved. Each copy's idempotency key is derived from the template and the date, so
 * concurrent runs can never create the same repeat twice.
 */
export async function syncRecurringExpenses(where: { groupIds?: string[]; expenseId?: string }): Promise<number> {
  const today = todayIso();
  const templates = await prisma.expense.findMany({
    where: {
      repeatInterval: { not: 'NONE' },
      deletedAt: null,
      repeatNextDate: { lte: toDateOnly(today) },
      group: { archivedAt: null },
      ...(where.groupIds ? { groupId: { in: where.groupIds } } : {}),
      ...(where.expenseId ? { id: where.expenseId } : {}),
    },
    include: templateInclude,
    take: 50,
  });

  let created = 0;
  for (const t of templates) {
    const { due, next } = dueOccurrences(fromDateOnly(t.date), t.repeatInterval, t.repeatCount, today);
    if (due.length === 0) continue;
    try {
      created += await prisma.$transaction(async (tx) => {
        // Claim this batch: a concurrent run that read the same repeatCount updates nothing and stops here.
        const claim = await tx.expense.updateMany({
          where: { id: t.id, repeatCount: t.repeatCount, repeatInterval: t.repeatInterval, deletedAt: null },
          data: { repeatCount: due[due.length - 1]!.n, repeatNextDate: next ? toDateOnly(next.date) : null },
        });
        if (claim.count === 0) return 0;
        let added = 0;
        for (const occurrence of due) {
          const clientRequestId = `repeat:${t.id}:${occurrence.date}`;
          const exists = await tx.expense.findUnique({ where: { groupId_clientRequestId: { groupId: t.groupId, clientRequestId } }, select: { id: true } });
          if (exists) continue;
          const copy = await tx.expense.create({
            data: {
              groupId: t.groupId,
              clientRequestId,
              title: t.title,
              description: t.description,
              notes: t.notes,
              amountMinor: t.amountMinor,
              currency: t.currency,
              originalAmountMinor: t.originalAmountMinor,
              originalCurrency: t.originalCurrency,
              fxRate: t.fxRate,
              fxDate: t.fxRate ? toDateOnly(occurrence.date) : null,
              fxSource: t.fxSource,
              date: toDateOnly(occurrence.date),
              category: t.category,
              splitMethod: t.splitMethod,
              taxMinor: t.taxMinor,
              serviceMinor: t.serviceMinor,
              discountMinor: t.discountMinor,
              planId: t.planId,
              createdById: t.createdById,
              recurringSourceId: t.id,
              payers: { create: t.payers.map((p) => ({ memberId: p.memberId, amountMinor: p.amountMinor, originalAmountMinor: p.originalAmountMinor })) },
              splits: {
                create: t.splits.map((s) => ({
                  memberId: s.memberId,
                  amountMinor: s.amountMinor,
                  originalAmountMinor: s.originalAmountMinor,
                  inputValue: s.inputValue,
                  position: s.position,
                })),
              },
            },
          });
          for (const item of t.items) {
            await tx.expenseItem.create({
              data: {
                expenseId: copy.id,
                position: item.position,
                description: item.description,
                quantity: item.quantity,
                unitPriceMinor: item.unitPriceMinor,
                participants: { create: item.participants.map((p) => ({ memberId: p.memberId })) },
              },
            });
          }
          const full = await tx.expense.findUniqueOrThrow({ where: { id: copy.id }, include: expenseDetailInclude });
          await tx.expenseRevision.create({
            data: {
              expenseId: copy.id,
              version: 1,
              action: 'CREATED',
              snapshot: expenseSnapshot(full),
              summary: `Added automatically (${REPEAT_LABELS[t.repeatInterval].toLowerCase()})`,
              changedById: t.createdById,
            },
          });
          await logActivity(tx, {
            groupId: t.groupId,
            actorUserId: null,
            actorName: 'ShareSpace',
            type: 'EXPENSE_ADDED',
            entityType: 'expense',
            entityId: copy.id,
            planId: t.planId,
            summary: `Repeating expense "${t.title}" (${formatMoney(toNum(t.amountMinor), t.currency)}) added for ${occurrence.date}`,
          });
          added++;
        }
        if (added > 0) {
          await notifyGroup(tx, {
            groupId: t.groupId,
            type: 'EXPENSE_CREATED',
            title: 'Repeating expense added',
            body:
              added === 1
                ? `"${t.title}" (${formatMoney(toNum(t.amountMinor), t.currency)}) was added again in ${t.group.name}`
                : `"${t.title}" was added ${added} times in ${t.group.name}`,
            link: `/groups/${t.groupId}/expenses`,
          });
          const creator = await tx.user.findUnique({ where: { id: t.createdById }, select: { id: true, name: true } });
          await checkBudgetAlert(tx, t.group, creator ?? { id: t.createdById, name: 'ShareSpace' });
        }
        return added;
      });
    } catch (err) {
      log.error(`Could not add repeats of expense ${t.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return created;
}

const lastSync = new Map<string, number>();
const SYNC_INTERVAL_MS = 30_000;

/**
 * Middleware: on page loads (GET requests), adds due repeats in the user's groups at most every
 * 30 seconds per user, before the request reads any balances. Failures are logged, never shown.
 */
export async function recurringSync(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = req.user?.id;
  if (req.method !== 'GET' || !userId) return next();
  const now = Date.now();
  if (now - (lastSync.get(userId) ?? 0) < SYNC_INTERVAL_MS) return next();
  lastSync.set(userId, now);
  if (lastSync.size > 10_000) lastSync.clear();
  try {
    const groupIds = await accessibleGroupIds(userId);
    if (groupIds.length > 0) await syncRecurringExpenses({ groupIds });
  } catch (err) {
    log.error(`Repeating expense sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  next();
}
