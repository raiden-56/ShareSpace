import type { Prisma } from '@prisma/client';
import { fromDateOnly, fromDateOnlyOrNull, toNum, toNumOrNull } from '../db';

export const memberInclude = { user: { select: { avatarColor: true, name: true } } } satisfies Prisma.GroupMemberInclude;
type MemberRow = Prisma.GroupMemberGetPayload<{ include: typeof memberInclude }>;

export function serializeMember(m: MemberRow, currentUserId: string) {
  return {
    id: m.id,
    displayName: m.displayName,
    email: m.email,
    role: m.role,
    status: m.status,
    userId: m.userId,
    hasAccount: m.userId !== null,
    isYou: m.userId === currentUserId,
    avatarColor: m.user?.avatarColor ?? null,
    joinedAt: m.joinedAt.toISOString(),
    leftAt: m.leftAt?.toISOString() ?? null,
  };
}

export const expenseListInclude = {
  payers: { select: { memberId: true, amountMinor: true } },
  splits: { select: { memberId: true, amountMinor: true }, orderBy: { position: 'asc' } },
  _count: { select: { comments: { where: { deletedAt: null } }, attachments: { where: { deletedAt: null } } } },
} satisfies Prisma.ExpenseInclude;
type ExpenseListRow = Prisma.ExpenseGetPayload<{ include: typeof expenseListInclude }>;

export function serializeExpenseSummary(e: ExpenseListRow) {
  return {
    id: e.id,
    groupId: e.groupId,
    title: e.title,
    amountMinor: toNum(e.amountMinor),
    currency: e.currency,
    originalAmountMinor: toNum(e.originalAmountMinor),
    originalCurrency: e.originalCurrency,
    fxRate: e.fxRate,
    date: fromDateOnly(e.date),
    category: e.category,
    splitMethod: e.splitMethod,
    planId: e.planId,
    payers: e.payers.map((p) => ({ memberId: p.memberId, amountMinor: toNum(p.amountMinor) })),
    shares: e.splits.map((s) => ({ memberId: s.memberId, amountMinor: toNum(s.amountMinor) })),
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    deletedAt: e.deletedAt?.toISOString() ?? null,
    version: e.version,
    commentCount: e._count.comments,
    attachmentCount: e._count.attachments,
  };
}

export const expenseDetailInclude = {
  payers: true,
  splits: { orderBy: { position: 'asc' } },
  items: { orderBy: { position: 'asc' }, include: { participants: true } },
  revisions: { orderBy: { createdAt: 'desc' } },
  comments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  plan: { select: { id: true, title: true } },
} satisfies Prisma.ExpenseInclude;
export type ExpenseDetailRow = Prisma.ExpenseGetPayload<{ include: typeof expenseDetailInclude }>;

/** Snapshot of the financially relevant fields of an expense, stored in its revision history. */
export function expenseSnapshot(e: ExpenseDetailRow) {
  return {
    title: e.title,
    description: e.description,
    notes: e.notes,
    amountMinor: toNum(e.amountMinor),
    currency: e.currency,
    originalAmountMinor: toNum(e.originalAmountMinor),
    originalCurrency: e.originalCurrency,
    fxRate: e.fxRate,
    date: fromDateOnly(e.date),
    category: e.category,
    splitMethod: e.splitMethod,
    planId: e.planId,
    payers: e.payers.map((p) => ({ memberId: p.memberId, amountMinor: toNum(p.amountMinor) })),
    shares: e.splits.map((s) => ({ memberId: s.memberId, amountMinor: toNum(s.amountMinor), inputValue: toNumOrNull(s.inputValue) })),
    items: e.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPriceMinor: toNum(i.unitPriceMinor),
      memberIds: i.participants.map((p) => p.memberId),
    })),
    adjustments: { taxMinor: toNum(e.taxMinor), serviceMinor: toNum(e.serviceMinor), discountMinor: toNum(e.discountMinor) },
  };
}

export function serializeExpenseDetail(e: ExpenseDetailRow) {
  return {
    id: e.id,
    groupId: e.groupId,
    title: e.title,
    description: e.description,
    notes: e.notes,
    amountMinor: toNum(e.amountMinor),
    currency: e.currency,
    originalAmountMinor: toNum(e.originalAmountMinor),
    originalCurrency: e.originalCurrency,
    fxRate: e.fxRate,
    fxDate: fromDateOnlyOrNull(e.fxDate),
    fxSource: e.fxSource,
    date: fromDateOnly(e.date),
    category: e.category,
    splitMethod: e.splitMethod,
    plan: e.plan,
    planId: e.planId,
    payers: e.payers.map((p) => ({
      memberId: p.memberId,
      amountMinor: toNum(p.amountMinor),
      originalAmountMinor: toNum(p.originalAmountMinor),
    })),
    shares: e.splits.map((s) => ({
      memberId: s.memberId,
      amountMinor: toNum(s.amountMinor),
      originalAmountMinor: toNum(s.originalAmountMinor),
      inputValue: toNumOrNull(s.inputValue),
    })),
    items: e.items.map((i) => ({
      id: i.id,
      description: i.description,
      quantity: i.quantity,
      unitPriceMinor: toNum(i.unitPriceMinor),
      memberIds: i.participants.map((p) => p.memberId),
    })),
    adjustments: { taxMinor: toNum(e.taxMinor), serviceMinor: toNum(e.serviceMinor), discountMinor: toNum(e.discountMinor) },
    revisions: e.revisions.map((r) => ({
      id: r.id,
      version: r.version,
      action: r.action,
      summary: r.summary,
      changedById: r.changedById,
      createdAt: r.createdAt.toISOString(),
    })),
    comments: e.comments.map((c) => ({ id: c.id, authorId: c.authorId, body: c.body, createdAt: c.createdAt.toISOString() })),
    attachments: e.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedById: a.uploadedById,
      createdAt: a.createdAt.toISOString(),
    })),
    createdById: e.createdById,
    updatedById: e.updatedById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    deletedAt: e.deletedAt?.toISOString() ?? null,
    version: e.version,
  };
}

export const settlementInclude = {} satisfies Prisma.SettlementInclude;

export function serializeSettlement(s: Prisma.SettlementGetPayload<object>) {
  return {
    id: s.id,
    groupId: s.groupId,
    fromMemberId: s.fromMemberId,
    toMemberId: s.toMemberId,
    amountMinor: toNum(s.amountMinor),
    currency: s.currency,
    method: s.method,
    methodNote: s.methodNote,
    date: fromDateOnly(s.date),
    notes: s.notes,
    status: s.status,
    recordedById: s.recordedById,
    createdAt: s.createdAt.toISOString(),
    reversedAt: s.reversedAt?.toISOString() ?? null,
    reversedById: s.reversedById,
    reversalReason: s.reversalReason,
  };
}
