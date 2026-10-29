import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import {
  can,
  checklistItemSchema,
  checklistUpdateSchema,
  formatMoney,
  itineraryItemSchema,
  PLAN_STATUS_LABELS,
  planSchema,
  pollSchema,
  reorderSchema,
  voteSchema,
} from '@sharespace/core';
import { fromDateOnly, fromDateOnlyOrNull, prisma, toBig, toDateOnly, todayIso, toNum, toNumOrNull, type Tx } from '../db';
import { accessibleGroupIds, assertMembersInGroup, requireGroup } from '../lib/access';
import { currentUser } from '../lib/auth';
import { logActivity, notifyGroup } from '../lib/events';
import { badRequest, conflict, forbidden, notFound, param, parse } from '../lib/http';
import { expenseListInclude, serializeExpenseSummary } from '../lib/serialize';

export const groupPlansRouter = Router({ mergeParams: true });
export const groupPollsRouter = Router({ mergeParams: true });
export const plansRouter = Router();

const planListInclude = {
  participants: { select: { memberId: true } },
  checklist: { select: { completedAt: true } },
  _count: { select: { itinerary: true } },
  expenses: { where: { deletedAt: null }, select: { amountMinor: true } },
} satisfies Prisma.PlanInclude;

function serializePlanSummary(p: Prisma.PlanGetPayload<{ include: typeof planListInclude }>) {
  return {
    id: p.id,
    groupId: p.groupId,
    title: p.title,
    description: p.description,
    type: p.type,
    status: p.status,
    startDate: fromDateOnly(p.startDate),
    endDate: fromDateOnlyOrNull(p.endDate),
    location: p.location,
    estimatedBudgetMinor: toNumOrNull(p.estimatedBudgetMinor),
    participantIds: p.participants.map((x) => x.memberId),
    actualSpendingMinor: p.expenses.reduce((a, e) => a + toNum(e.amountMinor), 0),
    expenseCount: p.expenses.length,
    checklistDone: p.checklist.filter((c) => c.completedAt).length,
    checklistTotal: p.checklist.length,
    itineraryCount: p._count.itinerary,
    createdById: p.createdById,
    createdAt: p.createdAt.toISOString(),
  };
}

async function loadPlan(groupId: string, planId: string) {
  const plan = await prisma.plan.findFirst({ where: { id: planId, groupId, archivedAt: null } });
  if (!plan) throw notFound('Plan not found');
  return plan;
}

groupPlansRouter.get('/', async (req, res) => {
  const { group } = await requireGroup(req);
  const plans = await prisma.plan.findMany({
    where: { groupId: group.id, archivedAt: null },
    include: planListInclude,
    orderBy: [{ startDate: 'asc' }],
  });
  res.json({ plans: plans.map(serializePlanSummary) });
});

groupPlansRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const input = parse(planSchema, req.body);
  await assertMembersInGroup(group.id, input.participantIds);
  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.plan.create({
      data: {
        groupId: group.id,
        title: input.title,
        description: input.description,
        type: input.type,
        status: input.status,
        startDate: toDateOnly(input.startDate),
        endDate: input.endDate ? toDateOnly(input.endDate) : null,
        location: input.location,
        estimatedBudgetMinor: input.estimatedBudgetMinor ? toBig(input.estimatedBudgetMinor) : null,
        notes: input.notes,
        createdById: user.id,
        participants: { create: input.participantIds.map((memberId) => ({ memberId })) },
      },
      include: planListInclude,
    });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'PLAN_CREATED', entityType: 'plan', entityId: created.id, planId: created.id, summary: `${user.name} created the plan "${created.title}"` });
    return created;
  });
  res.status(201).json({ plan: serializePlanSummary(plan) });
});

