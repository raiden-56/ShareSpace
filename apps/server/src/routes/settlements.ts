import { Router } from 'express';
import { Prisma } from '@prisma/client';
import {
  formatMoney,
  getCurrency,
  minorToDecimalString,
  SETTLEMENT_METHOD_LABELS,
  settlementReverseSchema,
  settlementSchema,
  toCsv,
  validateSettlement,
} from '@sharespace/core';
import { fromDateOnly, prisma, toBig, toDateOnly } from '../db';
import { accessibleGroupIds, requireGroup } from '../lib/access';
import { currentUser } from '../lib/auth';
import { logActivity, notifyGroup } from '../lib/events';
import { badRequest, conflict, notFound, param, parse } from '../lib/http';
import { loadGroupLedger } from '../lib/ledger';
import { serializeSettlement } from '../lib/serialize';
import { sendCsv, slug } from './expenses';

export const groupSettlementsRouter = Router({ mergeParams: true });
export const groupBalancesRouter = Router({ mergeParams: true });
export const settlementsRouter = Router();

groupBalancesRouter.get('/', async (req, res) => {
  const { group } = await requireGroup(req);
  const ledger = await loadGroupLedger(group.id);
  res.json({
    currency: group.currency,
    totalSpendingMinor: ledger.totalSpendingMinor,
    balances: ledger.balances,
    suggestions: ledger.suggestions,
  });
});

groupSettlementsRouter.get('/', async (req, res) => {
  const { group } = await requireGroup(req);
  const rows = await prisma.settlement.findMany({ where: { groupId: group.id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 });
  res.json({ settlements: rows.map(serializeSettlement) });
});

groupSettlementsRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const input = parse(settlementSchema, req.body);

  const replay = await prisma.settlement.findUnique({ where: { groupId_clientRequestId: { groupId: group.id, clientRequestId: input.clientRequestId } } });
  if (replay) {
    res.status(200).json({ settlement: serializeSettlement(replay), replayed: true });
    return;
  }

  const members = await prisma.groupMember.findMany({
    where: { groupId: group.id, id: { in: [input.fromMemberId, input.toMemberId] } },
  });
  if (members.length !== (input.fromMemberId === input.toMemberId ? 1 : 2)) throw notFound('Both members must belong to this group');
  if (members.some((m) => m.status !== 'ACTIVE')) throw conflict('Both members must still be active in this group');
  const from = members.find((m) => m.id === input.fromMemberId)!;
  const to = members.find((m) => m.id === input.toMemberId)!;

  try {
    const settlement = await prisma.$transaction(
      async (tx) => {
        const ledger = await loadGroupLedger(group.id, tx);
        const check = validateSettlement(ledger.balances, input.fromMemberId, input.toMemberId, input.amountMinor);
        if (!check.ok) throw badRequest(check.error);
        const created = await tx.settlement.create({
          data: {
            groupId: group.id,
            clientRequestId: input.clientRequestId,
            fromMemberId: input.fromMemberId,
            toMemberId: input.toMemberId,
            amountMinor: toBig(input.amountMinor),
            currency: group.currency,
            method: input.method,
            methodNote: input.methodNote,
            date: toDateOnly(input.date),
            notes: input.notes,
            recordedById: user.id,
          },
        });
        const amountText = formatMoney(input.amountMinor, group.currency);
        await logActivity(tx, {
          groupId: group.id,
          actorUserId: user.id,
          actorName: user.name,
          type: 'SETTLEMENT_RECORDED',
          entityType: 'settlement',
          entityId: created.id,
          summary: `${user.name} recorded ${from.displayName} paying ${to.displayName} ${amountText} (${SETTLEMENT_METHOD_LABELS[input.method]})`,
        });
        await notifyGroup(tx, {
          groupId: group.id,
          type: 'SETTLEMENT',
          title: 'Repayment recorded',
          body: `${from.displayName} paid ${to.displayName} ${amountText} in ${group.name}`,
          link: `/groups/${group.id}/balances`,
          onlyUserIds: [from.userId, to.userId].filter((id): id is string => !!id),
          excludeUserIds: [user.id],
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    res.status(201).json({ settlement: serializeSettlement(settlement), replayed: false });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.settlement.findUnique({ where: { groupId_clientRequestId: { groupId: group.id, clientRequestId: input.clientRequestId } } });
      if (existing) {
        res.status(200).json({ settlement: serializeSettlement(existing), replayed: true });
        return;
      }
    }
    throw err;
  }
});

/** Completed settlements are never deleted. A reversal keeps the record and removes its effect on balances. */
groupSettlementsRouter.post('/:settlementId/reverse', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const { reason } = parse(settlementReverseSchema, req.body);
  const settlement = await prisma.settlement.findFirst({
    where: { id: param(req, 'settlementId'), groupId: group.id },
    include: { fromMember: true, toMember: true },
  });
  if (!settlement) throw notFound('Settlement not found');
  if (settlement.status !== 'RECORDED') throw conflict('This settlement has already been reversed.');
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.settlement.updateMany({
      where: { id: settlement.id, status: 'RECORDED' },
      data: { status: 'REVERSED', reversedAt: new Date(), reversedById: user.id, reversalReason: reason },
    });
    if (count === 0) throw conflict('This settlement has already been reversed.');
    const amountText = formatMoney(Number(settlement.amountMinor), group.currency);
    await logActivity(tx, {
      groupId: group.id,
      actorUserId: user.id,
      actorName: user.name,
      type: 'SETTLEMENT_REVERSED',
      entityType: 'settlement',
      entityId: settlement.id,
      summary: `${user.name} reversed the ${amountText} repayment from ${settlement.fromMember.displayName} to ${settlement.toMember.displayName}: ${reason}`,
    });
    await notifyGroup(tx, {
      groupId: group.id,
      type: 'SETTLEMENT',
      title: 'Repayment reversed',
      body: `The ${amountText} repayment from ${settlement.fromMember.displayName} to ${settlement.toMember.displayName} was reversed`,
      link: `/groups/${group.id}/balances`,
      onlyUserIds: [settlement.fromMember.userId, settlement.toMember.userId].filter((id): id is string => !!id),
      excludeUserIds: [user.id],
    });
    return tx.settlement.findUniqueOrThrow({ where: { id: settlement.id } });
  });
  res.json({ settlement: serializeSettlement(updated) });
});

