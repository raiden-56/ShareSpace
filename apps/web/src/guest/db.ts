/** In-memory records behind guest mode, mirroring the server's tables closely enough to derive every API response. */
import {
  computeSplit,
  convertComponents,
  convertMinor,
  getCurrency,
  occurrenceDate,
  validatePayers,
  type ExpenseInput,
  type GroupType,
  type PlanStatus,
  type PlanType,
  type Preferences,
  type Role,
} from '@sharespace/core';
import type {
  Activity,
  ChecklistItem,
  ExpenseDetail,
  Invitation,
  ItineraryItem,
  Notification,
  Session,
  Settlement,
  User,
} from '../api/types';

export interface DbGroup {
  id: string;
  name: string;
  description: string | null;
  type: GroupType;
  currency: string;
  accent: string;
  simplifyDebts: boolean;
  multiCurrency: boolean;
  /** Set for private two-person groups ("expenses outside a group"). */
  directKey: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
}

export interface DbMember {
  id: string;
  groupId: string;
  displayName: string;
  email: string | null;
  role: Role;
  status: 'ACTIVE' | 'LEFT' | 'REMOVED';
  userId: string | null;
  joinedAt: string;
  leftAt: string | null;
}

export interface DbBudget {
  id: string;
  groupId: string;
  totalMinor: number;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  warningThresholdPct: number;
  categories: { category: string; amountMinor: number }[];
  updatedAt: string;
}

export interface DbPlan {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  type: PlanType;
  status: PlanStatus;
  startDate: string;
  endDate: string | null;
  location: string | null;
  estimatedBudgetMinor: number | null;
  participantIds: string[];
  notes: string | null;
  itinerary: ItineraryItem[];
  checklist: ChecklistItem[];
  createdById: string;
  createdAt: string;
}

export interface DbPoll {
  id: string;
  groupId: string;
  planId: string | null;
  question: string;
  closesAt: string | null;
  closedAt: string | null;
  allowVoteChange: boolean;
  createdById: string;
  createdAt: string;
  eligibleMemberIds: string[];
  options: { id: string; label: string }[];
  votes: { memberId: string; optionId: string }[];
}

export interface DbInvitation extends Invitation {
  groupId: string;
  token: string;
  invitedByName: string;
}

export interface GuestDb {
  me: User;
  preferences: Preferences;
  users: User[];
  groups: DbGroup[];
  members: DbMember[];
  categories: { id: string; groupId: string; label: string }[];
  expenses: ExpenseDetail[];
  settlements: Settlement[];
  budgets: DbBudget[];
  plans: DbPlan[];
  polls: DbPoll[];
  activity: Activity[];
  notifications: Notification[];
  invitations: DbInvitation[];
  sessions: Session[];
}

// ---------- Errors ----------

/** Thrown by handlers; becomes an RTK Query error with the server's `{ error: { message } }` body. */
export class GuestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) => new GuestError(400, message, 'BAD_REQUEST', fields);
export const notFound = (message = 'Not found') => new GuestError(404, message, 'NOT_FOUND');
export const conflict = (message: string, code = 'CONFLICT') => new GuestError(409, message, code);
export const forbidden = (message = 'You do not have permission to do that.') => new GuestError(403, message, 'FORBIDDEN');

// ---------- Ids & dates ----------

let counter = 0;
/** Unique id for records created during the session. */
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayIso = () => isoDay(new Date());

/** The date `n` days from today (negative = in the past). */
export function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Timestamp at a local time of day on a YYYY-MM-DD date. */
export function at(day: string, hour = 12, minute = 0): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hour, minute).toISOString();
}

export const nowIso = () => new Date().toISOString();

// ---------- Expenses ----------

/**
 * Builds a stored expense from an API payload, applying the same validation and split engine as
 * the server (see apps/server/src/lib/expense-write.ts).
 */
