/**
 * The guest-mode "server": answers every API request the web app makes from in-memory sample
 * data, following the response shapes and rules of apps/server. Loaded lazily by the API client
 * only while a guest session is active, so regular builds never download it.
 */
import type { FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import {
  ACCENTS,
  can,
  categoryLabel,
  computeBalances,
  computeBudgetStatus,
  computePairwiseDebts,
  DEFAULT_CATEGORIES,
  formatMoney,
  getCurrency,
  inDateRange,
  minorToDecimalString,
  netBetween,
  pickGranularity,
  PLAN_STATUS_LABELS,
  ROLE_LABELS,
  SETTLEMENT_METHOD_LABELS,
  spendingByCategory,
  spendingOverTime,
  suggestSettlements,
  toCsv,
  type BudgetInput,
  type ExpenseInput,
  type ExpenseUpdateInput,
  type FriendSettleInput,
  type GroupCreateInput,
  type ItineraryItemInput,
  type LedgerExpense,
  type Permission,
  type PlanInput,
  type PollInput,
  type Preferences,
  type ReportExpense,
  type Role,
  type SettlementInput,
} from '@sharespace/core';
import type {
  Activity,
  BudgetResponse,
  DashboardResponse,
  ExpenseDetail,
  ExpenseSummary,
  Friend,
  FriendGroup,
  GroupCard,
  GroupDetail,
  IncomingInvitation,
  Invitation,
  Member,
  Notification,
  PlanSummary,
  Poll,
  ReportResponse,
  SearchHit,
  Settlement,
  SettlementsOverview,
} from '../api/types';
import {
  badRequest,
  conflict,
  forbidden,
  GuestError,
  materializeExpense,
  newId,
  notFound,
  nowIso,
  todayIso,
  type DbGroup,
  type DbInvitation,
  type DbMember,
  type DbPlan,
  type DbPoll,
  type GuestDb,
} from './db';
import { exitGuestMode, GUEST_USER_ID, registerGuestAttachment } from './mode';
import { createSeed } from './seed';

let state: GuestDb | null = null;
const getDb = (): GuestDb => (state ??= createSeed());

/** Drops all guest changes; the next request starts from fresh sample data. */
export function resetGuestData(): void {
  state = null;
}

// =====================================================================
// Routing
// =====================================================================

interface Ctx {
  db: GuestDb;
  params: Record<string, string>;
  query: URLSearchParams;
  /** JSON request body, already validated by the UI's own schemas. */
  body: any;
}

/** A file response for the export endpoints (downloaded rather than parsed). */
class FileResult {
  constructor(
    readonly fileName: string,
    readonly type: string,
    readonly content: string,
  ) {}
}

type Handler = (c: Ctx) => unknown;
const routes: { method: string; parts: string[]; handler: Handler }[] = [];
const route = (method: string, path: string, handler: Handler) => routes.push({ method, parts: path.split('/').filter(Boolean), handler });

function match(method: string, path: string) {
  const segments = path.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = r.parts.every((p, i) => {
      if (p.startsWith(':')) {
        params[p.slice(1)] = segments[i]!;
        return true;
      }
      return p === segments[i];
    });
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function run(method: string, url: string, body: unknown): unknown {
  const [rawPath = '', search = ''] = url.split('?');
  const path = rawPath.replace(/^\/api(?=\/)/, '');
  const found = match(method, path);
  if (!found) {
    // Unknown endpoint: a harmless empty answer keeps the demo running.
    return method === 'GET' ? {} : { ok: true };
  }
  return found.handler({ db: getDb(), params: found.params, query: new URLSearchParams(search), body: clone(body) ?? {} });
}

/** RTK Query base query used while a guest session is active. */
export async function handleGuestRequest(args: string | FetchArgs): Promise<{ data: unknown } | { error: FetchBaseQueryError }> {
  const req = typeof args === 'string' ? { url: args } : args;
  const method = (req.method ?? 'GET').toUpperCase();
  let url = req.url;
  if (req.params) {
    const extra = new URLSearchParams(Object.entries(req.params).map(([k, v]) => [k, String(v)])).toString();
    if (extra) url += (url.includes('?') ? '&' : '?') + extra;
  }
  // A short pause so loading states and optimistic updates behave like they do against the API.
  await delay(method === 'GET' ? 120 : 220);
  try {
    const result = run(method, url, req.body);
    const data = result instanceof FileResult ? result.content : result;
    return { data: data === undefined ? null : clone(data) };
  } catch (err) {
    if (err instanceof GuestError) {
      return { error: { status: err.status, data: { error: { message: err.message, code: err.code, details: err.fields ? { fields: err.fields } : undefined } } } };
    }
    console.error('[guest mode]', err);
    return { error: { status: 500, data: { error: { message: 'Something went wrong in the demo. Please try again.' } } } };
  }
}

/** Export downloads (CSV/JSON) generated from the sample data. */
export async function guestDownload(url: string): Promise<{ fileName: string; blob: Blob }> {
  await delay(150);
  const result = run('GET', url, undefined);
  if (result instanceof FileResult) return { fileName: result.fileName, blob: new Blob([result.content], { type: result.type }) };
  return { fileName: 'export.json', blob: new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }) };
}

/** Receipt upload: kept as an in-browser object URL for the rest of the session. */
export async function guestUpload(groupId: string, expenseId: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  for (const step of [0.25, 0.6, 0.9]) {
    await delay(120);
    onProgress(step);
  }
  const db = getDb();
  requireGroup(db, groupId, 'editRecords');
  const expense = findExpense(db, groupId, expenseId);
  if (expense.deletedAt) throw new Error('Restore this expense before adding receipts.');
  const id = newId('att');
  registerGuestAttachment(id, URL.createObjectURL(file));
  expense.attachments.push({ id, fileName: file.name, mimeType: file.type, sizeBytes: file.size, uploadedById: GUEST_USER_ID, createdAt: nowIso() });
  logActivity(db, groupId, 'RECEIPT_ADDED', 'expense', expense.id, `${db.me.name} attached a receipt to "${expense.title}"`, expense.planId);
  onProgress(1);
}

// =====================================================================
// Shared helpers (mirroring apps/server/src/lib)
// =====================================================================

const userById = (db: GuestDb, id: string | null) => (id ? db.users.find((u) => u.id === id) : undefined);

function memberOut(db: GuestDb, m: DbMember): Member {
  return {
    id: m.id,
    displayName: m.displayName,
    email: m.email,
    role: m.role,
    status: m.status,
    userId: m.userId,
    hasAccount: m.userId !== null,
    isYou: m.userId === GUEST_USER_ID,
    avatarColor: userById(db, m.userId)?.avatarColor ?? null,
    joinedAt: m.joinedAt,
    leftAt: m.leftAt,
  };
}

const groupMembers = (db: GuestDb, groupId: string) =>
  db.members.filter((m) => m.groupId === groupId).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));

const myMembership = (db: GuestDb, groupId: string) => db.members.find((m) => m.groupId === groupId && m.userId === GUEST_USER_ID && m.status === 'ACTIVE');

function requireGroup(db: GuestDb, groupId: string, permission: Permission = 'viewGroup', allowArchived = false): { group: DbGroup; me: DbMember } {
  const group = db.groups.find((g) => g.id === groupId);
  const me = myMembership(db, groupId);
  if (!group || !me) throw notFound('Group not found');
  if (!can(me.role, permission)) throw forbidden();
  if (group.archivedAt && permission !== 'viewGroup' && !allowArchived) throw conflict('This group is archived. Restore it to make changes.', 'ARCHIVED');
  return { group, me };
}

function accessibleGroupIds(db: GuestDb, includeArchived = false): string[] {
  return db.groups.filter((g) => myMembership(db, g.id) && (includeArchived || !g.archivedAt)).map((g) => g.id);
}

const touch = (group: DbGroup) => {
  group.updatedAt = nowIso();
};

function logActivity(db: GuestDb, groupId: string, type: string, entityType: string, entityId: string | null, summary: string, planId: string | null = null) {
  db.activity.push({ id: newId('act'), groupId, actorUserId: GUEST_USER_ID, actorName: db.me.name, type, entityType, entityId, planId, summary, createdAt: nowIso() });
  const group = db.groups.find((g) => g.id === groupId);
  if (group) touch(group);
}

const liveExpenses = (db: GuestDb, groupId: string) => db.expenses.filter((e) => e.groupId === groupId && !e.deletedAt);

function toLedger(e: ExpenseDetail): LedgerExpense {
  return {
    id: e.id,
    amountMinor: e.amountMinor,
    payers: e.payers.map((p) => ({ memberId: p.memberId, amountMinor: p.amountMinor })),
    shares: e.shares.map((s) => ({ memberId: s.memberId, amountMinor: s.amountMinor })),
  };
}

function groupLedger(db: GuestDb, groupId: string) {
  const group = db.groups.find((g) => g.id === groupId)!;
  const expenses = liveExpenses(db, groupId).map(toLedger);
  const settlements = db.settlements.filter((s) => s.groupId === groupId && s.status === 'RECORDED');
  const balances = computeBalances(groupMembers(db, groupId).map((m) => m.id), expenses, settlements);
  return {
    balances,
    suggestions: group.simplifyDebts ? suggestSettlements(balances) : computePairwiseDebts(expenses, settlements),
    simplifyDebts: group.simplifyDebts,
    totalSpendingMinor: expenses.reduce((a, e) => a + e.amountMinor, 0),
    expenseCount: expenses.length,
  };
}

function budgetSnapshot(db: GuestDb, groupId: string) {
  const budget = db.budgets.find((b) => b.groupId === groupId);
  if (!budget) return null;
  const inRange = liveExpenses(db, groupId).filter((e) => inDateRange(e.date, budget.startDate, budget.endDate));
  const spent = inRange.reduce((a, e) => a + e.amountMinor, 0);
  return { budget, inRange, status: computeBudgetStatus(budget.totalMinor, spent, budget.warningThresholdPct) };
}

