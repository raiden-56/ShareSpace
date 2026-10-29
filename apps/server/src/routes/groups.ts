import { Router } from 'express';
import type { GroupInvitation, User } from '@prisma/client';
import {
  ACCENTS,
  can,
  categoryCreateSchema,
  groupCreateSchema,
  groupUpdateSchema,
  invitationCreateSchema,
  memberCreateSchema,
  memberUpdateSchema,
  ROLE_LABELS,
} from '@sharespace/core';
import { fromDateOnly, prisma, toBig, toNum, todayIso, toDateOnly, type Tx } from '../db';
import { env } from '../env';
import { requireGroup } from '../lib/access';
import { currentUser, randomToken, sha256 } from '../lib/auth';
import { logActivity, notifyGroup, notifyUser } from '../lib/events';
import { badRequest, conflict, forbidden, notFound, param, parse } from '../lib/http';
import { loadBudgetSnapshot, loadGroupLedger } from '../lib/ledger';
import { memberInclude, serializeMember } from '../lib/serialize';

export const groupsRouter = Router();
export const invitationsRouter = Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function groupCard(groupId: string, userId: string) {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      members: { where: { status: 'ACTIVE' }, include: memberInclude, orderBy: { joinedAt: 'asc' } },
      plans: {
        where: { archivedAt: null, status: { notIn: ['CANCELLED', 'COMPLETED'] }, startDate: { gte: toDateOnly(todayIso()) } },
        orderBy: { startDate: 'asc' },
        take: 1,
        select: { id: true, title: true, startDate: true, location: true },
      },
    },
  });
  const me = group.members.find((m) => m.userId === userId);
  const [ledger, budget] = await Promise.all([loadGroupLedger(groupId), loadBudgetSnapshot(groupId)]);
  const myBalance = ledger.balances.find((b) => b.memberId === me?.id);
  const upcoming = group.plans[0];
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    type: group.type,
    currency: group.currency,
    accent: group.accent,
    simplifyDebts: group.simplifyDebts,
    /** A two-person group for expenses with a friend outside any group. */
    isDirect: group.directKey !== null,
    archivedAt: group.archivedAt?.toISOString() ?? null,
    createdAt: group.createdAt.toISOString(),
    role: me?.role ?? null,
    myMemberId: me?.id ?? null,
    memberCount: group.members.length,
    members: group.members.slice(0, 6).map((m) => ({ id: m.id, displayName: m.displayName, avatarColor: m.user?.avatarColor ?? null })),
    totalSpendingMinor: ledger.totalSpendingMinor,
    expenseCount: ledger.expenseCount,
    myNetMinor: myBalance?.netMinor ?? 0,
    myPaidMinor: myBalance?.paidMinor ?? 0,
    pendingTransfers: ledger.suggestions.length,
    budget: budget
      ? { totalMinor: budget.status.budgetMinor, spentMinor: budget.status.spentMinor, usedBps: budget.status.usedBps, state: budget.status.state }
      : null,
    upcomingPlan: upcoming
      ? { id: upcoming.id, title: upcoming.title, startDate: fromDateOnly(upcoming.startDate), location: upcoming.location }
      : null,
  };
}

groupsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const archived = req.query.archived === 'true';
  const memberships = await prisma.groupMember.findMany({
    // Direct (two-person) groups appear under Friends, not in the group list.
    where: { userId: user.id, status: 'ACTIVE', group: { archivedAt: archived ? { not: null } : null, directKey: null } },
    select: { groupId: true },
    orderBy: { group: { updatedAt: 'desc' } },
  });
  const cards = await Promise.all(memberships.map((m) => groupCard(m.groupId, user.id)));
  res.json({ groups: cards });
});

groupsRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  const input = parse(groupCreateSchema, req.body);
  const accent = input.accent ?? ACCENTS[0];
  const ownEmail = user.email.toLowerCase();
  const drafts = input.members.filter((m) => m.email?.toLowerCase() !== ownEmail);

  const result = await prisma.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: {
        name: input.name,
        description: input.description,
        type: input.type,
        currency: input.currency,
        accent,
        simplifyDebts: input.simplifyDebts,
        ownerId: user.id,
        members: {
          create: [{ userId: user.id, displayName: user.name, email: user.email, role: 'OWNER' }],
        },
      },
    });
    const invites: { email: string; displayName: string; inviteUrl: string }[] = [];
    for (const draft of drafts) {
      const member = await tx.groupMember.create({
        data: { groupId: group.id, displayName: draft.displayName, email: draft.email ?? null, role: 'MEMBER' },
      });
      if (draft.email) {
        const { url } = await createInvitation(tx, { groupId: group.id, groupName: group.name, email: draft.email, role: 'MEMBER', memberId: member.id, inviter: user });
        invites.push({ email: draft.email, displayName: draft.displayName, inviteUrl: url });
      }
    }
    if (input.budgetMinor) {
      await tx.budget.create({ data: { groupId: group.id, totalMinor: toBig(input.budgetMinor), currency: input.currency } });
    }
    await logActivity(tx, {
      groupId: group.id,
      actorUserId: user.id,
      actorName: user.name,
      type: 'GROUP_CREATED',
      entityType: 'group',
      entityId: group.id,
      summary: `${user.name} created the group`,
    });
    return { group, invites };
  });

  res.status(201).json({ group: await groupCard(result.group.id, user.id), invitations: result.invites });
});

groupsRouter.get('/:groupId', async (req, res) => {
  const user = currentUser(req);
  const { group, member } = await requireGroup(req);
  const [members, categories, card] = await Promise.all([
    prisma.groupMember.findMany({ where: { groupId: group.id }, include: memberInclude, orderBy: { joinedAt: 'asc' } }),
    prisma.groupCategory.findMany({ where: { groupId: group.id }, orderBy: { label: 'asc' } }),
    groupCard(group.id, user.id),
  ]);
  res.json({
    group: {
      ...card,
      multiCurrency: group.multiCurrency,
      ownerId: group.ownerId,
      updatedAt: group.updatedAt.toISOString(),
    },
    role: member.role,
    myMemberId: member.id,
    members: members.map((m) => serializeMember(m, user.id)),
    categories: categories.map((c) => ({ id: c.id, label: c.label })),
  });
});

groupsRouter.patch('/:groupId', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'manageSettings');
  const input = parse(groupUpdateSchema, req.body);
  if (input.currency && input.currency !== group.currency) {
    const [expenses, settlements] = await Promise.all([
      prisma.expense.count({ where: { groupId: group.id } }),
      prisma.settlement.count({ where: { groupId: group.id } }),
    ]);
    if (expenses + settlements > 0) {
      throw conflict('The group currency cannot change after expenses or settlements have been recorded.');
    }
  }
  const updated = await prisma.$transaction(async (tx) => {
    const g = await tx.group.update({
      where: { id: group.id },
      data: {
        name: input.name,
        description: input.description === undefined ? undefined : input.description,
        type: input.type,
        currency: input.currency,
        accent: input.accent,
        multiCurrency: input.multiCurrency,
        simplifyDebts: input.simplifyDebts,
      },
    });
    if (input.currency) await tx.budget.updateMany({ where: { groupId: group.id }, data: { currency: input.currency } });
    await logActivity(tx, {
      groupId: group.id,
      actorUserId: user.id,
      actorName: user.name,
      type: 'GROUP_UPDATED',
      entityType: 'group',
      entityId: group.id,
      summary:
        input.simplifyDebts !== undefined && input.simplifyDebts !== group.simplifyDebts
          ? `${user.name} turned ${input.simplifyDebts ? 'on' : 'off'} simplified debts`
          : `${user.name} updated the group details`,
    });
    return g;
  });
  res.json({ group: { id: updated.id } });
});

