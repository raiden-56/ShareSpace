import { Router } from 'express';
import { Prisma, type Group, type GroupMember, type User } from '@prisma/client';
import { can, directGroupSchema, formatMoney, friendSettleSchema, netBetween, type Role } from '@sharespace/core';
import { prisma, todayIso, type Tx } from '../db';
import { currentUser } from '../lib/auth';
import { getPreferences, logActivity, notifyUser } from '../lib/events';
import { badRequest, conflict, forbidden, notFound, param, parse } from '../lib/http';
import { loadGroupLedger } from '../lib/ledger';
import { expenseListInclude, serializeExpenseSummary, serializeSettlement } from '../lib/serialize';
import { recordSettlement } from '../lib/settlement-write';

export const friendsRouter = Router();

/**
 * A friend is anyone you share a group with. Registered users are one friend across all groups
 * (key "u.<userId>"); people added by name with an email are matched by that email ("e.<email>");
 * people added by name only exist in their one group ("m.<memberId>").
 */
function friendKey(m: Pick<GroupMember, 'id' | 'userId' | 'email'>): string {
  if (m.userId) return `u.${m.userId}`;
  if (m.email) return `e.${m.email.toLowerCase()}`;
  return `m.${m.id}`;
}

interface FriendGroup {
  groupId: string;
  groupName: string;
  currency: string;
  accent: string;
  isDirect: boolean;
  archived: boolean;
  role: Role;
  myMemberId: string;
  theirMemberId: string;
  theirStatus: GroupMember['status'];
  /** Positive: they owe you. Negative: you owe them. Uses the group's simplify-debts setting. */
  netMinor: number;
}

interface Friend {
  key: string;
  name: string;
  email: string | null;
  userId: string | null;
  avatarColor: string | null;
  isPlaceholder: boolean;
  /** Net per currency across every shared group (never converted between currencies). */
  balances: { currency: string; netMinor: number }[];
  groups: FriendGroup[];
  directGroupId: string | null;
}

async function loadFriends(user: User, db: Tx | typeof prisma = prisma): Promise<Friend[]> {
  const memberships = await db.groupMember.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    include: {
      group: {
        include: { members: { include: { user: { select: { name: true, avatarColor: true, email: true } } }, orderBy: { joinedAt: 'asc' } } },
      },
    },
  });
  const friends = new Map<string, Friend>();
  for (const me of memberships) {
    const group = me.group;
    const ownEmail = user.email.toLowerCase();
    const others = group.members.filter((m) => m.id !== me.id && m.userId !== user.id && m.email?.toLowerCase() !== ownEmail);
    if (others.length === 0) continue;
    const ledger = await loadGroupLedger(group.id, db);
    for (const m of others) {
      const netMinor = netBetween(ledger.suggestions, me.id, m.id);
      // People who left with nothing outstanding are no longer listed for this group.
      if (m.status !== 'ACTIVE' && netMinor === 0) continue;
      const key = friendKey(m);
      let friend = friends.get(key);
      if (!friend) {
        friend = {
          key,
          name: m.user?.name ?? m.displayName,
          email: m.user?.email ?? m.email,
          userId: m.userId,
          avatarColor: m.user?.avatarColor ?? null,
          isPlaceholder: !m.userId,
          balances: [],
          groups: [],
          directGroupId: null,
        };
        friends.set(key, friend);
      }
      friend.groups.push({
        groupId: group.id,
        groupName: group.name,
        currency: group.currency,
        accent: group.accent,
        isDirect: group.directKey !== null,
        archived: group.archivedAt !== null,
        role: me.role,
        myMemberId: me.id,
        theirMemberId: m.id,
        theirStatus: m.status,
        netMinor,
      });
      if (group.directKey) friend.directGroupId = group.id;
    }
  }
  for (const friend of friends.values()) {
    const byCurrency = new Map<string, number>();
    for (const g of friend.groups) byCurrency.set(g.currency, (byCurrency.get(g.currency) ?? 0) + g.netMinor);
    friend.balances = [...byCurrency.entries()].filter(([, net]) => net !== 0).map(([currency, netMinor]) => ({ currency, netMinor }));
    friend.groups.sort((a, b) => Math.abs(b.netMinor) - Math.abs(a.netMinor) || a.groupName.localeCompare(b.groupName));
  }
  const outstanding = (f: Friend) => f.balances.reduce((a, b) => a + Math.abs(b.netMinor), 0);
  return [...friends.values()].sort((a, b) => outstanding(b) - outstanding(a) || a.name.localeCompare(b.name));
}