function groupCard(db: GuestDb, groupId: string): GroupCard {
  const group = db.groups.find((g) => g.id === groupId)!;
  const active = groupMembers(db, groupId).filter((m) => m.status === 'ACTIVE');
  const me = active.find((m) => m.userId === GUEST_USER_ID);
  const ledger = groupLedger(db, groupId);
  const budget = budgetSnapshot(db, groupId);
  const myBalance = ledger.balances.find((b) => b.memberId === me?.id);
  const today = todayIso();
  const upcoming = db.plans
    .filter((p) => p.groupId === groupId && p.status !== 'CANCELLED' && p.status !== 'COMPLETED' && p.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    type: group.type,
    currency: group.currency,
    accent: group.accent,
    simplifyDebts: group.simplifyDebts,
    isDirect: group.directKey !== null,
    archivedAt: group.archivedAt,
    createdAt: group.createdAt,
    role: me?.role ?? null,
    myMemberId: me?.id ?? null,
    memberCount: active.length,
    members: active.slice(0, 6).map((m) => ({ id: m.id, displayName: m.displayName, avatarColor: userById(db, m.userId)?.avatarColor ?? null })),
    totalSpendingMinor: ledger.totalSpendingMinor,
    expenseCount: ledger.expenseCount,
    myNetMinor: myBalance?.netMinor ?? 0,
    myPaidMinor: myBalance?.paidMinor ?? 0,
    pendingTransfers: ledger.suggestions.length,
    budget: budget ? { totalMinor: budget.status.budgetMinor, spentMinor: budget.status.spentMinor, usedBps: budget.status.usedBps, state: budget.status.state } : null,
    upcomingPlan: upcoming ? { id: upcoming.id, title: upcoming.title, startDate: upcoming.startDate, location: upcoming.location } : null,
  };
}

function expenseSummary(e: ExpenseDetail): ExpenseSummary {
  return {
    id: e.id,
    groupId: e.groupId,
    title: e.title,
    amountMinor: e.amountMinor,
    currency: e.currency,
    originalAmountMinor: e.originalAmountMinor,
    originalCurrency: e.originalCurrency,
    fxRate: e.fxRate,
    date: e.date,
    category: e.category,
    splitMethod: e.splitMethod,
    repeatInterval: e.repeatInterval,
    repeatNextDate: e.repeatNextDate,
    recurringSourceId: e.recurringSourceId,
    planId: e.planId,
    payers: e.payers.map((p) => ({ memberId: p.memberId, amountMinor: p.amountMinor })),
    shares: e.shares.map((s) => ({ memberId: s.memberId, amountMinor: s.amountMinor })),
    createdById: e.createdById,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    deletedAt: e.deletedAt,
    version: e.version,
    commentCount: e.comments.length,
    attachmentCount: e.attachments.length,
  };
}

const newestFirst = (a: { date: string; createdAt: string }, b: { date: string; createdAt: string }) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

function findExpense(db: GuestDb, groupId: string, expenseId: string): ExpenseDetail {
  const e = db.expenses.find((x) => x.id === expenseId && x.groupId === groupId);
  if (!e) throw notFound('Expense not found');
  return e;
}

function findPlan(db: GuestDb, groupId: string, planId: string): DbPlan {
  const plan = db.plans.find((p) => p.id === planId && p.groupId === groupId);
  if (!plan) throw notFound('Plan not found');
  return plan;
}

function planSummary(db: GuestDb, p: DbPlan): PlanSummary {
  const expenses = db.expenses.filter((e) => e.planId === p.id && !e.deletedAt);
  return {
    id: p.id,
    groupId: p.groupId,
    title: p.title,
    description: p.description,
    type: p.type,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    location: p.location,
    estimatedBudgetMinor: p.estimatedBudgetMinor,
    participantIds: p.participantIds,
    actualSpendingMinor: expenses.reduce((a, e) => a + e.amountMinor, 0),
    expenseCount: expenses.length,
    checklistDone: p.checklist.filter((c) => c.completedAt).length,
    checklistTotal: p.checklist.length,
    itineraryCount: p.itinerary.length,
    createdById: p.createdById,
    createdAt: p.createdAt,
  };
}

function finalizeExpiredPolls(db: GuestDb, groupId: string) {
  const now = nowIso();
  for (const poll of db.polls) {
    if (poll.groupId !== groupId || poll.closedAt || !poll.closesAt || poll.closesAt > now) continue;
    poll.closedAt = poll.closesAt;
  }
}

function pollOut(db: GuestDb, p: DbPoll): Poll {
  const me = myMembership(db, p.groupId);
  const myVote = p.votes.find((v) => v.memberId === me?.id)?.optionId ?? null;
  const eligible = !!me && can(me.role, 'editRecords') && (p.eligibleMemberIds.length === 0 || p.eligibleMemberIds.includes(me.id));
  return {
    id: p.id,
    groupId: p.groupId,
    planId: p.planId,
    question: p.question,
    closesAt: p.closesAt,
    closedAt: p.closedAt,
    allowVoteChange: p.allowVoteChange,
    createdById: p.createdById,
    createdAt: p.createdAt,
    eligibleMemberIds: p.eligibleMemberIds,
    totalVotes: p.votes.length,
    options: p.options.map((o) => ({ id: o.id, label: o.label, votes: p.votes.filter((v) => v.optionId === o.id).length })),
    myVote,
    canVote: !p.closedAt && eligible && (myVote === null || p.allowVoteChange),
    isEligible: eligible,
  };
}

