import type { Group, GroupMember, User } from '@prisma/client';
import { formatMoney, SETTLEMENT_METHOD_LABELS, type SettlementInput } from '@sharespace/core';
import { toBig, toDateOnly, type Tx } from '../db';
import { logActivity, notifyGroup } from './events';

/** Writes one recorded repayment with its activity entry and notifications. Callers validate first. */
export async function recordSettlement(
  tx: Tx,
  args: {
    group: Group;
    user: User;
    from: Pick<GroupMember, 'id' | 'displayName' | 'userId'>;
    to: Pick<GroupMember, 'id' | 'displayName' | 'userId'>;
    input: Omit<SettlementInput, 'fromMemberId' | 'toMemberId'>;
  },
) {
  const { group, user, from, to, input } = args;
  const created = await tx.settlement.create({
    data: {
      groupId: group.id,
      clientRequestId: input.clientRequestId,
      fromMemberId: from.id,
      toMemberId: to.id,
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
}