groupPlansRouter.get('/:planId', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req);
  const plan = await prisma.plan.findFirst({
    where: { id: param(req, 'planId'), groupId: group.id, archivedAt: null },
    include: {
      ...planListInclude,
      itinerary: { orderBy: { position: 'asc' } },
      checklist: { orderBy: { position: 'asc' } },
    },
  });
  if (!plan) throw notFound('Plan not found');
  const [expenses, activity, polls] = await Promise.all([
    prisma.expense.findMany({ where: { planId: plan.id, deletedAt: null }, include: expenseListInclude, orderBy: [{ date: 'desc' }] }),
    prisma.activityLog.findMany({ where: { groupId: group.id, planId: plan.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    listPolls(group.id, user.id, plan.id),
  ]);
  res.json({
    plan: {
      ...serializePlanSummary({ ...plan, checklist: plan.checklist }),
      notes: plan.notes,
      itinerary: plan.itinerary.map((i) => ({
        id: i.id,
        position: i.position,
        title: i.title,
        description: i.description,
        date: fromDateOnlyOrNull(i.date),
        startTime: i.startTime,
        endTime: i.endTime,
        location: i.location,
        estimatedCostMinor: toNumOrNull(i.estimatedCostMinor),
        notes: i.notes,
      })),
      checklist: plan.checklist.map((c) => ({
        id: c.id,
        position: c.position,
        title: c.title,
        assigneeMemberId: c.assigneeMemberId,
        dueDate: fromDateOnlyOrNull(c.dueDate),
        completedAt: c.completedAt?.toISOString() ?? null,
        completedById: c.completedById,
      })),
      expenses: expenses.map(serializeExpenseSummary),
      activity: activity.map(serializeActivity),
      polls,
    },
  });
});

groupPlansRouter.put('/:planId', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const existing = await loadPlan(group.id, param(req, 'planId'));
  const input = parse(planSchema, req.body);
  await assertMembersInGroup(group.id, input.participantIds, { allowInactive: input.participantIds });
  await prisma.$transaction(async (tx) => {
    await tx.plan.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        description: input.description,
        type: input.type,
        status: input.status,
        startDate: toDateOnly(input.startDate),
        endDate: input.endDate ? toDateOnly(input.endDate) : null,
        location: input.location,
        estimatedBudgetMinor: input.estimatedBudgetMinor ? toBig(input.estimatedBudgetMinor) : null,
        notes: input.notes,
      },
    });
    await tx.planParticipant.deleteMany({ where: { planId: existing.id } });
    await tx.planParticipant.createMany({ data: input.participantIds.map((memberId) => ({ planId: existing.id, memberId })) });
    const statusChanged = existing.status !== input.status;
    await logActivity(tx, {
      groupId: group.id,
      actorUserId: user.id,
      actorName: user.name,
      type: 'PLAN_UPDATED',
      entityType: 'plan',
      entityId: existing.id,
      planId: existing.id,
      summary: statusChanged
        ? `${user.name} marked "${input.title}" as ${PLAN_STATUS_LABELS[input.status].toLowerCase()}`
        : `${user.name} updated the plan "${input.title}"`,
    });
  });
  res.json({ ok: true });
});

groupPlansRouter.delete('/:planId', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const plan = await loadPlan(group.id, param(req, 'planId'));
  await prisma.$transaction(async (tx) => {
    // Archive rather than delete: linked expenses keep their history.
    await tx.plan.update({ where: { id: plan.id }, data: { archivedAt: new Date() } });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'PLAN_ARCHIVED', entityType: 'plan', entityId: plan.id, planId: plan.id, summary: `${user.name} removed the plan "${plan.title}"` });
  });
  res.json({ ok: true });
});

// ---------- Itinerary ----------

function itineraryData(input: ReturnType<typeof itineraryItemSchema.parse>) {
  return {
    title: input.title,
    description: input.description,
    date: input.date ? toDateOnly(input.date) : null,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    location: input.location,
    estimatedCostMinor: input.estimatedCostMinor ? toBig(input.estimatedCostMinor) : null,
    notes: input.notes,
  };
}

groupPlansRouter.post('/:planId/itinerary', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const plan = await loadPlan(group.id, param(req, 'planId'));
  const input = parse(itineraryItemSchema, req.body);
  const count = await prisma.itineraryItem.count({ where: { planId: plan.id } });
  if (count >= 200) throw conflict('A plan can have at most 200 itinerary items.');
  const item = await prisma.itineraryItem.create({ data: { planId: plan.id, position: count, ...itineraryData(input) } });
  await logActivity(prisma, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'ITINERARY_ADDED', entityType: 'plan', entityId: plan.id, planId: plan.id, summary: `${user.name} added "${item.title}" to the itinerary` });
  res.status(201).json({ id: item.id });
});

groupPlansRouter.put('/:planId/itinerary/:itemId', async (req, res) => {
  const { group } = await requireGroup(req, 'editRecords');
  const plan = await loadPlan(group.id, param(req, 'planId'));
  const input = parse(itineraryItemSchema, req.body);
  const { count } = await prisma.itineraryItem.updateMany({ where: { id: param(req, 'itemId'), planId: plan.id }, data: itineraryData(input) });
  if (count === 0) throw notFound('Itinerary item not found');
  res.json({ ok: true });
});