function listPolls(db: GuestDb, groupId: string, planId?: string): Poll[] {
  finalizeExpiredPolls(db, groupId);
  return db.polls
    .filter((p) => p.groupId === groupId && (!planId || p.planId === planId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => pollOut(db, p));
}

const inviteUrl = (token: string) => `${window.location.origin}${import.meta.env.BASE_URL}invite/${token}`;

function invitationOut(i: DbInvitation): Invitation {
  const expired = i.status === 'PENDING' && i.expiresAt < nowIso();
  return { id: i.id, email: i.email, role: i.role, memberId: i.memberId, status: expired ? 'EXPIRED' : i.status, expiresAt: i.expiresAt, createdAt: i.createdAt, acceptedAt: i.acceptedAt };
}

function incomingOut(db: GuestDb, i: DbInvitation): IncomingInvitation {
  const group = db.groups.find((g) => g.id === i.groupId)!;
  return { ...invitationOut(i), groupId: group.id, groupName: group.name, groupType: group.type, invitedByName: i.invitedByName };
}

function createInvitation(db: GuestDb, group: DbGroup, email: string, role: Role, memberId: string | null): DbInvitation {
  for (const old of db.invitations) {
    if (old.groupId === group.id && old.email === email && old.status === 'PENDING') old.status = 'REVOKED';
  }
  const invitation: DbInvitation = {
    id: newId('inv'),
    groupId: group.id,
    token: newId('demo-invite'),
    email,
    role,
    memberId,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    createdAt: nowIso(),
    acceptedAt: null,
    invitedByName: db.me.name,
  };
  db.invitations.push(invitation);
  return invitation;
}

function assertSettledUp(db: GuestDb, groupId: string, memberId: string, who: string) {
  const balance = groupLedger(db, groupId).balances.find((b) => b.memberId === memberId);
  if (balance && balance.netMinor !== 0) {
    throw conflict(`${who} still ${balance.netMinor < 0 ? 'owe' : 'are owed'} money in this group. Settle up first.`, 'UNSETTLED');
  }
}

const ok = { ok: true } as const;

// =====================================================================
// Auth & account
// =====================================================================

route('GET', '/auth/me', ({ db }) => ({ user: db.me, preferences: db.preferences }));
route('POST', '/auth/logout', () => {
  exitGuestMode();
  resetGuestData();
  return ok;
});
route('POST', '/auth/login', () => {
  throw badRequest('You are exploring the demo. Sign out of guest mode to use a real account.');
});
route('POST', '/auth/register', () => {
  throw badRequest('You are exploring the demo. Sign out of guest mode to create an account.');
});
route('POST', '/auth/forgot-password', () => ({ ok: true, emailDelivery: false }));
route('POST', '/auth/reset-password', () => ok);

route('PATCH', '/me/profile', ({ db, body }) => {
  const name = String(body.name ?? '').trim() || db.me.name;
  for (const m of db.members) if (m.userId === GUEST_USER_ID && m.displayName === db.me.name) m.displayName = name;
  db.me.name = name;
  if (body.avatarColor) db.me.avatarColor = body.avatarColor;
  const user = db.users.find((u) => u.id === GUEST_USER_ID);
  if (user) Object.assign(user, { name: db.me.name, avatarColor: db.me.avatarColor });
  return { user: db.me };
});
route('PUT', '/me/password', () => ok);
route('GET', '/me/preferences', ({ db }) => ({ preferences: db.preferences }));
route('PATCH', '/me/preferences', ({ db, body }) => {
  const patch = body as Partial<Preferences>;
  db.preferences = { ...db.preferences, ...patch, notifications: { ...db.preferences.notifications, ...(patch.notifications ?? {}) } };
  return { preferences: db.preferences };
});
route('GET', '/me/sessions', ({ db }) => ({ sessions: db.sessions }));
route('POST', '/me/sessions/revoke-others', ({ db }) => {
  const revoked = db.sessions.filter((s) => !s.current).length;
  db.sessions = db.sessions.filter((s) => s.current);
  return { revoked };
});
route('DELETE', '/me/sessions/:id', ({ db, params }) => {
  const session = db.sessions.find((s) => s.id === params.id);
  if (!session) throw notFound('Session not found');
  if (session.current) {
    exitGuestMode();
    resetGuestData();
    return ok;
  }
  db.sessions = db.sessions.filter((s) => s.id !== params.id);
  return ok;
});
route('DELETE', '/me', () => {
  exitGuestMode();
  resetGuestData();
  return ok;
});
route('GET', '/me/export', ({ db }) => {
  const groupIds = accessibleGroupIds(db, true);
  const data = {
    exportedAt: nowIso(),
    note: 'ShareSpace guest demo: sample data only.',
    user: db.me,
    preferences: db.preferences,
    groups: groupIds.map((id) => groupCard(db, id)),
    expenses: db.expenses.filter((e) => groupIds.includes(e.groupId)).map(expenseSummary),
    settlements: db.settlements.filter((s) => groupIds.includes(s.groupId)),
  };
  return new FileResult('sharespace-personal-data.json', 'application/json', JSON.stringify(data, null, 2));
});

// =====================================================================
// Dashboard, search & reports
// =====================================================================

route('GET', '/dashboard', ({ db }) => {
  const groupIds = accessibleGroupIds(db);
  const cards = groupIds.map((id) => groupCard(db, id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const byCurrency = new Map<string, DashboardResponse['totals'][number]>();
  const reminders: DashboardResponse['reminders'] = [];
  for (const card of cards) {
    const entry = byCurrency.get(card.currency) ?? { currency: card.currency, oweMinor: 0, owedMinor: 0, paidMinor: 0, groupSpendingMinor: 0 };
    if (card.myNetMinor < 0) entry.oweMinor += -card.myNetMinor;
    if (card.myNetMinor > 0) entry.owedMinor += card.myNetMinor;
    entry.paidMinor += card.myPaidMinor;
    entry.groupSpendingMinor += card.totalSpendingMinor;
    byCurrency.set(card.currency, entry);
    if (card.myNetMinor !== 0 && card.myMemberId) {
      for (const t of groupLedger(db, card.id).suggestions) {
        if (t.fromMemberId !== card.myMemberId && t.toMemberId !== card.myMemberId) continue;
        reminders.push({ groupId: card.id, groupName: card.name, currency: card.currency, ...t, direction: t.fromMemberId === card.myMemberId ? 'pay' : 'receive' });
      }
    }
  }
  const groupsById = new Map(db.groups.map((g) => [g.id, g]));
  const members = db.members.filter((m) => groupIds.includes(m.groupId));
  const myMemberIds = new Set(members.filter((m) => m.userId === GUEST_USER_ID).map((m) => m.id));
  const today = todayIso();
  const response: DashboardResponse = {
    totals: [...byCurrency.values()],
    activeGroups: cards.length,
    pendingSettlements: reminders.length,
    reminders: reminders.sort((a, b) => b.amountMinor - a.amountMinor),
    groups: cards,
    members: members.map((m) => ({ id: m.id, displayName: m.displayName, isYou: m.userId === GUEST_USER_ID })),
    recentExpenses: db.expenses
      .filter((e) => groupIds.includes(e.groupId) && !e.deletedAt)
      .sort(newestFirst)
      .slice(0, 8)
      .map((e) => ({
        ...expenseSummary(e),
        groupName: groupsById.get(e.groupId)!.name,
        groupAccent: groupsById.get(e.groupId)!.accent,
        myShareMinor: e.shares.filter((s) => myMemberIds.has(s.memberId)).reduce((a, s) => a + s.amountMinor, 0),
      })),
    upcomingPlans: db.plans
      .filter((p) => groupIds.includes(p.groupId) && ['IDEA', 'PLANNING', 'CONFIRMED'].includes(p.status) && (p.startDate >= today || (p.endDate ?? '') >= today))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        groupId: p.groupId,
        groupName: groupsById.get(p.groupId)!.name,
        groupAccent: groupsById.get(p.groupId)!.accent,
        title: p.title,
        type: p.type,
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
        location: p.location,
      })),
    recentActivity: db.activity
      .filter((a) => groupIds.includes(a.groupId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((a) => ({ ...a, groupName: groupsById.get(a.groupId)!.name })),
  };
  return response;
});

route('GET', '/search', ({ db, query }) => {
  const q = (query.get('q') ?? '').trim().slice(0, 100);
  const results: Record<'groups' | 'members' | 'expenses' | 'settlements' | 'plans' | 'polls', SearchHit[]> = { groups: [], members: [], expenses: [], settlements: [], plans: [], polls: [] };
  if (q.length < 2) return { query: q, results };
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q.toLowerCase());
  const groupIds = accessibleGroupIds(db, true);
  const groupName = (id: string) => db.groups.find((g) => g.id === id)!.name;
  const memberName = (id: string) => db.members.find((m) => m.id === id)?.displayName ?? 'Former member';
  results.groups = db.groups
    .filter((g) => groupIds.includes(g.id) && (has(g.name) || has(g.description)))
    .slice(0, 6)
    .map((g) => ({ id: g.id, title: g.name, subtitle: g.archivedAt ? 'Archived group' : 'Group', link: `/groups/${g.id}` }));
  const members = db.members.filter((m) => groupIds.includes(m.groupId) && m.status === 'ACTIVE' && (has(m.displayName) || has(m.email))).slice(0, 8);
  results.members = members.map((m) => ({ id: m.id, title: m.displayName, subtitle: groupName(m.groupId), link: `/groups/${m.groupId}/members` }));
  results.expenses = db.expenses
    .filter((e) => groupIds.includes(e.groupId) && !e.deletedAt && (has(e.title) || has(e.notes) || has(e.description)))
    .sort(newestFirst)
    .slice(0, 8)
    .map((e) => ({ id: e.id, title: e.title, subtitle: `${groupName(e.groupId)} · ${formatMoney(e.amountMinor, e.currency)} · ${e.date}`, link: `/groups/${e.groupId}/expenses/${e.id}` }));
  const memberIds = new Set(members.map((m) => m.id));
  results.settlements = db.settlements
    .filter((s) => groupIds.includes(s.groupId) && (has(s.notes) || has(s.methodNote) || memberIds.has(s.fromMemberId) || memberIds.has(s.toMemberId)))
    .sort(newestFirst)
    .slice(0, 6)
    .map((s) => ({
      id: s.id,
      title: `${memberName(s.fromMemberId)} → ${memberName(s.toMemberId)}`,
      subtitle: `${groupName(s.groupId)} · ${formatMoney(s.amountMinor, s.currency)}${s.status === 'REVERSED' ? ' · reversed' : ''}`,
      link: `/groups/${s.groupId}/balances`,
    }));
  results.plans = db.plans
    .filter((p) => groupIds.includes(p.groupId) && (has(p.title) || has(p.location) || has(p.description)))
    .slice(0, 6)
    .map((p) => ({ id: p.id, title: p.title, subtitle: `${groupName(p.groupId)} · ${p.startDate}`, link: `/groups/${p.groupId}/plans/${p.id}` }));
  results.polls = db.polls
    .filter((p) => groupIds.includes(p.groupId) && has(p.question))
    .slice(0, 6)
    .map((p) => ({
      id: p.id,
      title: p.question,
      subtitle: `${groupName(p.groupId)}${p.closedAt ? ' · closed' : ''}`,
      link: p.planId ? `/groups/${p.groupId}/plans/${p.planId}` : `/groups/${p.groupId}/plans?tab=decisions`,
    }));
  return { query: q, results };
});

function buildReport(db: GuestDb, query: URLSearchParams): ReportResponse {
  const allowed = accessibleGroupIds(db, true);
  const groupId = query.get('groupId') || null;
  if (groupId && !allowed.includes(groupId)) throw notFound('Group not found');
  const groups = db.groups.filter((g) => (groupId ? [groupId] : allowed).includes(g.id));
  const currencies = [...new Set(groups.map((g) => g.currency))].sort();
  const requested = query.get('currency');
  const currency = requested && currencies.includes(requested) ? requested : (groups[0]?.currency ?? 'INR');
  const inCurrency = groups.filter((g) => g.currency === currency);
  const ids = inCurrency.map((g) => g.id);
  const to = query.get('to') || todayIso();
  const from = query.get('from') || new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);

  const expenses = db.expenses.filter((e) => ids.includes(e.groupId) && !e.deletedAt && e.date >= from && e.date <= to).sort(newestFirst);
  const rows: ReportExpense[] = expenses.map((e) => ({ ...toLedger(e), groupId: e.groupId, date: e.date, category: e.category, planId: e.planId }));
  const groupMembersInScope = db.members.filter((m) => ids.includes(m.groupId));
  const myMemberIds = new Set(groupMembersInScope.filter((m) => m.userId === GUEST_USER_ID).map((m) => m.id));
  const memberInfo = new Map(groupMembersInScope.map((m) => [m.id, m]));
  const customCategories = db.categories.filter((c) => ids.includes(c.groupId)).map((c) => ({ id: c.id, label: c.label }));

  const people = new Map<string, ReportResponse['byMember'][number]>();
  for (const r of rows) {
    const add = (memberId: string, field: 'paidMinor' | 'shareMinor', amount: number) => {
      const info = memberInfo.get(memberId);
      const key = info?.userId ?? memberId;
      const entry = people.get(key) ?? { key, name: info?.displayName ?? 'Former member', paidMinor: 0, shareMinor: 0, isYou: info?.userId === GUEST_USER_ID };
      entry[field] += amount;
      people.set(key, entry);
    };
    r.payers.forEach((p) => add(p.memberId, 'paidMinor', p.amountMinor));
    r.shares.forEach((s) => add(s.memberId, 'shareMinor', s.amountMinor));
  }

  const planMap = new Map<string, ReportResponse['byPlan'][number]>();
  for (const e of expenses) {
    const plan = e.planId ? db.plans.find((p) => p.id === e.planId) : undefined;
    if (!plan) continue;
    const entry = planMap.get(plan.id) ?? { planId: plan.id, title: plan.title, groupId: e.groupId, estimatedMinor: plan.estimatedBudgetMinor, actualMinor: 0, count: 0 };
    entry.actualMinor += e.amountMinor;
    entry.count += 1;
    planMap.set(plan.id, entry);
  }

  const granularity = from <= to ? pickGranularity(from, to) : 'day';
  return {
    currency,
    currencies,
    from,
    to,
    granularity,
    groupId,
    groups: inCurrency.map((g) => ({ id: g.id, name: g.name, accent: g.accent })),
    excludedGroups: groups.filter((g) => g.currency !== currency).map((g) => ({ id: g.id, name: g.name, currency: g.currency })),
    totals: {
      spendingMinor: rows.reduce((a, r) => a + r.amountMinor, 0),
      expenseCount: rows.length,
      myShareMinor: rows.reduce((a, r) => a + r.shares.filter((s) => myMemberIds.has(s.memberId)).reduce((x, s) => x + s.amountMinor, 0), 0),
      myPaidMinor: rows.reduce((a, r) => a + r.payers.filter((p) => myMemberIds.has(p.memberId)).reduce((x, p) => x + p.amountMinor, 0), 0),
      settlementsMinor: db.settlements
        .filter((s) => ids.includes(s.groupId) && s.status === 'RECORDED' && s.date >= from && s.date <= to)
        .reduce((a, s) => a + s.amountMinor, 0),
    },
    byCategory: spendingByCategory(rows).map((b) => ({ ...b, label: categoryLabel(b.key, customCategories) })),
    byGroup: inCurrency
      .map((g) => {
        const own = rows.filter((r) => r.groupId === g.id);
        return { groupId: g.id, name: g.name, accent: g.accent, amountMinor: own.reduce((a, r) => a + r.amountMinor, 0), count: own.length };
      })
      .sort((a, b) => b.amountMinor - a.amountMinor),
    byMember: [...people.values()].sort((a, b) => b.shareMinor - a.shareMinor),
    overTime: from <= to ? spendingOverTime(rows, granularity, from, to) : [],
    byPlan: [...planMap.values()].sort((a, b) => b.actualMinor - a.actualMinor),
    budgetVsActual: inCurrency.flatMap((g) => {
      const snap = budgetSnapshot(db, g.id);
      if (!snap) return [];
      return [{ groupId: g.id, groupName: g.name, budgetMinor: snap.budget.totalMinor, spentMinor: snap.status.spentMinor, startDate: snap.budget.startDate, endDate: snap.budget.endDate }];
    }),
    expenses: expenses.slice(0, 100).map(expenseSummary),
    expensesTruncated: expenses.length > 100,
  };
}