export function materializeExpense(
  db: GuestDb,
  groupId: string,
  input: Omit<ExpenseInput, 'clientRequestId'>,
  meta: { id: string; actorUserId: string; createdAt: string; existing?: ExpenseDetail; recurringSourceId?: string | null },
): ExpenseDetail {
  const group = db.groups.find((g) => g.id === groupId);
  if (!group) throw notFound('Group not found');

  let convertedTotal = input.amountMinor;
  let fxRate: string | null = null;
  if (input.currency !== group.currency) {
    if (!group.multiCurrency) throw badRequest(`This group records expenses in ${group.currency} only. Enable multiple currencies in group settings.`);
    if (!input.fxRate) throw badRequest(`Enter the exchange rate from ${input.currency} to ${group.currency}.`, { fxRate: 'Exchange rate is required' });
    convertedTotal = convertMinor(input.amountMinor, getCurrency(input.currency).decimals, getCurrency(group.currency).decimals, input.fxRate);
    if (convertedTotal <= 0) throw badRequest('The converted amount is too small to record.');
    fxRate = input.fxRate;
  }

  const payerCheck = validatePayers(input.amountMinor, input.payers);
  if (!payerCheck.ok) throw badRequest(payerCheck.error, { payers: payerCheck.error });

  const split = computeSplit({
    method: input.split.method,
    totalMinor: input.amountMinor,
    participants: input.split.participants,
    items: input.split.items,
    adjustments: input.split.adjustments,
  });
  if (!split.ok) throw badRequest(split.error, { split: split.error });

  const groupMemberIds = new Set(db.members.filter((m) => m.groupId === groupId).map((m) => m.id));
  if ([...input.payers.map((p) => p.memberId), ...split.shares.map((s) => s.memberId)].some((id) => !groupMemberIds.has(id))) {
    throw notFound('One or more members do not belong to this group');
  }
  if (input.planId && !db.plans.some((p) => p.id === input.planId && p.groupId === groupId)) throw notFound('Plan not found in this group');

  const payerConverted = convertComponents(input.payers.map((p) => p.amountMinor), convertedTotal);
  const shareConverted = convertComponents(split.shares.map((s) => s.amountMinor), convertedTotal);
  const inputValues = new Map(input.split.participants.map((p) => [p.memberId, p.value ?? null]));
  const keepsInput = ['EXACT', 'PERCENTAGE', 'SHARES', 'ADJUSTMENT'].includes(input.split.method);
  const adj = input.split.method === 'ITEMIZED' ? input.split.adjustments : undefined;
  const existing = meta.existing;
  const plan = input.planId ? db.plans.find((p) => p.id === input.planId) : null;
  const repeat = input.repeat ?? 'NONE';

  return {
    id: meta.id,
    groupId,
    title: input.title,
    description: input.description ?? null,
    notes: input.notes ?? null,
    amountMinor: convertedTotal,
    currency: group.currency,
    originalAmountMinor: input.amountMinor,
    originalCurrency: input.currency,
    fxRate,
    fxDate: fxRate ? input.date : null,
    fxSource: fxRate ? 'manual' : null,
    date: input.date,
    category: input.category,
    splitMethod: input.split.method,
    repeatInterval: repeat,
    repeatNextDate: repeat === 'NONE' ? null : occurrenceDate(input.date, repeat, 1),
    recurringSourceId: meta.recurringSourceId ?? existing?.recurringSourceId ?? null,
    planId: input.planId ?? null,
    plan: plan ? { id: plan.id, title: plan.title } : null,
    payers: input.payers.map((p, i) => ({ memberId: p.memberId, amountMinor: payerConverted[i]!, originalAmountMinor: p.amountMinor })),
    shares: split.shares.map((s, i) => ({
      memberId: s.memberId,
      amountMinor: shareConverted[i]!,
      originalAmountMinor: s.amountMinor,
      inputValue: keepsInput ? (inputValues.get(s.memberId) ?? null) : null,
    })),
    items:
      input.split.method === 'ITEMIZED'
        ? (input.split.items ?? []).map((it, i) => ({ id: `${meta.id}-item-${i}`, ...it }))
        : [],
    adjustments: { taxMinor: adj?.taxMinor ?? 0, serviceMinor: adj?.serviceMinor ?? 0, discountMinor: adj?.discountMinor ?? 0 },
    revisions: existing?.revisions ?? [{ id: `${meta.id}-rev-1`, version: 1, action: 'CREATED', summary: 'Created', changedById: meta.actorUserId, createdAt: meta.createdAt }],
    comments: existing?.comments ?? [],
    attachments: existing?.attachments ?? [],
    createdById: existing?.createdById ?? meta.actorUserId,
    updatedById: existing ? meta.actorUserId : null,
    createdAt: existing?.createdAt ?? meta.createdAt,
    updatedAt: meta.createdAt,
    deletedAt: existing?.deletedAt ?? null,
    version: existing?.version ?? 1,
  };
}
