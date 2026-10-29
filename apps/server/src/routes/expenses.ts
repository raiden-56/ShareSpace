import { Router, type Request } from 'express';
import multer from 'multer';
import { Prisma, type Group } from '@prisma/client';
import {
  categoryLabel,
  commentSchema,
  expenseQuerySchema,
  expenseSchema,
  expenseUpdateSchema,
  formatMoney,
  minorToDecimalString,
  getCurrency,
  toCsv,
} from '@sharespace/core';
import { fromDateOnly, prisma, toBig, toDateOnly, toNum } from '../db';
import { accessibleGroupIds, requireGroup } from '../lib/access';
import { currentUser } from '../lib/auth';
import { logActivity, notifyGroup } from '../lib/events';
import { checkBudgetAlert, describeChanges, prepareExpense, writeExpenseChildren } from '../lib/expense-write';
import { badRequest, conflict, forbidden, notFound, param, parse } from '../lib/http';
import {
  expenseDetailInclude,
  expenseListInclude,
  expenseSnapshot,
  serializeExpenseDetail,
  serializeExpenseSummary,
} from '../lib/serialize';
import { detectFileType, MAX_UPLOAD_BYTES, openFile, removeFile, sanitizeFileName, saveFile, fileExists } from '../lib/storage';

export const groupExpensesRouter = Router({ mergeParams: true });
export const expensesRouter = Router();
export const attachmentsRouter = Router();

// ---------- Query building (shared by group list, global list and CSV export) ----------

type ExpenseQueryParsed = ReturnType<typeof expenseQuerySchema.parse>;

function buildWhere(groupIds: string[], q: ExpenseQueryParsed, userId: string): Prisma.ExpenseWhereInput {
  const and: Prisma.ExpenseWhereInput[] = [{ groupId: { in: groupIds } }];
  and.push(q.deleted === 'true' ? { deletedAt: { not: null } } : { deletedAt: null });
  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: 'insensitive' } },
        { description: { contains: q.q, mode: 'insensitive' } },
        { notes: { contains: q.q, mode: 'insensitive' } },
      ],
    });
  }
  if (q.from) and.push({ date: { gte: toDateOnly(q.from) } });
  if (q.to) and.push({ date: { lte: toDateOnly(q.to) } });
  if (q.minAmount !== undefined) and.push({ amountMinor: { gte: toBig(q.minAmount) } });
  if (q.maxAmount !== undefined) and.push({ amountMinor: { lte: toBig(q.maxAmount) } });
  if (q.category) and.push({ category: q.category });
  if (q.payerId) and.push({ payers: { some: { memberId: q.payerId } } });
  if (q.participantId) and.push({ splits: { some: { memberId: q.participantId } } });
  if (q.planId) and.push({ planId: q.planId });
  if (q.involvesMe === 'true') {
    and.push({
      OR: [{ payers: { some: { member: { userId } } } }, { splits: { some: { member: { userId } } } }],
    });
  }
  return { AND: and };
}

function orderBy(q: ExpenseQueryParsed): Prisma.ExpenseOrderByWithRelationInput[] {
  const dir = q.order;
  switch (q.sort) {
    case 'amount':
      return [{ amountMinor: dir }, { date: 'desc' }, { id: 'asc' }];
    case 'category':
      return [{ category: dir }, { date: 'desc' }, { id: 'asc' }];
    case 'created':
      return [{ createdAt: dir }, { id: 'asc' }];
    default:
      return [{ date: dir }, { createdAt: dir }, { id: 'asc' }];
  }
}