async function findFriend(user: User, key: string, db: Tx | typeof prisma = prisma): Promise<Friend> {
  const friend = (await loadFriends(user, db)).find((f) => f.key === key);
  if (!friend) throw notFound('Friend not found');
  return friend;
}

friendsRouter.get('/', async (req, res) => {
  res.json({ friends: await loadFriends(currentUser(req)) });
});

/** One friend: balances per group, shared expenses and the repayments between you. */
friendsRouter.get('/:key', async (req, res) => {
  const user = currentUser(req);
  const friend = await findFriend(user, param(req, 'key'));
  const pairs = friend.groups.map((g) => ({ groupId: g.groupId, me: g.myMemberId, them: g.theirMemberId }));
  const involves = (memberId: string): Prisma.ExpenseWhereInput => ({
    OR: [{ payers: { some: { memberId } } }, { splits: { some: { memberId } } }],
  });
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { deletedAt: null, OR: pairs.map((p) => ({ groupId: p.groupId, AND: [involves(p.me), involves(p.them)] })) },
      include: expenseListInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    }),
    prisma.settlement.findMany({
      where: {
        OR: pairs.flatMap((p) => [
          { groupId: p.groupId, fromMemberId: p.me, toMemberId: p.them },
          { groupId: p.groupId, fromMemberId: p.them, toMemberId: p.me },
        ]),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    }),
  ]);
  res.json({ friend, expenses: expenses.map(serializeExpenseSummary), settlements: settlements.map(serializeSettlement) });
});

/**
 * Settle up with a friend in one currency across every shared group. Paying the whole net balance
 * zeroes every group (groups where the debt runs the other way are settled in the other direction,
 * which is what makes the netting real). A smaller amount pays down the largest debts first.
 */
friendsRouter.post('/:key/settle', async (req, res) => {
  const user = currentUser(req);
  const key = param(req, 'key');
  const input = parse(friendSettleSchema, req.body);

  const prefix = `${input.clientRequestId}:`;
  const replay = await prisma.settlement.findMany({ where: { clientRequestId: { startsWith: prefix }, recordedById: user.id } });
  if (replay.length > 0) {
    res.status(200).json({ settlements: replay.map(serializeSettlement), replayed: true });
    return;
  }

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const friend = await findFriend(user, key, tx);
        const groups = friend.groups.filter((g) => g.currency === input.currency && g.netMinor !== 0);
        const net = groups.reduce((a, g) => a + g.netMinor, 0);
        if (net === 0) throw conflict(`You and ${friend.name} are settled up in ${input.currency}.`);
        if (input.amountMinor > Math.abs(net)) {
          throw badRequest(`That is more than the ${formatMoney(Math.abs(net), input.currency)} outstanding with ${friend.name}.`, {
            fields: { amountMinor: 'Amount is more than the balance' },
          });
        }

        // Positive net: they pay you. Each group's own direction decides who pays whom there.
        let plan: { group: FriendGroup; amount: number }[];
        if (input.amountMinor === Math.abs(net)) {
          plan = groups.map((g) => ({ group: g, amount: Math.abs(g.netMinor) }));
        } else {
          let remaining = input.amountMinor;
          plan = [];
          for (const g of groups.filter((x) => Math.sign(x.netMinor) === Math.sign(net))) {
            if (remaining === 0) break;
            const amount = Math.min(remaining, Math.abs(g.netMinor));
            plan.push({ group: g, amount });
            remaining -= amount;
          }
        }

        const rows = [];
        for (const { group: g, amount } of plan) {
          if (g.archived) throw conflict(`${g.groupName} is archived. Restore it to record repayments.`, 'ARCHIVED');
          if (!can(g.role, 'editRecords')) throw forbidden(`You can only view ${g.groupName}, so you cannot record repayments there.`);
          if (g.theirStatus !== 'ACTIVE') throw conflict(`${friend.name} has left ${g.groupName}. Settle that balance from the group's page.`);
          const group = (await tx.group.findUniqueOrThrow({ where: { id: g.groupId } })) as Group;
          const members = await tx.groupMember.findMany({ where: { id: { in: [g.myMemberId, g.theirMemberId] } } });
          const me = members.find((m) => m.id === g.myMemberId)!;
          const them = members.find((m) => m.id === g.theirMemberId)!;
          const theyPay = g.netMinor > 0;
          rows.push(
            await recordSettlement(tx, {
              group,
              user,
              from: theyPay ? them : me,
              to: theyPay ? me : them,
              input: {
                clientRequestId: `${prefix}${g.groupId}`,
                amountMinor: amount,
                method: input.method,
                methodNote: input.methodNote,
                date: input.date,
                notes: input.notes ?? (plan.length > 1 ? `Settle up with ${friend.name} across groups` : null),
              },
            }),
          );
        }
        return rows;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    res.status(201).json({ settlements: created.map(serializeSettlement), replayed: false });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.settlement.findMany({ where: { clientRequestId: { startsWith: prefix }, recordedById: user.id } });
      if (existing.length > 0) {
        res.status(200).json({ settlements: existing.map(serializeSettlement), replayed: true });
        return;
      }
    }
    throw err;
  }
});