groupsRouter.post('/:groupId/archive', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'archiveGroup');
  await prisma.$transaction(async (tx) => {
    await tx.group.update({ where: { id: group.id }, data: { archivedAt: new Date() } });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'GROUP_ARCHIVED', entityType: 'group', entityId: group.id, summary: `${user.name} archived the group` });
  });
  res.json({ ok: true });
});

groupsRouter.post('/:groupId/restore', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'archiveGroup', { allowArchived: true });
  await prisma.$transaction(async (tx) => {
    await tx.group.update({ where: { id: group.id }, data: { archivedAt: null } });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'GROUP_RESTORED', entityType: 'group', entityId: group.id, summary: `${user.name} restored the group` });
  });
  res.json({ ok: true });
});

async function assertSettledUp(groupId: string, memberId: string, who: string) {
  const ledger = await loadGroupLedger(groupId);
  const balance = ledger.balances.find((b) => b.memberId === memberId);
  if (balance && balance.netMinor !== 0) {
    throw conflict(`${who} still ${balance.netMinor < 0 ? 'owe' : 'are owed'} money in this group. Settle up first.`, 'UNSETTLED');
  }
}

groupsRouter.post('/:groupId/leave', async (req, res) => {
  const user = currentUser(req);
  const { group, member } = await requireGroup(req, 'viewGroup', { allowArchived: true });
  if (member.role === 'OWNER') {
    const others = await prisma.groupMember.count({ where: { groupId: group.id, status: 'ACTIVE', userId: { not: null }, id: { not: member.id } } });
    if (others > 0) throw conflict('Transfer ownership to another member before leaving the group.', 'OWNER_MUST_TRANSFER');
  }
  await assertSettledUp(group.id, member.id, 'You');
  await prisma.$transaction(async (tx) => {
    await tx.groupMember.update({ where: { id: member.id }, data: { status: 'LEFT', leftAt: new Date() } });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'MEMBER_LEFT', entityType: 'member', entityId: member.id, summary: `${member.displayName} left the group` });
  });
  res.json({ ok: true });
});

// ---------- Categories ----------

groupsRouter.post('/:groupId/categories', async (req, res) => {
  const { group } = await requireGroup(req, 'editRecords');
  const { label } = parse(categoryCreateSchema, req.body);
  const count = await prisma.groupCategory.count({ where: { groupId: group.id } });
  if (count >= 30) throw conflict('A group can have at most 30 custom categories.');
  const existing = await prisma.groupCategory.findFirst({ where: { groupId: group.id, label: { equals: label, mode: 'insensitive' } } });
  if (existing) throw conflict('A category with this name already exists.');
  const category = await prisma.groupCategory.create({ data: { groupId: group.id, label } });
  res.status(201).json({ category: { id: category.id, label: category.label } });
});

// ---------- Members ----------

groupsRouter.post('/:groupId/members', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'manageMembers');
  if (group.directKey) throw conflict('Expenses with a friend are just between the two of you. Create a group to add more people.');
  const input = parse(memberCreateSchema, req.body);
  const active = await prisma.groupMember.count({ where: { groupId: group.id, status: 'ACTIVE' } });
  if (active >= 100) throw conflict('A group can have at most 100 members.');
  const result = await prisma.$transaction(async (tx) => {
    const member = await tx.groupMember.create({
      data: { groupId: group.id, displayName: input.displayName, email: input.email ?? null },
      include: memberInclude,
    });
    let inviteUrl: string | null = null;
    if (input.email) {
      const existingMember = await tx.groupMember.findFirst({
        where: { groupId: group.id, status: 'ACTIVE', user: { email: input.email } },
      });
      if (existingMember) throw conflict('Someone with this email is already in the group.');
      inviteUrl = (await createInvitation(tx, { groupId: group.id, groupName: group.name, email: input.email, role: 'MEMBER', memberId: member.id, inviter: user })).url;
    }
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'MEMBER_ADDED', entityType: 'member', entityId: member.id, summary: `${user.name} added ${member.displayName}` });
    return { member, inviteUrl };
  });
  res.status(201).json({ member: serializeMember(result.member, user.id), inviteUrl: result.inviteUrl });
});