async function listExpenses(groupIds: string[], q: ExpenseQueryParsed, userId: string) {
  const where = buildWhere(groupIds, q, userId);
  if (q.sort === 'payer') {
    // Sorting by payer name needs the member names, so it is done in memory (bounded).
    const rows = await prisma.expense.findMany({ where, include: expenseListInclude, take: 5000, orderBy: [{ date: 'desc' }] });
    const memberIds = [...new Set(rows.flatMap((r) => r.payers.map((p) => p.memberId)))];
    const names = new Map(
      (await prisma.groupMember.findMany({ where: { id: { in: memberIds } }, select: { id: true, displayName: true } })).map((m) => [m.id, m.displayName]),
    );
    const key = (r: (typeof rows)[number]) => names.get(r.payers[0]?.memberId ?? '') ?? '';
    rows.sort((a, b) => key(a).localeCompare(key(b)) * (q.order === 'asc' ? 1 : -1));
    const start = (q.page - 1) * q.pageSize;
    return { items: rows.slice(start, start + q.pageSize).map(serializeExpenseSummary), total: rows.length };
  }
  const [rows, total] = await Promise.all([
    prisma.expense.findMany({ where, include: expenseListInclude, orderBy: orderBy(q), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.expense.count({ where }),
  ]);
  return { items: rows.map(serializeExpenseSummary), total };
}

// ---------- Group-scoped routes ----------

groupExpensesRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req);
  const q = parse(expenseQuerySchema, req.query);
  const result = await listExpenses([group.id], q, user.id);
  res.json({ ...result, page: q.page, pageSize: q.pageSize });
});

groupExpensesRouter.get('/export.csv', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req);
  const q = parse(expenseQuerySchema, { ...req.query, page: 1, pageSize: 100 });
  const rows = await prisma.expense.findMany({
    where: buildWhere([group.id], q, user.id),
    include: { ...expenseListInclude, plan: { select: { title: true } } },
    orderBy: orderBy(q),
    take: 20000,
  });
  const [members, categories] = await Promise.all([
    prisma.groupMember.findMany({ where: { groupId: group.id }, orderBy: { joinedAt: 'asc' } }),
    prisma.groupCategory.findMany({ where: { groupId: group.id } }),
  ]);
  const name = new Map(members.map((m) => [m.id, m.displayName]));
  const dec = getCurrency(group.currency).decimals;
  const amt = (minor: number) => minorToDecimalString(minor, dec);
  const headers = [
    'Date', 'Title', 'Category', 'Plan', `Amount (${group.currency})`, 'Original amount', 'Original currency', 'Exchange rate',
    'Paid by', 'Split method', 'Shares',
    ...members.flatMap((m) => [`${m.displayName} paid`, `${m.displayName} share`]),
  ];
  const data = rows.map((e) => {
    const paid = new Map(e.payers.map((p) => [p.memberId, toNum(p.amountMinor)]));
    const share = new Map(e.splits.map((s) => [s.memberId, toNum(s.amountMinor)]));
    return [
      fromDateOnly(e.date),
      e.title,
      categoryLabel(e.category, categories.map((c) => ({ id: c.id, label: c.label }))),
      e.plan?.title ?? '',
      amt(toNum(e.amountMinor)),
      minorToDecimalString(toNum(e.originalAmountMinor), getCurrency(e.originalCurrency).decimals),
      e.originalCurrency,
      e.fxRate ?? '',
      e.payers.map((p) => `${name.get(p.memberId)}: ${amt(toNum(p.amountMinor))}`).join('; '),
      e.splitMethod,
      e.splits.map((s) => `${name.get(s.memberId)}: ${amt(toNum(s.amountMinor))}`).join('; '),
      ...members.flatMap((m) => [amt(paid.get(m.id) ?? 0), amt(share.get(m.id) ?? 0)]),
    ];
  });
  sendCsv(res, `${slug(group.name)}-expenses.csv`, toCsv(headers, data));
});

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'group';
}

export function sendCsv(res: import('express').Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  // BOM so spreadsheet apps detect UTF-8 (₹, names with accents).
  res.send(`﻿${csv}`);
}

async function loadExpense(group: Group, expenseId: string) {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, groupId: group.id }, include: expenseDetailInclude });
  if (!expense) throw notFound('Expense not found');
  return expense;
}

groupExpensesRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const input = parse(expenseSchema, req.body);

  // Idempotency: a retried submission returns the original expense instead of creating a duplicate.
  const replay = await prisma.expense.findUnique({
    where: { groupId_clientRequestId: { groupId: group.id, clientRequestId: input.clientRequestId } },
    include: expenseDetailInclude,
  });
  if (replay) {
    res.status(200).json({ expense: serializeExpenseDetail(replay), replayed: true });
    return;
  }

  const prepared = await prepareExpense(group, input);
  try {
    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: { ...prepared.data, groupId: group.id, clientRequestId: input.clientRequestId, createdById: user.id },
      });
      await writeExpenseChildren(tx, created.id, prepared);
      const full = await tx.expense.findUniqueOrThrow({ where: { id: created.id }, include: expenseDetailInclude });
      await tx.expenseRevision.create({
        data: { expenseId: created.id, version: 1, action: 'CREATED', snapshot: expenseSnapshot(full), summary: 'Created', changedById: user.id },
      });
      const amountText = formatMoney(toNum(full.amountMinor), group.currency);
      await logActivity(tx, {
        groupId: group.id,
        actorUserId: user.id,
        actorName: user.name,
        type: 'EXPENSE_ADDED',
        entityType: 'expense',
        entityId: created.id,
        planId: full.planId,
        summary: `${user.name} added "${full.title}" (${amountText})`,
      });
      await notifyGroup(tx, {
        groupId: group.id,
        type: 'EXPENSE_CREATED',
        title: 'New expense',
        body: `${user.name} added "${full.title}" (${amountText}) in ${group.name}`,
        link: `/groups/${group.id}/expenses/${created.id}`,
        excludeUserIds: [user.id],
      });
      await checkBudgetAlert(tx, group, user);
      return tx.expense.findUniqueOrThrow({ where: { id: created.id }, include: expenseDetailInclude });
    });
    res.status(201).json({ expense: serializeExpenseDetail(expense), replayed: false });
  } catch (err) {
    // Two concurrent retries with the same key: the loser returns the winner's record.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.expense.findUnique({
        where: { groupId_clientRequestId: { groupId: group.id, clientRequestId: input.clientRequestId } },
        include: expenseDetailInclude,
      });
      if (existing) {
        res.status(200).json({ expense: serializeExpenseDetail(existing), replayed: true });
        return;
      }
    }
    throw err;
  }
});

groupExpensesRouter.get('/:expenseId', async (req, res) => {
  const { group } = await requireGroup(req);
  const expense = await loadExpense(group, param(req, 'expenseId'));
  res.json({ expense: serializeExpenseDetail(expense) });
});

groupExpensesRouter.get('/:expenseId/revisions/:revisionId', async (req, res) => {
  const { group } = await requireGroup(req);
  const expense = await loadExpense(group, param(req, 'expenseId'));
  const revision = await prisma.expenseRevision.findFirst({ where: { id: param(req, 'revisionId'), expenseId: expense.id } });
  if (!revision) throw notFound('Revision not found');
  res.json({ revision: { id: revision.id, version: revision.version, action: revision.action, summary: revision.summary, snapshot: revision.snapshot, createdAt: revision.createdAt.toISOString(), changedById: revision.changedById } });
});

groupExpensesRouter.put('/:expenseId', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const existing = await loadExpense(group, param(req, 'expenseId'));
  if (existing.deletedAt) throw conflict('Restore this expense before editing it.');
  const input = parse(expenseUpdateSchema, req.body);
  const previousMemberIds = [...existing.payers.map((p) => p.memberId), ...existing.splits.map((s) => s.memberId)];
  const prepared = await prepareExpense(group, input, previousMemberIds);
  const before = expenseSnapshot(existing);

  const expense = await prisma.$transaction(async (tx) => {
    // Optimistic concurrency: only update if nobody else saved a newer version in the meantime.
    const { count } = await tx.expense.updateMany({
      where: { id: existing.id, version: input.expectedVersion, deletedAt: null },
      data: { ...prepared.data, updatedById: user.id, version: { increment: 1 } },
    });
    if (count === 0) {
      throw conflict('Someone else changed this expense while you were editing. Reload to see the latest version, then apply your changes again.', 'EDIT_CONFLICT');
    }
    await tx.expensePayer.deleteMany({ where: { expenseId: existing.id } });
    await tx.expenseSplit.deleteMany({ where: { expenseId: existing.id } });
    await tx.expenseItem.deleteMany({ where: { expenseId: existing.id } });
    await writeExpenseChildren(tx, existing.id, prepared);
    const full = await tx.expense.findUniqueOrThrow({ where: { id: existing.id }, include: expenseDetailInclude });
    const after = expenseSnapshot(full);
    const summary = describeChanges(before, after);
    await tx.expenseRevision.create({
      data: { expenseId: existing.id, version: full.version, action: 'UPDATED', snapshot: after, summary, changedById: user.id },
    });
    await logActivity(tx, {
      groupId: group.id,
      actorUserId: user.id,
      actorName: user.name,
      type: 'EXPENSE_EDITED',
      entityType: 'expense',
      entityId: existing.id,
      planId: full.planId,
      summary: `${user.name} edited "${full.title}": ${summary.toLowerCase()}`,
    });
    await notifyGroup(tx, {
      groupId: group.id,
      type: 'EXPENSE_UPDATED',
      title: 'Expense updated',
      body: `${user.name} edited "${full.title}" in ${group.name}`,
      link: `/groups/${group.id}/expenses/${existing.id}`,
      excludeUserIds: [user.id],
    });
    await checkBudgetAlert(tx, group, user);
    return full;
  });
  res.json({ expense: serializeExpenseDetail(expense) });
});