route('GET', '/reports', ({ db, query }) => buildReport(db, query));
route('GET', '/reports/export.csv', ({ db, query }) => {
  const r = buildReport(db, query);
  const dec = getCurrency(r.currency).decimals;
  const amt = (m: number) => minorToDecimalString(m, dec);
  const rows: (string | number)[][] = [
    ...r.byCategory.map((b) => ['Category', b.label, amt(b.amountMinor), b.count]),
    ...r.byGroup.map((b) => ['Group', b.name, amt(b.amountMinor), b.count]),
    ...r.byMember.map((b) => ['Person (share)', b.name, amt(b.shareMinor), '']),
    ...r.byMember.map((b) => ['Person (paid)', b.name, amt(b.paidMinor), '']),
    ...r.overTime.map((b) => [`Period (${r.granularity})`, b.key, amt(b.amountMinor), b.count]),
    ...r.byPlan.map((b) => ['Plan', b.title, amt(b.actualMinor), b.count]),
    ...r.budgetVsActual.map((b) => ['Budget used', b.groupName, amt(b.spentMinor), `of ${amt(b.budgetMinor)}`]),
  ];
  return new FileResult(`sharespace-report-${r.from}-to-${r.to}.csv`, 'text/csv', toCsv(['Section', 'Label', `Amount (${r.currency})`, 'Count'], rows));
});

// =====================================================================
// Groups, members & invitations
// =====================================================================

route('GET', '/groups', ({ db, query }) => {
  const archived = query.get('archived') === 'true';
  const groups = db.groups
    .filter((g) => myMembership(db, g.id) && !g.directKey && (archived ? !!g.archivedAt : !g.archivedAt))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { groups: groups.map((g) => groupCard(db, g.id)) };
});

route('POST', '/groups', ({ db, body }) => {
  const input = body as GroupCreateInput;
  const now = nowIso();
  const group: DbGroup = {
    id: newId('grp'),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    type: input.type,
    currency: input.currency,
    accent: input.accent ?? ACCENTS[0],
    simplifyDebts: input.simplifyDebts ?? true,
    multiCurrency: false,
    directKey: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ownerId: GUEST_USER_ID,
  };
  db.groups.push(group);
  db.members.push({ id: newId('mem'), groupId: group.id, displayName: db.me.name, email: db.me.email, role: 'OWNER', status: 'ACTIVE', userId: GUEST_USER_ID, joinedAt: now, leftAt: null });
  const invitations: { email: string; displayName: string; inviteUrl: string }[] = [];
  for (const draft of input.members ?? []) {
    const email = draft.email?.trim().toLowerCase() || null;
    if (email === db.me.email) continue;
    const member: DbMember = { id: newId('mem'), groupId: group.id, displayName: draft.displayName.trim(), email, role: 'MEMBER', status: 'ACTIVE', userId: null, joinedAt: now, leftAt: null };
    db.members.push(member);
    if (email) invitations.push({ email, displayName: member.displayName, inviteUrl: inviteUrl(createInvitation(db, group, email, 'MEMBER', member.id).token) });
  }
  if (input.budgetMinor) {
    db.budgets.push({ id: newId('bud'), groupId: group.id, totalMinor: input.budgetMinor, currency: group.currency, startDate: null, endDate: null, warningThresholdPct: 80, categories: [], updatedAt: now });
  }
  logActivity(db, group.id, 'GROUP_CREATED', 'group', group.id, `${db.me.name} created the group`);
  return { group: groupCard(db, group.id), invitations };
});

route('GET', '/groups/:groupId', ({ db, params }): GroupDetail => {
  const { group, me } = requireGroup(db, params.groupId!);
  return {
    group: { ...groupCard(db, group.id), multiCurrency: group.multiCurrency, ownerId: group.ownerId, updatedAt: group.updatedAt },
    role: me.role,
    myMemberId: me.id,
    members: groupMembers(db, group.id).map((m) => memberOut(db, m)),
    categories: db.categories.filter((c) => c.groupId === group.id).sort((a, b) => a.label.localeCompare(b.label)).map((c) => ({ id: c.id, label: c.label })),
  };
});

route('PATCH', '/groups/:groupId', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'manageSettings');
  if (body.currency && body.currency !== group.currency) {
    const used = db.expenses.some((e) => e.groupId === group.id) || db.settlements.some((s) => s.groupId === group.id);
    if (used) throw conflict('The group currency cannot change after expenses or settlements have been recorded.');
  }
  const simplifyChanged = body.simplifyDebts !== undefined && body.simplifyDebts !== group.simplifyDebts;
  for (const key of ['name', 'type', 'currency', 'accent', 'multiCurrency', 'simplifyDebts'] as const) {
    if (body[key] !== undefined) Object.assign(group, { [key]: body[key] });
  }
  if (body.description !== undefined) group.description = body.description || null;
  if (body.currency) for (const b of db.budgets) if (b.groupId === group.id) b.currency = body.currency;
  logActivity(
    db,
    group.id,
    'GROUP_UPDATED',
    'group',
    group.id,
    simplifyChanged ? `${db.me.name} turned ${group.simplifyDebts ? 'on' : 'off'} simplified debts` : `${db.me.name} updated the group details`,
  );
  return { group: { id: group.id } };
});

route('POST', '/groups/:groupId/archive', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'archiveGroup', true);
  group.archivedAt = nowIso();
  logActivity(db, group.id, 'GROUP_ARCHIVED', 'group', group.id, `${db.me.name} archived the group`);
  return ok;
});
route('POST', '/groups/:groupId/restore', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'archiveGroup', true);
  group.archivedAt = null;
  logActivity(db, group.id, 'GROUP_RESTORED', 'group', group.id, `${db.me.name} restored the group`);
  return ok;
});
route('POST', '/groups/:groupId/leave', ({ db, params }) => {
  const { group, me } = requireGroup(db, params.groupId!, 'viewGroup');
  assertSettledUp(db, group.id, me.id, 'You');
  if (me.role === 'OWNER' && db.members.some((m) => m.groupId === group.id && m.status === 'ACTIVE' && m.userId && m.id !== me.id)) {
    throw conflict('Transfer ownership to another member before leaving the group.', 'OWNER_MUST_TRANSFER');
  }
  logActivity(db, group.id, 'MEMBER_LEFT', 'member', me.id, `${me.displayName} left the group`);
  me.status = 'LEFT';
  me.leftAt = nowIso();
  return ok;
});

route('POST', '/groups/:groupId/categories', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const label = String(body.label ?? '').trim();
  if (!label) throw badRequest('Enter a category name', { label: 'Enter a category name' });
  const existing = db.categories.filter((c) => c.groupId === group.id);
  if (existing.length >= 30) throw conflict('A group can have at most 30 custom categories.');
  if (existing.some((c) => c.label.toLowerCase() === label.toLowerCase()) || DEFAULT_CATEGORIES.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
    throw conflict('A category with this name already exists.');
  }
  const category = { id: newId('cat'), groupId: group.id, label };
  db.categories.push(category);
  return { category: { id: category.id, label } };
});

route('POST', '/groups/:groupId/members', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'manageMembers');
  if (group.directKey) throw conflict('Expenses with a friend are just between the two of you. Create a group to add more people.');
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null;
  if (email && db.members.some((m) => m.groupId === group.id && m.status === 'ACTIVE' && m.email === email)) throw conflict('Someone with this email is already in the group.');
  const member: DbMember = { id: newId('mem'), groupId: group.id, displayName: String(body.displayName).trim(), email, role: 'MEMBER', status: 'ACTIVE', userId: null, joinedAt: nowIso(), leftAt: null };
  db.members.push(member);
  const url = email ? inviteUrl(createInvitation(db, group, email, 'MEMBER', member.id).token) : null;
  logActivity(db, group.id, 'MEMBER_ADDED', 'member', member.id, `${db.me.name} added ${member.displayName}`);
  return { member: memberOut(db, member), inviteUrl: url };
});

route('PATCH', '/groups/:groupId/members/:memberId', ({ db, params, body }) => {
  const { group, me } = requireGroup(db, params.groupId!, 'editRecords');
  const target = db.members.find((m) => m.id === params.memberId && m.groupId === group.id);
  if (!target) throw notFound('Member not found');
  const role = body.role as Role | undefined;
  if (body.displayName !== undefined && target.id !== me.id && !can(me.role, 'manageMembers')) throw forbidden();
  if (role !== undefined && role !== target.role) {
    if (!can(me.role, 'manageRoles')) throw forbidden('Only the group owner can change roles.');
    if (!target.userId || target.status !== 'ACTIVE') throw badRequest('Only active members with an account can have a role.');
    if (target.id === me.id) throw badRequest('Transfer ownership to someone else to change your own role.');
  }
  const before = target.displayName;
  const roleChanged = role !== undefined && role !== target.role;
  if (role === 'OWNER' && target.role !== 'OWNER') {
    me.role = 'ADMIN';
    group.ownerId = target.userId!;
  }
  if (body.displayName !== undefined) target.displayName = String(body.displayName).trim();
  if (role !== undefined) target.role = role;
  logActivity(
    db,
    group.id,
    'MEMBER_UPDATED',
    'member',
    target.id,
    roleChanged ? `${db.me.name} changed ${before}'s role to ${ROLE_LABELS[role!]}` : `${db.me.name} renamed ${before} to ${target.displayName}`,
  );
  return ok;
});

route('DELETE', '/groups/:groupId/members/:memberId', ({ db, params }) => {
  const { group, me } = requireGroup(db, params.groupId!, 'manageMembers');
  const target = db.members.find((m) => m.id === params.memberId && m.groupId === group.id && m.status === 'ACTIVE');
  if (!target) throw notFound('Member not found');
  if (target.role === 'OWNER') throw forbidden('The group owner cannot be removed.');
  if (target.id === me.id) throw badRequest('Use "Leave group" to remove yourself.');
  if (target.role === 'ADMIN' && me.role !== 'OWNER') throw forbidden('Only the owner can remove an admin.');
  assertSettledUp(db, group.id, target.id, target.displayName);
  target.status = 'REMOVED';
  target.leftAt = nowIso();
  for (const inv of db.invitations) if (inv.memberId === target.id && inv.status === 'PENDING') inv.status = 'REVOKED';
  logActivity(db, group.id, 'MEMBER_REMOVED', 'member', target.id, `${db.me.name} removed ${target.displayName}`);
  return ok;
});