/** In-app reminder to a registered friend who owes you. At most one per friend per day. */
friendsRouter.post('/:key/remind', async (req, res) => {
  const user = currentUser(req);
  const friend = await findFriend(user, param(req, 'key'));
  if (!friend.userId) throw conflict(`${friend.name} does not have a ShareSpace account yet. Invite them from the group's members page.`);
  const owed = friend.balances.filter((b) => b.netMinor > 0);
  if (owed.length === 0) throw conflict(`${friend.name} does not owe you anything.`);
  const dedupeKey = `remind:${user.id}:${todayIso()}`;
  const already = await prisma.notification.findUnique({ where: { userId_dedupeKey: { userId: friend.userId, dedupeKey } } });
  if (already) throw conflict(`You already reminded ${friend.name} today.`);
  const prefs = await getPreferences(friend.userId);
  if (!prefs.notifications.settlements) throw conflict(`${friend.name} has turned off repayment notifications.`);
  const amounts = owed.map((b) => formatMoney(b.netMinor, b.currency)).join(' and ');
  await notifyUser(prisma, friend.userId, {
    type: 'PAYMENT_REMINDER',
    title: 'Payment reminder',
    body: `${user.name} reminded you that you owe them ${amounts}.`,
    link: `/friends/${encodeURIComponent(`u.${user.id}`)}`,
    dedupeKey,
  });
  res.json({ ok: true });
});

/**
 * Expenses outside any group: a private two-person group, created on first use. Only for friends
 * with an account (people you already share a group with), so nobody can be added by strangers.
 */
friendsRouter.post('/:key/direct', async (req, res) => {
  const user = currentUser(req);
  const { currency } = parse(directGroupSchema, req.body ?? {});
  const friend = await findFriend(user, param(req, 'key'));
  if (!friend.userId) throw conflict(`${friend.name} needs a ShareSpace account for expenses outside a group. Add this expense in a shared group instead.`);
  const directKey = [user.id, friend.userId].sort().join(':');
  const existing = await prisma.group.findUnique({ where: { directKey } });
  if (existing) {
    const memberships = await prisma.groupMember.findMany({ where: { groupId: existing.id, userId: { in: [user.id, friend.userId] } } });
    if (memberships.length === 2 && memberships.every((m) => m.status === 'ACTIVE') && !existing.archivedAt) {
      res.json({ groupId: existing.id, created: false });
      return;
    }
    throw conflict(`Your expenses with ${friend.name} outside groups are archived or one of you left. Restore them from that group's settings.`);
  }
  const friendUser = await prisma.user.findUniqueOrThrow({ where: { id: friend.userId } });
  const groupCurrency = currency ?? (await getPreferences(user.id)).currency;
  try {
    const group = await prisma.$transaction(async (tx) => {
      const g = await tx.group.create({
        data: {
          name: `${user.name} & ${friendUser.name}`,
          description: 'Expenses outside any group',
          type: 'GENERAL',
          currency: groupCurrency,
          ownerId: user.id,
          directKey,
          members: {
            create: [
              { userId: user.id, displayName: user.name, email: user.email, role: 'OWNER' },
              { userId: friendUser.id, displayName: friendUser.name, email: friendUser.email, role: 'ADMIN' },
            ],
          },
        },
      });
      await logActivity(tx, {
        groupId: g.id,
        actorUserId: user.id,
        actorName: user.name,
        type: 'GROUP_CREATED',
        entityType: 'group',
        entityId: g.id,
        summary: `${user.name} started tracking expenses with ${friendUser.name}`,
      });
      return g;
    });
    res.status(201).json({ groupId: group.id, created: true });
  } catch (err) {
    // Both friends opened it at the same moment: return the one that won.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.group.findUnique({ where: { directKey } });
      if (winner) {
        res.json({ groupId: winner.id, created: false });
        return;
      }
    }
    throw err;
  }
});