groupsRouter.patch('/:groupId/members/:memberId', async (req, res) => {
  const user = currentUser(req);
  const { group, member: me } = await requireGroup(req, 'editRecords');
  const input = parse(memberUpdateSchema, req.body);
  const target = await prisma.groupMember.findFirst({ where: { id: param(req, 'memberId'), groupId: group.id } });
  if (!target) throw notFound('Member not found');

  if (input.displayName !== undefined && target.id !== me.id && !can(me.role, 'manageMembers')) throw forbidden();
  if (input.role !== undefined && input.role !== target.role) {
    if (!can(me.role, 'manageRoles')) throw forbidden('Only the group owner can change roles.');
    if (!target.userId || target.status !== 'ACTIVE') throw badRequest('Only active members with an account can have a role.');
    if (target.id === me.id) throw badRequest('Transfer ownership to someone else to change your own role.');
  }

  await prisma.$transaction(async (tx) => {
    if (input.role === 'OWNER' && target.role !== 'OWNER') {
      // Ownership transfer: the previous owner becomes an admin.
      await tx.groupMember.update({ where: { id: me.id }, data: { role: 'ADMIN' } });
      await tx.group.update({ where: { id: group.id }, data: { ownerId: target.userId! } });
    }
    await tx.groupMember.update({ where: { id: target.id }, data: { displayName: input.displayName, role: input.role } });
    const summary =
      input.role && input.role !== target.role
        ? `${user.name} changed ${target.displayName}'s role to ${ROLE_LABELS[input.role]}`
        : `${user.name} renamed ${target.displayName} to ${input.displayName}`;
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'MEMBER_UPDATED', entityType: 'member', entityId: target.id, summary });
  });
  res.json({ ok: true });
});

groupsRouter.delete('/:groupId/members/:memberId', async (req, res) => {
  const user = currentUser(req);
  const { group, member: me } = await requireGroup(req, 'manageMembers');
  const target = await prisma.groupMember.findFirst({ where: { id: param(req, 'memberId'), groupId: group.id, status: 'ACTIVE' } });
  if (!target) throw notFound('Member not found');
  if (target.role === 'OWNER') throw forbidden('The group owner cannot be removed.');
  if (target.id === me.id) throw badRequest('Use "Leave group" to remove yourself.');
  if (target.role === 'ADMIN' && me.role !== 'OWNER') throw forbidden('Only the owner can remove an admin.');
  await assertSettledUp(group.id, target.id, `${target.displayName}`);
  await prisma.$transaction(async (tx) => {
    await tx.groupMember.update({ where: { id: target.id }, data: { status: 'REMOVED', leftAt: new Date() } });
    await tx.groupInvitation.updateMany({ where: { memberId: target.id, status: 'PENDING' }, data: { status: 'REVOKED', respondedAt: new Date() } });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'MEMBER_REMOVED', entityType: 'member', entityId: target.id, summary: `${user.name} removed ${target.displayName}` });
  });
  res.json({ ok: true });
});

// ---------- Invitations (group side) ----------