groupExpensesRouter.delete('/:expenseId', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const existing = await loadExpense(group, param(req, 'expenseId'));
  if (existing.deletedAt) throw conflict('This expense is already deleted.');
  await prisma.$transaction(async (tx) => {
    const updated = await tx.expense.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedById: user.id, version: { increment: 1 } },
    });
    await tx.expenseRevision.create({
      data: { expenseId: existing.id, version: updated.version, action: 'DELETED', snapshot: expenseSnapshot(existing), summary: 'Deleted', changedById: user.id },
    });
    await logActivity(tx, {
      groupId: group.id,
      actorUserId: user.id,
      actorName: user.name,
      type: 'EXPENSE_DELETED',
      entityType: 'expense',
      entityId: existing.id,
      planId: existing.planId,
      summary: `${user.name} deleted "${existing.title}" (${formatMoney(toNum(existing.amountMinor), group.currency)})`,
    });
    await notifyGroup(tx, {
      groupId: group.id,
      type: 'EXPENSE_DELETED',
      title: 'Expense deleted',
      body: `${user.name} deleted "${existing.title}" in ${group.name}`,
      link: `/groups/${group.id}/expenses?deleted=true`,
      excludeUserIds: [user.id],
    });
    await checkBudgetAlert(tx, group, user);
  });
  res.json({ ok: true });
});

groupExpensesRouter.post('/:expenseId/restore', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const existing = await loadExpense(group, param(req, 'expenseId'));
  if (!existing.deletedAt) throw conflict('This expense is not deleted.');
  const memberIds = [...existing.payers.map((p) => p.memberId), ...existing.splits.map((s) => s.memberId)];
  const inactive = await prisma.groupMember.count({ where: { id: { in: memberIds }, status: { not: 'ACTIVE' } } });
  if (inactive > 0) throw conflict('This expense involves members who have left the group, so it cannot be restored.');
  await prisma.$transaction(async (tx) => {
    const updated = await tx.expense.update({ where: { id: existing.id }, data: { deletedAt: null, deletedById: null, version: { increment: 1 } } });
    await tx.expenseRevision.create({
      data: { expenseId: existing.id, version: updated.version, action: 'RESTORED', snapshot: expenseSnapshot(existing), summary: 'Restored', changedById: user.id },
    });
    await logActivity(tx, {
      groupId: group.id,
      actorUserId: user.id,
      actorName: user.name,
      type: 'EXPENSE_RESTORED',
      entityType: 'expense',
      entityId: existing.id,
      planId: existing.planId,
      summary: `${user.name} restored "${existing.title}"`,
    });
    await checkBudgetAlert(tx, group, user);
  });
  res.json({ ok: true });
});

// ---------- Comments ----------

groupExpensesRouter.post('/:expenseId/comments', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const expense = await loadExpense(group, param(req, 'expenseId'));
  const { body } = parse(commentSchema, req.body);
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({ data: { groupId: group.id, expenseId: expense.id, authorId: user.id, body } });
    await notifyGroup(tx, {
      groupId: group.id,
      type: 'COMMENT',
      title: 'New comment',
      body: `${user.name} commented on "${expense.title}": ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`,
      link: `/groups/${group.id}/expenses/${expense.id}`,
      excludeUserIds: [user.id],
    });
    return c;
  });
  res.status(201).json({ comment: { id: comment.id, authorId: comment.authorId, body: comment.body, createdAt: comment.createdAt.toISOString() } });
});