route('GET', '/groups/:groupId/invitations', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!);
  return { invitations: db.invitations.filter((i) => i.groupId === group.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(invitationOut) };
});
route('POST', '/groups/:groupId/invitations', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'manageMembers');
  const email = String(body.email ?? '').trim().toLowerCase();
  if (db.members.some((m) => m.groupId === group.id && m.status === 'ACTIVE' && m.userId && m.email === email)) throw conflict('This person is already a member of the group.');
  const invitation = createInvitation(db, group, email, (body.role as Role) ?? 'MEMBER', body.memberId ?? null);
  logActivity(db, group.id, 'INVITATION_SENT', 'invitation', invitation.id, `${db.me.name} invited ${email}`);
  return { invitation: invitationOut(invitation), inviteUrl: inviteUrl(invitation.token) };
});
route('POST', '/groups/:groupId/invitations/:invitationId/revoke', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'manageMembers');
  const invitation = db.invitations.find((i) => i.id === params.invitationId && i.groupId === group.id);
  if (!invitation) throw notFound('Invitation not found');
  if (invitation.status !== 'PENDING') throw conflict(`This invitation has already been ${invitation.status.toLowerCase()}.`);
  invitation.status = 'REVOKED';
  logActivity(db, group.id, 'INVITATION_REVOKED', 'invitation', invitation.id, `${db.me.name} revoked the invitation for ${invitation.email}`);
  return ok;
});

function respondToInvitation(db: GuestDb, invitation: DbInvitation | undefined, action: string) {
  if (!invitation) throw notFound('Invitation not found');
  if (action !== 'accept' && action !== 'decline') throw notFound();
  if (invitation.email !== db.me.email) throw forbidden('This invitation was sent to a different email address.');
  if (invitation.status !== 'PENDING') throw conflict(`This invitation has already been ${invitation.status.toLowerCase()}.`);
  if (invitation.expiresAt < nowIso()) throw conflict('This invitation has expired. Ask a group admin for a new one.', 'EXPIRED');
  const group = db.groups.find((g) => g.id === invitation.groupId)!;
  if (action === 'decline') {
    invitation.status = 'DECLINED';
    return { groupId: group.id };
  }
  invitation.status = 'ACCEPTED';
  invitation.acceptedAt = nowIso();
  const placeholder = invitation.memberId ? db.members.find((m) => m.id === invitation.memberId && !m.userId) : undefined;
  if (placeholder) Object.assign(placeholder, { userId: GUEST_USER_ID, role: invitation.role, email: db.me.email, status: 'ACTIVE', displayName: db.me.name });
  else db.members.push({ id: newId('mem'), groupId: group.id, displayName: db.me.name, email: db.me.email, role: invitation.role, status: 'ACTIVE', userId: GUEST_USER_ID, joinedAt: nowIso(), leftAt: null });
  logActivity(db, group.id, 'MEMBER_JOINED', 'member', placeholder?.id ?? null, `${db.me.name} joined the group`);
  for (const n of db.notifications) if (n.type === 'INVITATION' && n.groupId === group.id && !n.readAt) n.readAt = nowIso();
  return { groupId: group.id };
}

route('GET', '/invitations/mine', ({ db }) => ({
  invitations: db.invitations.filter((i) => i.email === db.me.email && i.status === 'PENDING' && i.expiresAt > nowIso()).map((i) => incomingOut(db, i)),
}));
route('GET', '/invitations/token/:token', ({ db, params }) => {
  const invitation = db.invitations.find((i) => i.token === params.token);
  if (!invitation) throw notFound('This invitation link is invalid.');
  return { invitation: incomingOut(db, invitation) };
});
route('POST', '/invitations/token/:token/:action', ({ db, params }) =>
  respondToInvitation(db, db.invitations.find((i) => i.token === params.token), params.action!),
);
route('POST', '/invitations/:invitationId/:action', ({ db, params }) =>
  respondToInvitation(db, db.invitations.find((i) => i.id === params.invitationId), params.action!),
);

// =====================================================================
// Expenses, comments & receipts
// =====================================================================

function listExpenses(db: GuestDb, groupIds: string[], query: URLSearchParams) {
  const get = (k: string) => query.get(k) || undefined;
  const q = get('q')?.toLowerCase();
  const num = (k: string) => (get(k) === undefined ? undefined : Number(get(k)));
  const minAmount = num('minAmount');
  const maxAmount = num('maxAmount');
  const myMemberIds = new Set(db.members.filter((m) => m.userId === GUEST_USER_ID).map((m) => m.id));
  const deleted = get('deleted') === 'true';
  let rows = db.expenses.filter((e) => {
    if (!groupIds.includes(e.groupId) || !!e.deletedAt !== deleted) return false;
    if (q && ![e.title, e.description, e.notes].some((s) => s?.toLowerCase().includes(q))) return false;
    if (get('from') && e.date < get('from')!) return false;
    if (get('to') && e.date > get('to')!) return false;
    if (minAmount !== undefined && e.amountMinor < minAmount) return false;
    if (maxAmount !== undefined && e.amountMinor > maxAmount) return false;
    if (get('category') && e.category !== get('category')) return false;
    if (get('payerId') && !e.payers.some((p) => p.memberId === get('payerId'))) return false;
    if (get('participantId') && !e.shares.some((s) => s.memberId === get('participantId'))) return false;
    if (get('planId') && e.planId !== get('planId')) return false;
    if (get('involvesMe') === 'true' && ![...e.payers, ...e.shares].some((p) => myMemberIds.has(p.memberId))) return false;
    return true;
  });
  const dir = get('order') === 'asc' ? 1 : -1;
  const payerName = (e: ExpenseDetail) => db.members.find((m) => m.id === e.payers[0]?.memberId)?.displayName ?? '';
  const sort = get('sort') ?? 'date';
  rows = [...rows].sort((a, b) => {
    switch (sort) {
      case 'amount':
        return dir * (a.amountMinor - b.amountMinor) || b.date.localeCompare(a.date);
      case 'category':
        return dir * a.category.localeCompare(b.category) || b.date.localeCompare(a.date);
      case 'created':
        return dir * a.createdAt.localeCompare(b.createdAt);
      case 'payer':
        return dir * payerName(a).localeCompare(payerName(b));
      default:
        return dir * (a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    }
  });
  const page = Math.max(1, Number(get('page') ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(get('pageSize') ?? 25) || 25));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize).map(expenseSummary), total: rows.length, page, pageSize };
}

route('GET', '/expenses', ({ db, query }) => {
  const allowed = accessibleGroupIds(db);
  const groupId = query.get('groupId');
  const scope = groupId ? allowed.filter((id) => id === groupId) : allowed;
  if (groupId && scope.length === 0) throw notFound('Group not found');
  return listExpenses(db, scope, query);
});
route('GET', '/groups/:groupId/expenses', ({ db, params, query }) => {
  const { group } = requireGroup(db, params.groupId!);
  return listExpenses(db, [group.id], query);
});

function expensesCsv(db: GuestDb, group: DbGroup, query: URLSearchParams) {
  const q = new URLSearchParams(query);
  q.set('page', '1');
  q.set('pageSize', '100');
  const all: ExpenseSummary[] = [];
  for (let page = 1; ; page++) {
    q.set('page', String(page));
    const res = listExpenses(db, [group.id], q);
    all.push(...res.items);
    if (all.length >= res.total || res.items.length === 0) break;
  }
  const name = (id: string) => db.members.find((m) => m.id === id)?.displayName ?? '';
  const custom = db.categories.filter((c) => c.groupId === group.id);
  const dec = getCurrency(group.currency).decimals;
  const rows = all.map((e) => [
    e.date,
    e.title,
    categoryLabel(e.category, custom),
    minorToDecimalString(e.amountMinor, dec),
    e.currency,
    e.payers.map((p) => `${name(p.memberId)} (${minorToDecimalString(p.amountMinor, dec)})`).join('; '),
    e.shares.map((s) => `${name(s.memberId)} (${minorToDecimalString(s.amountMinor, dec)})`).join('; '),
    e.splitMethod,
  ]);
  return new FileResult(`${slug(group.name)}-expenses.csv`, 'text/csv', toCsv(['Date', 'Title', 'Category', 'Amount', 'Currency', 'Paid by', 'Split', 'Split method'], rows));
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';

route('GET', '/groups/:groupId/expenses/export.csv', ({ db, params, query }) => expensesCsv(db, requireGroup(db, params.groupId!).group, query));

route('GET', '/groups/:groupId/expenses/:expenseId', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!);
  return { expense: findExpense(db, group.id, params.expenseId!) };
});

route('POST', '/groups/:groupId/expenses', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const input = body as ExpenseInput;
  const expense = materializeExpense(db, group.id, input, { id: newId('exp'), actorUserId: GUEST_USER_ID, createdAt: nowIso() });
  db.expenses.push(expense);
  logActivity(db, group.id, 'EXPENSE_CREATED', 'expense', expense.id, `${db.me.name} added "${expense.title}" (${formatMoney(expense.amountMinor, group.currency)})`, expense.planId);
  return { expense, replayed: false };
});

route('PUT', '/groups/:groupId/expenses/:expenseId', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const existing = findExpense(db, group.id, params.expenseId!);
  if (existing.deletedAt) throw conflict('Restore this expense before editing it.');
  const input = body as ExpenseUpdateInput;
  if (input.expectedVersion !== existing.version) {
    throw conflict('Someone else changed this expense while you were editing. Reload to see the latest version, then apply your changes again.', 'EDIT_CONFLICT');
  }
  const now = nowIso();
  const updated = materializeExpense(db, group.id, input, { id: existing.id, actorUserId: GUEST_USER_ID, createdAt: now, existing });
  if (existing.repeatInterval === updated.repeatInterval && existing.date === updated.date) updated.repeatNextDate = existing.repeatNextDate;
  updated.version = existing.version + 1;
  updated.revisions = [{ id: newId('rev'), version: updated.version, action: 'UPDATED', summary: 'Updated the expense', changedById: GUEST_USER_ID, createdAt: now }, ...existing.revisions];
  db.expenses[db.expenses.indexOf(existing)] = updated;
  logActivity(db, group.id, 'EXPENSE_EDITED', 'expense', updated.id, `${db.me.name} edited "${updated.title}"`, updated.planId);
  return { expense: updated };
});