async function createInvitation(
  tx: Tx,
  opts: { groupId: string; groupName: string; email: string; role: 'ADMIN' | 'MEMBER' | 'VIEWER'; memberId: string | null; inviter: User },
) {
  // A new invitation replaces any pending one for the same email.
  await tx.groupInvitation.updateMany({
    where: { groupId: opts.groupId, email: opts.email, status: 'PENDING' },
    data: { status: 'REVOKED', respondedAt: new Date() },
  });
  const token = randomToken();
  const invitation = await tx.groupInvitation.create({
    data: {
      groupId: opts.groupId,
      tokenHash: sha256(token),
      email: opts.email,
      role: opts.role,
      memberId: opts.memberId,
      invitedById: opts.inviter.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  const invitee = await tx.user.findUnique({ where: { email: opts.email } });
  if (invitee) {
    await notifyUser(tx, invitee.id, {
      groupId: opts.groupId,
      type: 'INVITATION',
      title: 'Group invitation',
      body: `${opts.inviter.name} invited you to join ${opts.groupName}`,
      link: '/notifications?tab=invitations',
    });
  }
  return { invitation, url: `${env.appUrl}/invite/${token}` };
}

function serializeInvitation(i: GroupInvitation) {
  const expired = i.status === 'PENDING' && i.expiresAt < new Date();
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    memberId: i.memberId,
    status: expired ? 'EXPIRED' : i.status,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
  };
}

groupsRouter.get('/:groupId/invitations', async (req, res) => {
  const { group } = await requireGroup(req, 'manageMembers', { allowArchived: true });
  const invitations = await prisma.groupInvitation.findMany({ where: { groupId: group.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ invitations: invitations.map(serializeInvitation) });
});

groupsRouter.post('/:groupId/invitations', async (req, res) => {
  const user = currentUser(req);
  const { group, member } = await requireGroup(req, 'manageMembers');
  if (group.directKey) throw conflict('Expenses with a friend are just between the two of you. Create a group to add more people.');
  const input = parse(invitationCreateSchema, req.body);
  if (input.role === 'ADMIN' && member.role !== 'OWNER') throw forbidden('Only the owner can invite admins.');
  const alreadyMember = await prisma.groupMember.findFirst({ where: { groupId: group.id, status: 'ACTIVE', user: { email: input.email } } });
  if (alreadyMember) throw conflict('This person is already a member of the group.');
  if (input.memberId) {
    const placeholder = await prisma.groupMember.findFirst({ where: { id: input.memberId, groupId: group.id, status: 'ACTIVE', userId: null } });
    if (!placeholder) throw badRequest('That member already has an account or is not in this group.');
  }
  const result = await prisma.$transaction(async (tx) => {
    const r = await createInvitation(tx, { groupId: group.id, groupName: group.name, email: input.email, role: input.role, memberId: input.memberId ?? null, inviter: user });
    if (input.memberId) await tx.groupMember.update({ where: { id: input.memberId }, data: { email: input.email } });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'INVITATION_SENT', entityType: 'invitation', entityId: r.invitation.id, summary: `${user.name} invited ${input.email}` });
    return r;
  });
  res.status(201).json({ invitation: serializeInvitation(result.invitation), inviteUrl: result.url });
});

groupsRouter.post('/:groupId/invitations/:invitationId/revoke', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'manageMembers', { allowArchived: true });
  const invitation = await prisma.groupInvitation.findFirst({ where: { id: param(req, 'invitationId'), groupId: group.id } });
  if (!invitation) throw notFound('Invitation not found');
  if (invitation.status !== 'PENDING') throw conflict('Only pending invitations can be revoked.');
  await prisma.$transaction(async (tx) => {
    await tx.groupInvitation.update({ where: { id: invitation.id }, data: { status: 'REVOKED', respondedAt: new Date() } });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'INVITATION_REVOKED', entityType: 'invitation', entityId: invitation.id, summary: `${user.name} revoked the invitation for ${invitation.email}` });
  });
  res.json({ ok: true });
});

// ---------- Invitations (invitee side) ----------

async function loadInvitationForUser(where: { tokenHash: string } | { id: string }, user: User) {
  const invitation = await prisma.groupInvitation.findFirst({
    where,
    include: { group: { select: { id: true, name: true, type: true, archivedAt: true } }, invitedBy: { select: { name: true } } },
  });
  if (!invitation) throw notFound('Invitation not found');
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    throw forbidden(`This invitation was sent to a different email address. Sign in as ${maskEmail(invitation.email)} to accept it.`);
  }
  return invitation;
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