groupPlansRouter.delete('/:planId/itinerary/:itemId', async (req, res) => {
  const { group } = await requireGroup(req, 'editRecords');
  const plan = await loadPlan(group.id, param(req, 'planId'));
  const { count } = await prisma.itineraryItem.deleteMany({ where: { id: param(req, 'itemId'), planId: plan.id } });
  if (count === 0) throw notFound('Itinerary item not found');
  res.json({ ok: true });
});

async function reorder(tx: Tx, model: 'itineraryItem' | 'checklistItem', planId: string, ids: string[]) {
  const existing =
    model === 'itineraryItem'
      ? await tx.itineraryItem.findMany({ where: { planId }, select: { id: true } })
      : await tx.checklistItem.findMany({ where: { planId }, select: { id: true } });
  const known = new Set(existing.map((e) => e.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) {
    throw badRequest('The order must include every item exactly once. Reload and try again.');
  }
  for (const [position, id] of ids.entries()) {
    if (model === 'itineraryItem') await tx.itineraryItem.update({ where: { id }, data: { position } });
    else await tx.checklistItem.update({ where: { id }, data: { position } });
  }
}

groupPlansRouter.post('/:planId/itinerary/reorder', async (req, res) => {
  const { group } = await requireGroup(req, 'editRecords');
  const plan = await loadPlan(group.id, param(req, 'planId'));
  const { ids } = parse(reorderSchema, req.body);
  await prisma.$transaction((tx) => reorder(tx, 'itineraryItem', plan.id, ids));
  res.json({ ok: true });
});

// ---------- Checklist ----------

groupPlansRouter.post('/:planId/checklist', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const plan = await loadPlan(group.id, param(req, 'planId'));
  const input = parse(checklistItemSchema, req.body);
  if (input.assigneeMemberId) await assertMembersInGroup(group.id, [input.assigneeMemberId]);
  const count = await prisma.checklistItem.count({ where: { planId: plan.id } });
  if (count >= 300) throw conflict('A plan can have at most 300 checklist items.');
  const item = await prisma.checklistItem.create({
    data: {
      planId: plan.id,
      position: count,
      title: input.title,
      assigneeMemberId: input.assigneeMemberId ?? null,
      dueDate: input.dueDate ? toDateOnly(input.dueDate) : null,
      createdById: user.id,
    },
  });
  await logActivity(prisma, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'CHECKLIST_ADDED', entityType: 'plan', entityId: plan.id, planId: plan.id, summary: `${user.name} added the task "${item.title}"` });
  res.status(201).json({ id: item.id });
});

groupPlansRouter.patch('/:planId/checklist/:itemId', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const plan = await loadPlan(group.id, param(req, 'planId'));
  const input = parse(checklistUpdateSchema, req.body);
  const item = await prisma.checklistItem.findFirst({ where: { id: param(req, 'itemId'), planId: plan.id } });
  if (!item) throw notFound('Task not found');
  if (input.assigneeMemberId) await assertMembersInGroup(group.id, [input.assigneeMemberId]);
  await prisma.$transaction(async (tx) => {
    const completing = input.completed === true && !item.completedAt;
    const reopening = input.completed === false && !!item.completedAt;
    await tx.checklistItem.update({
      where: { id: item.id },
      data: {
        title: input.title,
        assigneeMemberId: input.assigneeMemberId === undefined ? undefined : input.assigneeMemberId,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? toDateOnly(input.dueDate) : null,
        ...(completing ? { completedAt: new Date(), completedById: user.id } : {}),
        ...(reopening ? { completedAt: null, completedById: null } : {}),
      },
    });
    if (completing || reopening) {
      // Completion history lives in the plan's activity log.
      await logActivity(tx, {
        groupId: group.id,
        actorUserId: user.id,
        actorName: user.name,
        type: completing ? 'CHECKLIST_COMPLETED' : 'CHECKLIST_REOPENED',
        entityType: 'checklist',
        entityId: item.id,
        planId: plan.id,
        summary: `${user.name} ${completing ? 'completed' : 'reopened'} "${input.title ?? item.title}"`,
      });
    }
  });
  res.json({ ok: true });
});

groupPlansRouter.delete('/:planId/checklist/:itemId', async (req, res) => {
  const { group } = await requireGroup(req, 'editRecords');
  const plan = await loadPlan(group.id, param(req, 'planId'));
  const { count } = await prisma.checklistItem.deleteMany({ where: { id: param(req, 'itemId'), planId: plan.id } });
  if (count === 0) throw notFound('Task not found');
  res.json({ ok: true });
});