route('DELETE', '/groups/:groupId/expenses/:expenseId', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const e = findExpense(db, group.id, params.expenseId!);
  if (e.deletedAt) throw conflict('This expense is already deleted.');
  const now = nowIso();
  e.deletedAt = now;
  e.version += 1;
  e.revisions.unshift({ id: newId('rev'), version: e.version, action: 'DELETED', summary: 'Deleted', changedById: GUEST_USER_ID, createdAt: now });
  logActivity(db, group.id, 'EXPENSE_DELETED', 'expense', e.id, `${db.me.name} deleted "${e.title}" (${formatMoney(e.amountMinor, group.currency)})`, e.planId);
  return ok;
});

route('POST', '/groups/:groupId/expenses/:expenseId/restore', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const e = findExpense(db, group.id, params.expenseId!);
  if (!e.deletedAt) throw conflict('This expense is not deleted.');
  const now = nowIso();
  e.deletedAt = null;
  e.version += 1;
  e.revisions.unshift({ id: newId('rev'), version: e.version, action: 'RESTORED', summary: 'Restored', changedById: GUEST_USER_ID, createdAt: now });
  logActivity(db, group.id, 'EXPENSE_RESTORED', 'expense', e.id, `${db.me.name} restored "${e.title}"`, e.planId);
  return ok;
});

route('POST', '/groups/:groupId/expenses/:expenseId/comments', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const e = findExpense(db, group.id, params.expenseId!);
  const text = String(body.body ?? '').trim();
  if (!text) throw badRequest('Write a comment first.', { body: 'Comment is required' });
  const comment = { id: newId('cmt'), authorId: GUEST_USER_ID, body: text, createdAt: nowIso() };
  e.comments.push(comment);
  logActivity(db, group.id, 'COMMENT', 'expense', e.id, `${db.me.name} commented on "${e.title}"`, e.planId);
  return { comment };
});
route('DELETE', '/groups/:groupId/expenses/:expenseId/comments/:commentId', ({ db, params }) => {
  const { group, me } = requireGroup(db, params.groupId!, 'editRecords');
  const e = findExpense(db, group.id, params.expenseId!);
  const comment = e.comments.find((c) => c.id === params.commentId);
  if (!comment) throw notFound('Comment not found');
  if (comment.authorId !== GUEST_USER_ID && me.role !== 'OWNER' && me.role !== 'ADMIN') throw forbidden('You can only delete your own comments.');
  e.comments = e.comments.filter((c) => c.id !== comment.id);
  return ok;
});
route('DELETE', '/attachments/:attachmentId', ({ db, params }) => {
  const e = db.expenses.find((x) => x.attachments.some((a) => a.id === params.attachmentId));
  if (!e) throw notFound('Receipt not found');
  requireGroup(db, e.groupId, 'editRecords');
  e.attachments = e.attachments.filter((a) => a.id !== params.attachmentId);
  logActivity(db, e.groupId, 'RECEIPT_REMOVED', 'expense', e.id, `${db.me.name} removed a receipt`, e.planId);
  return ok;
});

// =====================================================================
// Balances & settlements
// =====================================================================

route('GET', '/groups/:groupId/balances', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!);
  const ledger = groupLedger(db, group.id);
  return { currency: group.currency, totalSpendingMinor: ledger.totalSpendingMinor, balances: ledger.balances, suggestions: ledger.suggestions, simplifyDebts: ledger.simplifyDebts };
});
route('GET', '/groups/:groupId/settlements', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!);
  return { settlements: db.settlements.filter((s) => s.groupId === group.id).sort(newestFirst) };
});
route('GET', '/groups/:groupId/settlements/export.csv', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!);
  const name = (id: string) => db.members.find((m) => m.id === id)?.displayName ?? '';
  const dec = getCurrency(group.currency).decimals;
  const rows = db.settlements
    .filter((s) => s.groupId === group.id)
    .sort(newestFirst)
    .map((s) => [s.date, name(s.fromMemberId), name(s.toMemberId), minorToDecimalString(s.amountMinor, dec), s.currency, SETTLEMENT_METHOD_LABELS[s.method], s.status, s.notes ?? '']);
  return new FileResult(`${slug(group.name)}-settlements.csv`, 'text/csv', toCsv(['Date', 'From', 'To', 'Amount', 'Currency', 'Method', 'Status', 'Notes'], rows));
});

function recordSettlement(db: GuestDb, group: DbGroup, from: DbMember, to: DbMember, input: Omit<SettlementInput, 'fromMemberId' | 'toMemberId' | 'clientRequestId'>): Settlement {
  const settlement: Settlement = {
    id: newId('set'),
    groupId: group.id,
    fromMemberId: from.id,
    toMemberId: to.id,
    amountMinor: input.amountMinor,
    currency: group.currency,
    method: input.method,
    methodNote: input.methodNote ?? null,
    date: input.date,
    notes: input.notes ?? null,
    status: 'RECORDED',
    recordedById: GUEST_USER_ID,
    createdAt: nowIso(),
    reversedAt: null,
    reversedById: null,
    reversalReason: null,
  };
  db.settlements.push(settlement);
  logActivity(
    db,
    group.id,
    'SETTLEMENT_RECORDED',
    'settlement',
    settlement.id,
    `${db.me.name} recorded ${from.displayName} paying ${to.displayName} ${formatMoney(input.amountMinor, group.currency)} (${SETTLEMENT_METHOD_LABELS[input.method]})`,
  );
  return settlement;
}

route('POST', '/groups/:groupId/settlements', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const input = body as SettlementInput;
  const from = db.members.find((m) => m.id === input.fromMemberId && m.groupId === group.id);
  const to = db.members.find((m) => m.id === input.toMemberId && m.groupId === group.id);
  if (!from || !to) throw notFound('Both members must belong to this group');
  if (from.status !== 'ACTIVE' || to.status !== 'ACTIVE') throw conflict('Both members must still be active in this group');
  if (from.id === to.id) throw badRequest('Payer and recipient must be different members');
  if (!(input.amountMinor > 0)) throw badRequest('Amount must be greater than zero', { amountMinor: 'Amount must be greater than zero' });
  return { settlement: recordSettlement(db, group, from, to, input), replayed: false };
});

route('POST', '/groups/:groupId/settlements/:settlementId/reverse', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const settlement = db.settlements.find((s) => s.id === params.settlementId && s.groupId === group.id);
  if (!settlement) throw notFound('Settlement not found');
  if (settlement.status === 'REVERSED') throw conflict('This repayment has already been reversed.');
  Object.assign(settlement, { status: 'REVERSED', reversedAt: nowIso(), reversedById: GUEST_USER_ID, reversalReason: String(body.reason ?? '').trim() || null });
  logActivity(db, group.id, 'SETTLEMENT_REVERSED', 'settlement', settlement.id, `${db.me.name} reversed a repayment of ${formatMoney(settlement.amountMinor, group.currency)}`);
  return { settlement };
});