async function respond(invitationId: string, user: User, accept: boolean) {
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.groupInvitation.findUniqueOrThrow({ where: { id: invitationId }, include: { group: true } });
    if (invitation.status !== 'PENDING') throw conflict(`This invitation has already been ${invitation.status.toLowerCase()}.`);
    if (invitation.expiresAt < new Date()) throw conflict('This invitation has expired. Ask a group admin for a new one.', 'EXPIRED');
    if (invitation.group.archivedAt) throw conflict('This group has been archived.');
    if (!accept) {
      await tx.groupInvitation.update({ where: { id: invitation.id }, data: { status: 'DECLINED', respondedAt: new Date() } });
      return { groupId: invitation.groupId };
    }

    const existing = await tx.groupMember.findFirst({ where: { groupId: invitation.groupId, userId: user.id } });
    let memberId: string;
    if (existing) {
      await tx.groupMember.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', leftAt: null, role: existing.status === 'ACTIVE' ? existing.role : invitation.role },
      });
      memberId = existing.id;
    } else {
      const placeholder = invitation.memberId
        ? await tx.groupMember.findFirst({ where: { id: invitation.memberId, userId: null, status: 'ACTIVE' } })
        : null;
      if (placeholder) {
        // Claim the placeholder so the member's existing expense history becomes theirs.
        await tx.groupMember.update({ where: { id: placeholder.id }, data: { userId: user.id, role: invitation.role, email: user.email } });
        memberId = placeholder.id;
      } else {
        const created = await tx.groupMember.create({
          data: { groupId: invitation.groupId, userId: user.id, displayName: user.name, email: user.email, role: invitation.role },
        });
        memberId = created.id;
      }
    }
    await tx.groupInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id, respondedAt: new Date() },
    });
    await logActivity(tx, { groupId: invitation.groupId, actorUserId: user.id, actorName: user.name, type: 'MEMBER_JOINED', entityType: 'member', entityId: memberId, summary: `${user.name} joined the group` });
    await notifyGroup(tx, {
      groupId: invitation.groupId,
      type: 'MEMBER_JOINED',
      title: 'New member',
      body: `${user.name} joined ${invitation.group.name}`,
      link: `/groups/${invitation.groupId}/members`,
      excludeUserIds: [user.id],
    });
    return { groupId: invitation.groupId };
  });
}

invitationsRouter.get('/token/:token', async (req, res) => {
  const user = currentUser(req);
  const invitation = await loadInvitationForUser({ tokenHash: sha256(param(req, 'token')) }, user).catch((err: unknown) => {
    if (err instanceof Error && 'status' in err && err.status === 403) throw err;
    throw notFound('This invitation link is invalid.');
  });
  res.json({
    invitation: {
      ...serializeInvitation(invitation),
      groupId: invitation.group.id,
      groupName: invitation.group.name,
      groupType: invitation.group.type,
      invitedByName: invitation.invitedBy.name,
    },
  });
});

invitationsRouter.post('/token/:token/:action', async (req, res) => {
  const user = currentUser(req);
  const action = param(req, 'action');
  if (action !== 'accept' && action !== 'decline') throw notFound();
  const invitation = await loadInvitationForUser({ tokenHash: sha256(param(req, 'token')) }, user);
  res.json(await respond(invitation.id, user, action === 'accept'));
});

/** Pending invitations addressed to the signed-in user's email (in-app accept/decline). */
invitationsRouter.get('/mine', async (req, res) => {
  const user = currentUser(req);
  const invitations = await prisma.groupInvitation.findMany({
    where: { email: user.email.toLowerCase(), status: 'PENDING', expiresAt: { gt: new Date() }, group: { archivedAt: null } },
    include: { group: { select: { id: true, name: true, type: true } }, invitedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    invitations: invitations.map((i) => ({
      ...serializeInvitation(i),
      groupId: i.group.id,
      groupName: i.group.name,
      groupType: i.group.type,
      invitedByName: i.invitedBy.name,
    })),
  });
});

invitationsRouter.post('/:invitationId/:action', async (req, res) => {
  const user = currentUser(req);
  const action = param(req, 'action');
  if (action !== 'accept' && action !== 'decline') throw notFound();
  const invitation = await loadInvitationForUser({ id: param(req, 'invitationId') }, user);
  res.json(await respond(invitation.id, user, action === 'accept'));
});

export { groupCard };