groupSettlementsRouter.get('/export.csv', async (req, res) => {
  const { group } = await requireGroup(req);
  const rows = await prisma.settlement.findMany({
    where: { groupId: group.id },
    include: { fromMember: true, toMember: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  const dec = getCurrency(group.currency).decimals;
  const csv = toCsv(
    ['Date', 'From', 'To', `Amount (${group.currency})`, 'Method', 'Method note', 'Status', 'Notes', 'Reversal reason', 'Recorded at'],
    rows.map((s) => [
      fromDateOnly(s.date),
      s.fromMember.displayName,
      s.toMember.displayName,
      minorToDecimalString(Number(s.amountMinor), dec),
      SETTLEMENT_METHOD_LABELS[s.method],
      s.methodNote ?? '',
      s.status,
      s.notes ?? '',
      s.reversalReason ?? '',
      s.createdAt.toISOString(),
    ]),
  );
  sendCsv(res, `${slug(group.name)}-settlements.csv`, csv);
});

/** Settlement overview across every group the user belongs to. */
settlementsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const groupIds = await accessibleGroupIds(user.id);
  const groups = await prisma.group.findMany({
    where: { id: { in: groupIds } },
    include: { members: { where: { userId: user.id, status: 'ACTIVE' }, select: { id: true, role: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  const overview = await Promise.all(
    groups.map(async (g) => {
      const ledger = await loadGroupLedger(g.id);
      const me = g.members[0]!;
      return {
        groupId: g.id,
        groupName: g.name,
        currency: g.currency,
        accent: g.accent,
        role: me.role,
        myMemberId: me.id,
        myNetMinor: ledger.balances.find((b) => b.memberId === me.id)?.netMinor ?? 0,
        suggestions: ledger.suggestions,
      };
    }),
  );
  // History includes archived groups (read-only) so reports for them stay complete.
  const historyGroupIds = await accessibleGroupIds(user.id, { includeArchived: true });
  const history = await prisma.settlement.findMany({
    where: { groupId: { in: historyGroupIds } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  const memberIds = [...new Set(history.flatMap((s) => [s.fromMemberId, s.toMemberId]).concat(overview.flatMap((o) => o.suggestions.flatMap((t) => [t.fromMemberId, t.toMemberId]))))];
  const members = await prisma.groupMember.findMany({ where: { id: { in: memberIds } }, select: { id: true, displayName: true, userId: true } });
  res.json({
    groups: overview,
    history: history.map(serializeSettlement),
    members: members.map((m) => ({ id: m.id, displayName: m.displayName, isYou: m.userId === user.id })),
  });
});