route('GET', '/settlements', ({ db }): SettlementsOverview => {
  const groupIds = accessibleGroupIds(db);
  const groups = db.groups.filter((g) => groupIds.includes(g.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const overview = groups.map((g) => {
    const ledger = groupLedger(db, g.id);
    const me = myMembership(db, g.id)!;
    return {
      groupId: g.id,
      groupName: g.name,
      currency: g.currency,
      accent: g.accent,
      role: me.role,
      myMemberId: me.id,
      myNetMinor: ledger.balances.find((b) => b.memberId === me.id)?.netMinor ?? 0,
      suggestions: ledger.suggestions,
      simplifyDebts: ledger.simplifyDebts,
      isDirect: g.directKey !== null,
    };
  });
  const historyGroupIds = accessibleGroupIds(db, true);
  const history = db.settlements.filter((s) => historyGroupIds.includes(s.groupId)).sort(newestFirst).slice(0, 100);
  const memberIds = new Set([...history.flatMap((s) => [s.fromMemberId, s.toMemberId]), ...overview.flatMap((o) => o.suggestions.flatMap((t) => [t.fromMemberId, t.toMemberId]))]);
  return {
    groups: overview,
    history,
    members: db.members.filter((m) => memberIds.has(m.id)).map((m) => ({ id: m.id, displayName: m.displayName, isYou: m.userId === GUEST_USER_ID })),
  };
});

// =====================================================================
// Friends
// =====================================================================

function friendKey(m: DbMember): string {
  if (m.userId) return `u.${m.userId}`;
  if (m.email) return `e.${m.email.toLowerCase()}`;
  return `m.${m.id}`;
}

function loadFriends(db: GuestDb): Friend[] {
  const friends = new Map<string, Friend>();
  for (const me of db.members.filter((m) => m.userId === GUEST_USER_ID && m.status === 'ACTIVE')) {
    const group = db.groups.find((g) => g.id === me.groupId)!;
    const others = groupMembers(db, group.id).filter((m) => m.id !== me.id && m.userId !== GUEST_USER_ID && m.email?.toLowerCase() !== db.me.email);
    if (others.length === 0) continue;
    const ledger = groupLedger(db, group.id);
    for (const m of others) {
      const netMinor = netBetween(ledger.suggestions, me.id, m.id);
      if (m.status !== 'ACTIVE' && netMinor === 0) continue;
      const key = friendKey(m);
      let friend = friends.get(key);
      if (!friend) {
        const user = userById(db, m.userId);
        friend = { key, name: user?.name ?? m.displayName, email: user?.email ?? m.email, userId: m.userId, avatarColor: user?.avatarColor ?? null, isPlaceholder: !m.userId, balances: [], groups: [], directGroupId: null };
        friends.set(key, friend);
      }
      const entry: FriendGroup = {
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
      };
      friend.groups.push(entry);
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

function findFriend(db: GuestDb, key: string): Friend {
  const friend = loadFriends(db).find((f) => f.key === key);
  if (!friend) throw notFound('Friend not found');
  return friend;
}

route('GET', '/friends', ({ db }) => ({ friends: loadFriends(db) }));
route('GET', '/friends/:key', ({ db, params }) => {
  const friend = findFriend(db, params.key!);
  const involves = (e: ExpenseDetail, memberId: string) => e.payers.some((p) => p.memberId === memberId) || e.shares.some((s) => s.memberId === memberId);
  const expenses = db.expenses
    .filter((e) => !e.deletedAt && friend.groups.some((g) => g.groupId === e.groupId && involves(e, g.myMemberId) && involves(e, g.theirMemberId)))
    .sort(newestFirst)
    .slice(0, 50)
    .map(expenseSummary);
  const settlements = db.settlements
    .filter((s) =>
      friend.groups.some(
        (g) => g.groupId === s.groupId && ((s.fromMemberId === g.myMemberId && s.toMemberId === g.theirMemberId) || (s.fromMemberId === g.theirMemberId && s.toMemberId === g.myMemberId)),
      ),
    )
    .sort(newestFirst)
    .slice(0, 50);
  return { friend, expenses, settlements };
});

route('POST', '/friends/:key/settle', ({ db, params, body }) => {
  const input = body as FriendSettleInput;
  const friend = findFriend(db, params.key!);
  const groups = friend.groups.filter((g) => g.currency === input.currency && g.netMinor !== 0);
  const net = groups.reduce((a, g) => a + g.netMinor, 0);
  if (net === 0) throw conflict(`You and ${friend.name} are settled up in ${input.currency}.`);
  if (input.amountMinor > Math.abs(net)) {
    throw badRequest(`That is more than the ${formatMoney(Math.abs(net), input.currency)} outstanding with ${friend.name}.`, { amountMinor: 'Amount is more than the balance' });
  }
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
  const settlements: Settlement[] = [];
  for (const { group: g, amount } of plan) {
    if (g.archived) throw conflict(`${g.groupName} is archived. Restore it to record repayments.`, 'ARCHIVED');
    if (!can(g.role, 'editRecords')) throw forbidden(`You can only view ${g.groupName}, so you cannot record repayments there.`);
    if (g.theirStatus !== 'ACTIVE') throw conflict(`${friend.name} has left ${g.groupName}. Settle that balance from the group's page.`);
    const group = db.groups.find((x) => x.id === g.groupId)!;
    const me = db.members.find((m) => m.id === g.myMemberId)!;
    const them = db.members.find((m) => m.id === g.theirMemberId)!;
    const theyPay = g.netMinor > 0;
    settlements.push(
      recordSettlement(db, group, theyPay ? them : me, theyPay ? me : them, {
        amountMinor: amount,
        method: input.method,
        methodNote: input.methodNote,
        date: input.date,
        notes: input.notes ?? (plan.length > 1 ? `Settle up with ${friend.name} across groups` : null),
      }),
    );
  }
  return { settlements, replayed: false };
});

const reminded = new Set<string>();
route('POST', '/friends/:key/remind', ({ db, params }) => {
  const friend = findFriend(db, params.key!);
  if (!friend.userId) throw conflict(`${friend.name} does not have a ShareSpace account yet. Invite them from the group's members page.`);
  if (!friend.balances.some((b) => b.netMinor > 0)) throw conflict(`${friend.name} does not owe you anything.`);
  const key = `${friend.key}:${todayIso()}`;
  if (reminded.has(key)) throw conflict(`You already reminded ${friend.name} today.`);
  reminded.add(key);
  return ok;
});

route('POST', '/friends/:key/direct', ({ db, params, body }) => {
  const friend = findFriend(db, params.key!);
  if (!friend.userId) throw conflict(`${friend.name} needs a ShareSpace account for expenses outside a group. Add this expense in a shared group instead.`);
  const directKey = [GUEST_USER_ID, friend.userId].sort().join(':');
  const existing = db.groups.find((g) => g.directKey === directKey);
  if (existing) return { groupId: existing.id, created: false };
  const friendUser = userById(db, friend.userId)!;
  const now = nowIso();
  const group: DbGroup = {
    id: newId('grp'),
    name: `${db.me.name} & ${friendUser.name}`,
    description: 'Expenses outside any group',
    type: 'GENERAL',
    currency: body.currency ?? db.preferences.currency,
    accent: ACCENTS[0],
    simplifyDebts: true,
    multiCurrency: false,
    directKey,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ownerId: GUEST_USER_ID,
  };
  db.groups.push(group);
  db.members.push(
    { id: newId('mem'), groupId: group.id, displayName: db.me.name, email: db.me.email, role: 'OWNER', status: 'ACTIVE', userId: GUEST_USER_ID, joinedAt: now, leftAt: null },
    { id: newId('mem'), groupId: group.id, displayName: friendUser.name, email: friendUser.email, role: 'ADMIN', status: 'ACTIVE', userId: friendUser.id, joinedAt: now, leftAt: null },
  );
  logActivity(db, group.id, 'GROUP_CREATED', 'group', group.id, `${db.me.name} started tracking expenses with ${friendUser.name}`);
  return { groupId: group.id, created: true };
});

// =====================================================================
// Budget
// =====================================================================

route('GET', '/groups/:groupId/budget', ({ db, params }): BudgetResponse => {
  const { group } = requireGroup(db, params.groupId!);
  const snap = budgetSnapshot(db, group.id);
  if (!snap) return { budget: null };
  const { budget, inRange, status } = snap;
  const rows: ReportExpense[] = inRange.map((e) => ({ id: e.id, groupId: e.groupId, date: e.date, category: e.category, amountMinor: e.amountMinor, payers: [], shares: [] }));
  const today = todayIso();
  const dates = rows.map((r) => r.date).sort();
  const trendFrom = budget.startDate ?? dates[0] ?? today;
  const trendTo = budget.endDate && budget.endDate < today ? budget.endDate : today;
  const granularity = trendFrom <= trendTo ? pickGranularity(trendFrom, trendTo) : 'day';
  let running = 0;
  const trend = (trendFrom <= trendTo ? spendingOverTime(rows, granularity, trendFrom, trendTo) : []).map((b) => {
    running += b.amountMinor;
    return { key: b.key, amountMinor: b.amountMinor, cumulativeMinor: running };
  });
  return {
    budget: {
      id: budget.id,
      totalMinor: budget.totalMinor,
      currency: budget.currency,
      startDate: budget.startDate,
      endDate: budget.endDate,
      warningThresholdPct: budget.warningThresholdPct,
      categories: budget.categories,
      updatedAt: budget.updatedAt,
    },
    status,
    categories: budget.categories.map((c) => {
      const spent = rows.filter((r) => r.category === c.category).reduce((a, r) => a + r.amountMinor, 0);
      return { category: c.category, ...computeBudgetStatus(c.amountMinor, spent, budget.warningThresholdPct) };
    }),
    byCategory: spendingByCategory(rows),
    trend,
    granularity,
    recent: [...inRange].sort(newestFirst).slice(0, 5).map(expenseSummary),
  };
});

route('PUT', '/groups/:groupId/budget', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'manageSettings');
  const input = body as BudgetInput;
  const existing = db.budgets.find((b) => b.groupId === group.id);
  const data = {
    totalMinor: input.totalMinor,
    currency: group.currency,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    warningThresholdPct: input.warningThresholdPct ?? 80,
    categories: input.categories ?? [],
    updatedAt: nowIso(),
  };
  if (existing) Object.assign(existing, data);
  else db.budgets.push({ id: newId('bud'), groupId: group.id, ...data });
  logActivity(db, group.id, existing ? 'BUDGET_CHANGED' : 'BUDGET_CREATED', 'budget', existing?.id ?? null, `${db.me.name} ${existing ? 'changed' : 'set'} the budget to ${formatMoney(input.totalMinor, group.currency)}`);
  return ok;
});

route('DELETE', '/groups/:groupId/budget', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'manageSettings');
  if (!db.budgets.some((b) => b.groupId === group.id)) throw notFound('This group has no budget.');
  db.budgets = db.budgets.filter((b) => b.groupId !== group.id);
  logActivity(db, group.id, 'BUDGET_REMOVED', 'budget', null, `${db.me.name} removed the budget`);
  return ok;
});

// =====================================================================
// Plans, itinerary, checklist & polls
// =====================================================================

route('GET', '/plans', ({ db }) => {
  const groupIds = accessibleGroupIds(db);
  return {
    plans: db.plans
      .filter((p) => groupIds.includes(p.groupId))
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((p) => {
        const g = db.groups.find((x) => x.id === p.groupId)!;
        return { ...planSummary(db, p), groupName: g.name, groupAccent: g.accent, currency: g.currency };
      }),
  };
});

route('GET', '/groups/:groupId/plans', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!);
  return { plans: db.plans.filter((p) => p.groupId === group.id).sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p) => planSummary(db, p)) };
});

function planFields(input: PlanInput) {
  return {
    title: input.title.trim(),
    description: input.description || null,
    type: input.type,
    status: input.status ?? 'PLANNING',
    startDate: input.startDate,
    endDate: input.endDate || null,
    location: input.location || null,
    estimatedBudgetMinor: input.estimatedBudgetMinor ?? null,
    participantIds: input.participantIds ?? [],
    notes: input.notes || null,
  };
}

route('POST', '/groups/:groupId/plans', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan: DbPlan = { id: newId('plan'), groupId: group.id, itinerary: [], checklist: [], createdById: GUEST_USER_ID, createdAt: nowIso(), ...planFields(body as PlanInput) };
  db.plans.push(plan);
  logActivity(db, group.id, 'PLAN_CREATED', 'plan', plan.id, `${db.me.name} created the plan "${plan.title}"`, plan.id);
  return { plan: planSummary(db, plan) };
});

route('GET', '/groups/:groupId/plans/:planId', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!);
  const plan = findPlan(db, group.id, params.planId!);
  return {
    plan: {
      ...planSummary(db, plan),
      notes: plan.notes,
      itinerary: [...plan.itinerary].sort((a, b) => a.position - b.position),
      checklist: [...plan.checklist].sort((a, b) => a.position - b.position),
      expenses: db.expenses.filter((e) => e.planId === plan.id && !e.deletedAt).sort(newestFirst).map(expenseSummary),
      activity: db.activity.filter((a) => a.groupId === group.id && a.planId === plan.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
      polls: listPolls(db, group.id, plan.id),
    },
  };
});

route('PUT', '/groups/:groupId/plans/:planId', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan = findPlan(db, group.id, params.planId!);
  const input = body as PlanInput;
  const statusChanged = plan.status !== (input.status ?? 'PLANNING');
  Object.assign(plan, planFields(input));
  logActivity(
    db,
    group.id,
    'PLAN_UPDATED',
    'plan',
    plan.id,
    statusChanged ? `${db.me.name} marked "${plan.title}" as ${PLAN_STATUS_LABELS[plan.status].toLowerCase()}` : `${db.me.name} updated the plan "${plan.title}"`,
    plan.id,
  );
  return ok;
});

route('DELETE', '/groups/:groupId/plans/:planId', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan = findPlan(db, group.id, params.planId!);
  db.plans = db.plans.filter((p) => p.id !== plan.id);
  for (const e of db.expenses) if (e.planId === plan.id) Object.assign(e, { planId: null, plan: null });
  logActivity(db, group.id, 'PLAN_ARCHIVED', 'plan', plan.id, `${db.me.name} removed the plan "${plan.title}"`);
  return ok;
});