groupPlansRouter.post('/:planId/checklist/reorder', async (req, res) => {
  const { group } = await requireGroup(req, 'editRecords');
  const plan = await loadPlan(group.id, param(req, 'planId'));
  const { ids } = parse(reorderSchema, req.body);
  await prisma.$transaction((tx) => reorder(tx, 'checklistItem', plan.id, ids));
  res.json({ ok: true });
});

// ---------- Global plans ----------

plansRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const groupIds = await accessibleGroupIds(user.id);
  const plans = await prisma.plan.findMany({
    where: { groupId: { in: groupIds }, archivedAt: null },
    include: { ...planListInclude, group: { select: { name: true, accent: true, currency: true } } },
    orderBy: [{ startDate: 'asc' }],
  });
  res.json({
    plans: plans.map((p) => ({ ...serializePlanSummary(p), groupName: p.group.name, groupAccent: p.group.accent, currency: p.group.currency })),
  });
});

// ---------- Activity ----------

export function serializeActivity(a: Prisma.ActivityLogGetPayload<object>) {
  return {
    id: a.id,
    groupId: a.groupId,
    actorUserId: a.actorUserId,
    actorName: a.actorName,
    type: a.type,
    entityType: a.entityType,
    entityId: a.entityId,
    planId: a.planId,
    summary: a.summary,
    createdAt: a.createdAt.toISOString(),
  };
}

// ---------- Polls ----------

const pollInclude = {
  options: { orderBy: { position: 'asc' }, include: { _count: { select: { votes: true } } } },
  votes: { select: { memberId: true, optionId: true } },
  eligible: { select: { memberId: true } },
} satisfies Prisma.PollInclude;

/** Polls whose closing time has passed are closed (lazily, on read) and their outcome is logged once. */
async function finalizeExpiredPolls(groupId: string) {
  const expired = await prisma.poll.findMany({
    where: { groupId, closedAt: null, closesAt: { lte: new Date() } },
    include: pollInclude,
  });
  for (const poll of expired) {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.poll.updateMany({ where: { id: poll.id, closedAt: null }, data: { closedAt: poll.closesAt } });
      if (count === 0) return;
      await recordOutcome(tx, poll, null);
    });
  }
}

async function recordOutcome(tx: Tx, poll: Prisma.PollGetPayload<{ include: typeof pollInclude }>, actor: { id: string; name: string } | null) {
  const max = Math.max(0, ...poll.options.map((o) => o._count.votes));
  const winners = max > 0 ? poll.options.filter((o) => o._count.votes === max).map((o) => o.label) : [];
  const outcome = winners.length === 0 ? 'no votes were cast' : winners.length === 1 ? `"${winners[0]}" won with ${max} vote${max === 1 ? '' : 's'}` : `tie between ${winners.map((w) => `"${w}"`).join(' and ')}`;
  await logActivity(tx, {
    groupId: poll.groupId,
    actorUserId: actor?.id ?? null,
    actorName: actor?.name ?? 'ShareSpace',
    type: 'POLL_CLOSED',
    entityType: 'poll',
    entityId: poll.id,
    planId: poll.planId,
    summary: `Poll closed: "${poll.question}" — ${outcome}`,
  });
  await notifyGroup(tx, {
    groupId: poll.groupId,
    type: 'POLL_CLOSED',
    title: 'Poll closed',
    body: `"${poll.question}" — ${outcome}`,
    link: poll.planId ? `/groups/${poll.groupId}/plans/${poll.planId}` : `/groups/${poll.groupId}/plans?tab=decisions`,
    excludeUserIds: actor ? [actor.id] : [],
  });
}

async function listPolls(groupId: string, userId: string, planId?: string) {
  await finalizeExpiredPolls(groupId);
  const [polls, me] = await Promise.all([
    prisma.poll.findMany({ where: { groupId, ...(planId ? { planId } : {}) }, include: pollInclude, orderBy: { createdAt: 'desc' } }),
    prisma.groupMember.findFirst({ where: { groupId, userId, status: 'ACTIVE' } }),
  ]);
  return polls.map((p) => {
    const eligibleIds = p.eligible.map((e) => e.memberId);
    const myVote = p.votes.find((v) => v.memberId === me?.id)?.optionId ?? null;
    const closed = !!p.closedAt;
    const eligible = !!me && can(me.role, 'editRecords') && (eligibleIds.length === 0 || eligibleIds.includes(me.id));
    return {
      id: p.id,
      groupId: p.groupId,
      planId: p.planId,
      question: p.question,
      closesAt: p.closesAt?.toISOString() ?? null,
      closedAt: p.closedAt?.toISOString() ?? null,
      allowVoteChange: p.allowVoteChange,
      createdById: p.createdById,
      createdAt: p.createdAt.toISOString(),
      eligibleMemberIds: eligibleIds,
      totalVotes: p.votes.length,
      options: p.options.map((o) => ({ id: o.id, label: o.label, votes: o._count.votes })),
      myVote,
      canVote: !closed && eligible && (myVote === null || p.allowVoteChange),
      isEligible: eligible,
    };
  });
}

groupPollsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req);
  const planId = typeof req.query.planId === 'string' ? req.query.planId : undefined;
  res.json({ polls: await listPolls(group.id, user.id, planId) });
});

groupPollsRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const input = parse(pollSchema, req.body);
  if (input.closesAt && new Date(input.closesAt) <= new Date()) throw badRequest('The closing time must be in the future.');
  if (input.planId) await loadPlan(group.id, input.planId);
  await assertMembersInGroup(group.id, input.eligibleMemberIds);
  const poll = await prisma.$transaction(async (tx) => {
    const created = await tx.poll.create({
      data: {
        groupId: group.id,
        planId: input.planId ?? null,
        question: input.question,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        allowVoteChange: input.allowVoteChange,
        createdById: user.id,
        options: { create: input.options.map((label, position) => ({ label, position })) },
        eligible: { create: input.eligibleMemberIds.map((memberId) => ({ memberId })) },
      },
    });
    await logActivity(tx, { groupId: group.id, actorUserId: user.id, actorName: user.name, type: 'POLL_CREATED', entityType: 'poll', entityId: created.id, planId: created.planId, summary: `${user.name} started a poll: "${created.question}"` });
    await notifyGroup(tx, {
      groupId: group.id,
      type: 'POLL_DEADLINE',
      title: 'New poll',
      body: `${user.name} asked: "${created.question}"`,
      link: created.planId ? `/groups/${group.id}/plans/${created.planId}` : `/groups/${group.id}/plans?tab=decisions`,
      excludeUserIds: [user.id],
    });
    return created;
  });
  res.status(201).json({ id: poll.id });
});

async function loadPollForVote(req: import('express').Request) {
  const user = currentUser(req);
  const { group, member } = await requireGroup(req, 'editRecords');
  await finalizeExpiredPolls(group.id);
  const poll = await prisma.poll.findFirst({ where: { id: param(req, 'pollId'), groupId: group.id }, include: pollInclude });
  if (!poll) throw notFound('Poll not found');
  return { user, group, member, poll };
}

groupPollsRouter.post('/:pollId/vote', async (req, res) => {
  const { member, poll } = await loadPollForVote(req);
  const { optionId } = parse(voteSchema, req.body);
  if (poll.closedAt) throw conflict('This poll is closed.');
  const eligibleIds = poll.eligible.map((e) => e.memberId);
  if (eligibleIds.length > 0 && !eligibleIds.includes(member.id)) throw forbidden('You are not eligible to vote in this poll.');
  if (!poll.options.some((o) => o.id === optionId)) throw badRequest('Choose one of the poll options.');
  const existing = poll.votes.find((v) => v.memberId === member.id);
  if (existing && !poll.allowVoteChange) throw conflict('Votes cannot be changed in this poll.');
  // One row per member per poll (unique constraint) prevents duplicate votes.
  await prisma.pollVote.upsert({
    where: { pollId_memberId: { pollId: poll.id, memberId: member.id } },
    create: { pollId: poll.id, memberId: member.id, optionId },
    update: { optionId },
  });
  res.json({ ok: true });
});

groupPollsRouter.delete('/:pollId/vote', async (req, res) => {
  const { member, poll } = await loadPollForVote(req);
  if (poll.closedAt) throw conflict('This poll is closed.');
  if (!poll.allowVoteChange) throw conflict('Votes cannot be changed in this poll.');
  await prisma.pollVote.deleteMany({ where: { pollId: poll.id, memberId: member.id } });
  res.json({ ok: true });
});

groupPollsRouter.post('/:pollId/close', async (req, res) => {
  const { user, member, poll } = await loadPollForVote(req);
  if (poll.closedAt) throw conflict('This poll is already closed.');
  if (poll.createdById !== user.id && !can(member.role, 'manageSettings')) throw forbidden('Only the poll creator or an admin can close it.');
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.poll.updateMany({ where: { id: poll.id, closedAt: null }, data: { closedAt: new Date(), closedById: user.id } });
    if (count === 0) throw conflict('This poll is already closed.');
    await recordOutcome(tx, poll, user);
  });
  res.json({ ok: true });
});

export { listPolls, finalizeExpiredPolls };