groupExpensesRouter.delete('/:expenseId/comments/:commentId', async (req, res) => {
  const user = currentUser(req);
  const { group, member } = await requireGroup(req, 'editRecords');
  const comment = await prisma.comment.findFirst({
    where: { id: param(req, 'commentId'), expenseId: param(req, 'expenseId'), groupId: group.id, deletedAt: null },
  });
  if (!comment) throw notFound('Comment not found');
  if (comment.authorId !== user.id && member.role !== 'OWNER' && member.role !== 'ADMIN') throw forbidden('You can only delete your own comments.');
  await prisma.comment.update({ where: { id: comment.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
});

// ---------- Attachments ----------

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

function runUpload(req: Request, res: import('express').Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        reject(badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'Files must be 10 MB or smaller.' : 'Upload failed. Please try again.'));
      } else if (err) reject(err);
      else resolve();
    });
  });
}

groupExpensesRouter.post('/:expenseId/attachments', async (req, res) => {
  const user = currentUser(req);
  const { group } = await requireGroup(req, 'editRecords');
  const expense = await loadExpense(group, param(req, 'expenseId'));
  const count = await prisma.attachment.count({ where: { expenseId: expense.id, deletedAt: null } });
  if (count >= 10) throw conflict('An expense can have at most 10 attachments.');
  await runUpload(req, res);
  const file = req.file;
  if (!file) throw badRequest('Choose a file to upload.');
  const type = detectFileType(file.buffer);
  if (!type) throw badRequest('Only JPEG, PNG, WebP, GIF images and PDF files are supported.');
  const storageKey = await saveFile(file.buffer, type.ext);
  const attachment = await prisma.attachment.create({
    data: {
      groupId: group.id,
      expenseId: expense.id,
      uploadedById: user.id,
      fileName: sanitizeFileName(file.originalname),
      mimeType: type.mime,
      sizeBytes: file.size,
      storageKey,
    },
  });
  await logActivity(prisma, {
    groupId: group.id,
    actorUserId: user.id,
    actorName: user.name,
    type: 'RECEIPT_ADDED',
    entityType: 'expense',
    entityId: expense.id,
    planId: expense.planId,
    summary: `${user.name} attached a receipt to "${expense.title}"`,
  });
  res.status(201).json({
    attachment: { id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, uploadedById: user.id, createdAt: attachment.createdAt.toISOString() },
  });
});

async function loadAttachment(req: Request, permission: 'viewGroup' | 'editRecords') {
  const user = currentUser(req);
  const attachment = await prisma.attachment.findFirst({ where: { id: param(req, 'attachmentId'), deletedAt: null } });
  if (!attachment) throw notFound('File not found');
  // Authorize against the attachment's own group, never a client-supplied id.
  const access = await requireGroup(req, permission, { groupId: attachment.groupId });
  return { attachment, access, user };
}

attachmentsRouter.get('/:attachmentId', async (req, res) => {
  const { attachment } = await loadAttachment(req, 'viewGroup');
  if (!(await fileExists(attachment.storageKey))) throw notFound('File is no longer available');
  const inline = req.query.download !== 'true';
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${attachment.fileName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  openFile(attachment.storageKey).pipe(res);
});

attachmentsRouter.delete('/:attachmentId', async (req, res) => {
  const { attachment, user } = await loadAttachment(req, 'editRecords');
  await prisma.attachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
  await removeFile(attachment.storageKey);
  await logActivity(prisma, {
    groupId: attachment.groupId,
    actorUserId: user.id,
    actorName: user.name,
    type: 'RECEIPT_REMOVED',
    entityType: 'expense',
    entityId: attachment.expenseId,
    summary: `${user.name} removed a receipt`,
  });
  res.json({ ok: true });
});

// ---------- Global (all my groups) ----------

expensesRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const q = parse(expenseQuerySchema, req.query);
  const groupId = typeof req.query.groupId === 'string' && req.query.groupId ? req.query.groupId : null;
  const allowed = await accessibleGroupIds(user.id);
  const scope = groupId ? allowed.filter((id) => id === groupId) : allowed;
  if (groupId && scope.length === 0) throw notFound('Group not found');
  const result = await listExpenses(scope, q, user.id);
  res.json({ ...result, page: q.page, pageSize: q.pageSize });
});