function itineraryFields(input: ItineraryItemInput) {
  return {
    title: input.title.trim(),
    description: input.description || null,
    date: input.date || null,
    startTime: input.startTime || null,
    endTime: input.endTime || null,
    location: input.location || null,
    estimatedCostMinor: input.estimatedCostMinor ?? null,
    notes: input.notes || null,
  };
}

route('POST', '/groups/:groupId/plans/:planId/itinerary', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan = findPlan(db, group.id, params.planId!);
  const item = { id: newId('it'), position: plan.itinerary.length, ...itineraryFields(body as ItineraryItemInput) };
  plan.itinerary.push(item);
  logActivity(db, group.id, 'ITINERARY_ADDED', 'plan', plan.id, `${db.me.name} added "${item.title}" to the itinerary`, plan.id);
  return { id: item.id };
});
route('PUT', '/groups/:groupId/plans/:planId/itinerary/:itemId', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const item = findPlan(db, group.id, params.planId!).itinerary.find((i) => i.id === params.itemId);
  if (!item) throw notFound('Itinerary item not found');
  Object.assign(item, itineraryFields(body as ItineraryItemInput));
  return ok;
});
route('DELETE', '/groups/:groupId/plans/:planId/itinerary/:itemId', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan = findPlan(db, group.id, params.planId!);
  plan.itinerary = plan.itinerary.filter((i) => i.id !== params.itemId).map((i, position) => ({ ...i, position }));
  return ok;
});

function reorder<T extends { id: string; position: number }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = ids.map((id) => byId.get(id)).filter((i): i is T => !!i);
  const rest = items.filter((i) => !ids.includes(i.id));
  return [...ordered, ...rest].map((i, position) => ({ ...i, position }));
}

route('POST', '/groups/:groupId/plans/:planId/itinerary/reorder', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan = findPlan(db, group.id, params.planId!);
  plan.itinerary = reorder(plan.itinerary, body.ids ?? []);
  return ok;
});

route('POST', '/groups/:groupId/plans/:planId/checklist', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan = findPlan(db, group.id, params.planId!);
  const item = {
    id: newId('ck'),
    position: plan.checklist.length,
    title: String(body.title ?? '').trim(),
    assigneeMemberId: body.assigneeMemberId ?? null,
    dueDate: body.dueDate ?? null,
    completedAt: null,
    completedById: null,
  };
  plan.checklist.push(item);
  logActivity(db, group.id, 'CHECKLIST_ADDED', 'plan', plan.id, `${db.me.name} added "${item.title}" to the checklist`, plan.id);
  return { id: item.id };
});
route('PATCH', '/groups/:groupId/plans/:planId/checklist/:itemId', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan = findPlan(db, group.id, params.planId!);
  const item = plan.checklist.find((i) => i.id === params.itemId);
  if (!item) throw notFound('Checklist item not found');
  if (body.title !== undefined) item.title = String(body.title).trim();
  if (body.assigneeMemberId !== undefined) item.assigneeMemberId = body.assigneeMemberId;
  if (body.dueDate !== undefined) item.dueDate = body.dueDate;
  if (body.completed !== undefined) {
    item.completedAt = body.completed ? nowIso() : null;
    item.completedById = body.completed ? GUEST_USER_ID : null;
    if (body.completed) logActivity(db, group.id, 'CHECKLIST_COMPLETED', 'plan', plan.id, `${db.me.name} completed "${item.title}"`, plan.id);
  }
  return ok;
});
route('DELETE', '/groups/:groupId/plans/:planId/checklist/:itemId', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan = findPlan(db, group.id, params.planId!);
  plan.checklist = plan.checklist.filter((i) => i.id !== params.itemId).map((i, position) => ({ ...i, position }));
  return ok;
});
route('POST', '/groups/:groupId/plans/:planId/checklist/reorder', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const plan = findPlan(db, group.id, params.planId!);
  plan.checklist = reorder(plan.checklist, body.ids ?? []);
  return ok;
});

route('GET', '/groups/:groupId/polls', ({ db, params, query }) => {
  const { group } = requireGroup(db, params.groupId!);
  return { polls: listPolls(db, group.id, query.get('planId') ?? undefined) };
});
route('POST', '/groups/:groupId/polls', ({ db, params, body }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const input = body as PollInput;
  const id = newId('poll');
  const poll: DbPoll = {
    id,
    groupId: group.id,
    planId: input.planId ?? null,
    question: input.question.trim(),
    closesAt: input.closesAt ?? null,
    closedAt: null,
    allowVoteChange: input.allowVoteChange ?? true,
    createdById: GUEST_USER_ID,
    createdAt: nowIso(),
    eligibleMemberIds: input.eligibleMemberIds ?? [],
    options: input.options.map((label, i) => ({ id: `${id}-opt-${i}`, label: label.trim() })),
    votes: [],
  };
  db.polls.push(poll);
  logActivity(db, group.id, 'POLL_CREATED', 'poll', poll.id, `${db.me.name} started a poll: "${poll.question}"`, poll.planId);
  return { id };
});

function findPoll(db: GuestDb, groupId: string, pollId: string): DbPoll {
  finalizeExpiredPolls(db, groupId);
  const poll = db.polls.find((p) => p.id === pollId && p.groupId === groupId);
  if (!poll) throw notFound('Poll not found');
  return poll;
}

route('POST', '/groups/:groupId/polls/:pollId/vote', ({ db, params, body }) => {
  const { group, me } = requireGroup(db, params.groupId!, 'editRecords');
  const poll = findPoll(db, group.id, params.pollId!);
  if (poll.closedAt) throw conflict('This poll is closed.');
  if (poll.eligibleMemberIds.length && !poll.eligibleMemberIds.includes(me.id)) throw forbidden('You are not eligible to vote in this poll.');
  if (!poll.options.some((o) => o.id === body.optionId)) throw notFound('Option not found');
  const existing = poll.votes.find((v) => v.memberId === me.id);
  if (existing && !poll.allowVoteChange) throw conflict('Votes in this poll cannot be changed.');
  poll.votes = [...poll.votes.filter((v) => v.memberId !== me.id), { memberId: me.id, optionId: body.optionId }];
  return ok;
});
route('DELETE', '/groups/:groupId/polls/:pollId/vote', ({ db, params }) => {
  const { group, me } = requireGroup(db, params.groupId!, 'editRecords');
  const poll = findPoll(db, group.id, params.pollId!);
  if (poll.closedAt) throw conflict('This poll is closed.');
  if (!poll.allowVoteChange) throw conflict('Votes in this poll cannot be changed.');
  poll.votes = poll.votes.filter((v) => v.memberId !== me.id);
  return ok;
});
route('POST', '/groups/:groupId/polls/:pollId/close', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!, 'editRecords');
  const poll = findPoll(db, group.id, params.pollId!);
  if (poll.closedAt) throw conflict('This poll is already closed.');
  poll.closedAt = nowIso();
  const counts = poll.options.map((o) => ({ label: o.label, votes: poll.votes.filter((v) => v.optionId === o.id).length }));
  const max = Math.max(0, ...counts.map((c) => c.votes));
  const winners = max > 0 ? counts.filter((c) => c.votes === max).map((c) => c.label) : [];
  const outcome =
    winners.length === 0 ? 'no votes were cast' : winners.length === 1 ? `"${winners[0]}" won with ${max} vote${max === 1 ? '' : 's'}` : `tie between ${winners.map((w) => `"${w}"`).join(' and ')}`;
  logActivity(db, group.id, 'POLL_CLOSED', 'poll', poll.id, `Poll closed: "${poll.question}" — ${outcome}`, poll.planId);
  return ok;
});

// =====================================================================
// Activity & notifications
// =====================================================================

route('GET', '/groups/:groupId/activity', ({ db, params, query }) => {
  const { group } = requireGroup(db, params.groupId!);
  const before = query.get('before');
  const planId = query.get('planId');
  const items: Activity[] = db.activity
    .filter((a) => a.groupId === group.id && (!planId || a.planId === planId) && (!before || a.createdAt < before))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items: items.slice(0, 30), hasMore: items.length > 30 };
});

const unreadCount = (db: GuestDb) => db.notifications.filter((n) => !n.readAt).length;
route('GET', '/notifications', ({ db, query }) => {
  const unreadOnly = query.get('unread') === 'true';
  const items: Notification[] = db.notifications.filter((n) => !unreadOnly || !n.readAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  return { items, unreadCount: unreadCount(db) };
});
route('GET', '/notifications/unread-count', ({ db }) => ({ unreadCount: unreadCount(db) }));
route('POST', '/notifications/read-all', ({ db }) => {
  const now = nowIso();
  for (const n of db.notifications) n.readAt ??= now;
  return ok;
});
route('POST', '/notifications/:id/:state', ({ db, params }) => {
  const n = db.notifications.find((x) => x.id === params.id);
  if (!n || (params.state !== 'read' && params.state !== 'unread')) throw notFound('Notification not found');
  n.readAt = params.state === 'read' ? nowIso() : null;
  return ok;
});

// =====================================================================
// Group exports
// =====================================================================

route('GET', '/groups/:groupId/export/members.csv', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!);
  const ledger = groupLedger(db, group.id);
  const dec = getCurrency(group.currency).decimals;
  const rows = groupMembers(db, group.id).map((m) => [
    m.displayName,
    m.email ?? '',
    ROLE_LABELS[m.role],
    m.status,
    m.joinedAt.slice(0, 10),
    minorToDecimalString(ledger.balances.find((b) => b.memberId === m.id)?.netMinor ?? 0, dec),
  ]);
  return new FileResult(`${slug(group.name)}-members.csv`, 'text/csv', toCsv(['Name', 'Email', 'Role', 'Status', 'Joined', `Balance (${group.currency})`], rows));
});
route('GET', '/groups/:groupId/export/backup.json', ({ db, params }) => {
  const { group } = requireGroup(db, params.groupId!);
  const data = {
    exportedAt: nowIso(),
    note: 'ShareSpace guest demo: sample data only.',
    group,
    members: groupMembers(db, group.id).map((m) => memberOut(db, m)),
    expenses: db.expenses.filter((e) => e.groupId === group.id),
    settlements: db.settlements.filter((s) => s.groupId === group.id),
    budget: db.budgets.find((b) => b.groupId === group.id) ?? null,
    plans: db.plans.filter((p) => p.groupId === group.id),
  };
  return new FileResult(`${slug(group.name)}-backup.json`, 'application/json', JSON.stringify(data, null, 2));
});
