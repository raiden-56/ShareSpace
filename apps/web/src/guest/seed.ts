/**
 * Sample data for guest mode: three active groups (a trip crew, a shared flat and a dinner club),
 * an archived group, a pending invitation, plans, polls, settlements, receipts and notifications.
 * Dates are relative to today so recent activity, upcoming plans and the current budget period
 * always look current. Every split goes through the core split engine, so balances add up.
 */
import {
  DEFAULT_PREFERENCES,
  formatMoney,
  occurrenceDate,
  SETTLEMENT_METHOD_LABELS,
  type RepeatInterval,
  type SettlementMethod,
  type SplitMethod,
} from '@sharespace/core';
import type { ExpenseDetail, User } from '../api/types';
import { at, dayOffset, isoDay, materializeExpense, nowIso, todayIso, type DbMember, type DbPlan, type GuestDb } from './db';
import { GUEST_USER_ID, registerGuestAttachment } from './mode';
import { receiptSvg, svgUrl, type ReceiptSpec } from './receipts';

const CURRENCY = 'INR';
const rupees = (amount: number) => Math.round(amount * 100);

const ME: User = {
  id: GUEST_USER_ID,
  email: 'guest@sharespace.demo',
  name: 'Guest User',
  avatarColor: '#386641',
  createdAt: at(dayOffset(-140), 10),
};

const USERS: User[] = [
  { id: 'u-priya', email: 'priya.nair@example.com', name: 'Priya Nair', avatarColor: '#D58B42', createdAt: at(dayOffset(-300)) },
  { id: 'u-rahul', email: 'rahul.mehta@example.com', name: 'Rahul Mehta', avatarColor: '#4C8157', createdAt: at(dayOffset(-280)) },
  { id: 'u-ananya', email: 'ananya.iyer@example.com', name: 'Ananya Iyer', avatarColor: '#A2674A', createdAt: at(dayOffset(-260)) },
  { id: 'u-meera', email: 'meera.kapoor@example.com', name: 'Meera Kapoor', avatarColor: '#C96F52', createdAt: at(dayOffset(-250)) },
  { id: 'u-ishaan', email: 'ishaan.verma@example.com', name: 'Ishaan Verma', avatarColor: '#6B7F5E', createdAt: at(dayOffset(-420)) },
];

interface ExpenseSpec {
  id: string;
  groupId: string;
  day: string;
  time?: [number, number];
  title: string;
  category: string;
  amount: number;
  /** One payer (member id) or several [memberId, rupees]. */
  paidBy: string | [string, number][];
  among: string[];
  method?: Exclude<SplitMethod, 'ITEMIZED'>;
  /** Per participant in `among` order: rupees (EXACT, ADJUSTMENT), percent (PERCENTAGE) or shares (SHARES). */
  values?: number[];
  items?: { description: string; quantity: number; unitPrice: number; memberIds: string[] }[];
  planId?: string;
  description?: string;
  notes?: string;
  repeat?: RepeatInterval;
  recurringSourceId?: string;
  comments?: { userId: string; body: string; minutesLater: number }[];
  receipt?: Omit<ReceiptSpec, 'currency' | 'date'> & { fileName: string };
}

export function createSeed(): GuestDb {
  const now = Date.now();
  const db: GuestDb = {
    me: { ...ME },
    preferences: { ...DEFAULT_PREFERENCES, notifications: { ...DEFAULT_PREFERENCES.notifications }, onboardingCompleted: true, tourCompleted: true },
    users: [{ ...ME }, ...USERS.map((u) => ({ ...u }))],
    groups: [],
    members: [],
    categories: [],
    expenses: [],
    settlements: [],
    budgets: [],
    plans: [],
    polls: [],
    activity: [],
    notifications: [],
    invitations: [],
    sessions: [
      { id: 'session-current', userAgent: navigator.userAgent, createdAt: nowIso(), lastSeenAt: nowIso(), current: true },
      {
        id: 'session-phone',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
        createdAt: at(dayOffset(-21), 9, 12),
        lastSeenAt: at(dayOffset(-2), 22, 40),
        current: false,
      },
    ],
  };

  const userName = (userId: string) => db.users.find((u) => u.id === userId)?.name ?? 'Someone';
  /** Timestamps never land in the future (an expense dated today is "added" a few minutes ago). */
  const stamp = (day: string, hour: number, minute = 0) => {
    const t = at(day, hour, minute);
    return Date.parse(t) > now ? new Date(now - 7 * 60_000).toISOString() : t;
  };
  let activitySeq = 0;
  const log = (groupId: string, actorUserId: string | null, type: string, entityType: string, entityId: string | null, summary: string, createdAt: string, planId: string | null = null) => {
    db.activity.push({
      id: `act-${++activitySeq}`,
      groupId,
      actorUserId,
      actorName: actorUserId ? userName(actorUserId) : 'ShareSpace',
      type,
      entityType,
      entityId,
      planId,
      summary,
      createdAt,
    });
  };

  const addGroup = (g: Omit<GuestDb['groups'][number], 'multiCurrency' | 'directKey' | 'updatedAt'> & { multiCurrency?: boolean }) => {
    db.groups.push({ multiCurrency: false, directKey: null, updatedAt: g.createdAt, ...g });
    log(g.id, g.ownerId, 'GROUP_CREATED', 'group', g.id, `${userName(g.ownerId)} created the group`, g.createdAt);
  };
  const addMember = (m: Omit<DbMember, 'status' | 'leftAt' | 'email'> & { email?: string | null }) => {
    const user = m.userId ? db.users.find((u) => u.id === m.userId) : undefined;
    db.members.push({ status: 'ACTIVE', leftAt: null, ...m, email: m.email ?? user?.email ?? null });
    const owner = db.groups.find((g) => g.id === m.groupId)!.ownerId;
    if (m.userId === owner) return;
    if (m.userId) log(m.groupId, m.userId, 'MEMBER_JOINED', 'member', m.id, `${m.displayName} joined the group`, m.joinedAt);
    else log(m.groupId, owner, 'MEMBER_ADDED', 'member', m.id, `${userName(owner)} added ${m.displayName}`, m.joinedAt);
  };
  const memberUser = (memberId: string) => db.members.find((m) => m.id === memberId)?.userId ?? null;

  const addExpense = (s: ExpenseSpec): ExpenseDetail => {
    const amountMinor = rupees(s.amount);
    const payers = typeof s.paidBy === 'string' ? [{ memberId: s.paidBy, amountMinor }] : s.paidBy.map(([memberId, r]) => ({ memberId, amountMinor: rupees(r) }));
    const method: SplitMethod = s.items ? 'ITEMIZED' : (s.method ?? 'EQUAL');
    // EXACT and ADJUSTMENT take minor units; PERCENTAGE takes basis points; SHARES takes hundredths.
    const scale = (v: number) => (method === 'EXACT' || method === 'ADJUSTMENT' ? rupees(v) : Math.round(v * 100));
    const createdAt = stamp(s.day, s.time?.[0] ?? 20, s.time?.[1] ?? 15);
    const group = db.groups.find((g) => g.id === s.groupId)!;
    const actor = memberUser(payers[0]!.memberId) ?? group.ownerId;
    const expense = materializeExpense(
      db,
      s.groupId,
      {
        title: s.title,
        description: s.description ?? null,
        notes: s.notes ?? null,
        amountMinor,
        currency: CURRENCY,
        fxRate: null,
        date: s.day,
        category: s.category,
        planId: s.planId ?? null,
        payers,
        split: {
          method,
          participants: s.items ? [] : s.among.map((memberId, i) => ({ memberId, value: s.values ? scale(s.values[i]!) : undefined })),
          items: s.items?.map((it) => ({ description: it.description, quantity: it.quantity, unitPriceMinor: rupees(it.unitPrice), memberIds: it.memberIds })),
          adjustments: s.items ? { taxMinor: 0, serviceMinor: 0, discountMinor: 0 } : undefined,
        },
        repeat: s.repeat ?? 'NONE',
      },
      { id: s.id, actorUserId: actor, createdAt, recurringSourceId: s.recurringSourceId ?? null },
    );
    expense.comments = (s.comments ?? []).map((c, i) => ({
      id: `${s.id}-c${i + 1}`,
      authorId: c.userId,
      body: c.body,
      createdAt: new Date(Math.min(Date.parse(createdAt) + c.minutesLater * 60_000, now - 60_000)).toISOString(),
    }));
    if (s.receipt) {
      const svg = receiptSvg({ ...s.receipt, currency: CURRENCY, date: s.day });
      const attachmentId = `${s.id}-receipt`;
      registerGuestAttachment(attachmentId, svgUrl(svg));
      expense.attachments = [
        { id: attachmentId, fileName: s.receipt.fileName, mimeType: 'image/svg+xml', sizeBytes: svg.length, uploadedById: actor, createdAt },
      ];
    }
    db.expenses.push(expense);
    const amountText = formatMoney(amountMinor, CURRENCY);
    log(s.groupId, actor, 'EXPENSE_CREATED', 'expense', s.id, `${userName(actor)} added "${s.title}" (${amountText})`, createdAt, s.planId ?? null);
    for (const c of expense.comments) log(s.groupId, c.authorId, 'COMMENT', 'expense', s.id, `${userName(c.authorId)} commented on "${s.title}"`, c.createdAt, s.planId ?? null);
    if (s.receipt) log(s.groupId, actor, 'RECEIPT_ADDED', 'expense', s.id, `${userName(actor)} attached a receipt to "${s.title}"`, createdAt, s.planId ?? null);
    return expense;
  };

  let settlementSeq = 0;
  const addSettlement = (s: { groupId: string; from: string; to: string; amount: number; method: SettlementMethod; day: string; notes?: string; methodNote?: string; recordedBy: string; reversed?: { reason: string; by: string } }) => {
    const createdAt = stamp(s.day, 18, 30);
    const id = `set-${++settlementSeq}`;
    const amountMinor = rupees(s.amount);
    db.settlements.push({
      id,
      groupId: s.groupId,
      fromMemberId: s.from,
      toMemberId: s.to,
      amountMinor,
      currency: CURRENCY,
      method: s.method,
      methodNote: s.methodNote ?? null,
      date: s.day,
      notes: s.notes ?? null,
      status: s.reversed ? 'REVERSED' : 'RECORDED',
      recordedById: s.recordedBy,
      createdAt,
      reversedAt: s.reversed ? stamp(s.day, 21) : null,
      reversedById: s.reversed?.by ?? null,
      reversalReason: s.reversed?.reason ?? null,
    });
    const name = (id: string) => db.members.find((m) => m.id === id)!.displayName;
    log(
      s.groupId,
      s.recordedBy,
      'SETTLEMENT_RECORDED',
      'settlement',
      id,
      `${userName(s.recordedBy)} recorded ${name(s.from)} paying ${name(s.to)} ${formatMoney(amountMinor, CURRENCY)} (${SETTLEMENT_METHOD_LABELS[s.method]})`,
      createdAt,
    );
    if (s.reversed) {
      log(s.groupId, s.reversed.by, 'SETTLEMENT_REVERSED', 'settlement', id, `${userName(s.reversed.by)} reversed a repayment: ${s.reversed.reason}`, stamp(s.day, 21));
    }
  };

  const addPlan = (p: Omit<DbPlan, 'createdAt'> & { createdDay: string }) => {
    const { createdDay, ...rest } = p;
    const createdAt = stamp(createdDay, 11);
    db.plans.push({ ...rest, createdAt });
    log(p.groupId, p.createdById, 'PLAN_CREATED', 'plan', p.id, `${userName(p.createdById)} created the plan "${p.title}"`, createdAt, p.id);
  };

  // =====================================================================
  // Weekend Wanderers — a trip crew: a finished Goa trip and an upcoming trek.
  // =====================================================================
  const T = { you: 'm-trip-you', priya: 'm-trip-priya', rahul: 'm-trip-rahul', ananya: 'm-trip-ananya', karan: 'm-trip-karan' };
  const tripAll = [T.you, T.priya, T.rahul, T.ananya, T.karan];
  const tripCore = [T.you, T.priya, T.rahul, T.ananya];
  addGroup({
    id: 'g-trip',
    name: 'Weekend Wanderers',
    description: 'Road trips, treks and long weekends with the college gang.',
    type: 'TRIP',
    currency: CURRENCY,
    accent: '#D58B42',
    simplifyDebts: true,
    archivedAt: null,
    createdAt: at(dayOffset(-75), 21),
    ownerId: GUEST_USER_ID,
  });
  addMember({ id: T.you, groupId: 'g-trip', displayName: ME.name, role: 'OWNER', userId: GUEST_USER_ID, joinedAt: at(dayOffset(-75), 21) });
  addMember({ id: T.priya, groupId: 'g-trip', displayName: 'Priya Nair', role: 'ADMIN', userId: 'u-priya', joinedAt: at(dayOffset(-75), 22) });
  addMember({ id: T.rahul, groupId: 'g-trip', displayName: 'Rahul Mehta', role: 'MEMBER', userId: 'u-rahul', joinedAt: at(dayOffset(-74), 9) });
  addMember({ id: T.ananya, groupId: 'g-trip', displayName: 'Ananya Iyer', role: 'MEMBER', userId: 'u-ananya', joinedAt: at(dayOffset(-74), 13) });
  addMember({ id: T.karan, groupId: 'g-trip', displayName: 'Karan Shah', role: 'MEMBER', userId: null, joinedAt: at(dayOffset(-73), 10) });
  db.categories.push({ id: 'cat-trek-gear', groupId: 'g-trip', label: 'Trek gear' });

  addPlan({
    id: 'p-goa',
    groupId: 'g-trip',
    title: 'Goa long weekend',
    description: 'Four days in North Goa: beaches, parasailing and a spice plantation.',
    type: 'TRIP',
    status: 'COMPLETED',
    startDate: dayOffset(-34),
    endDate: dayOffset(-31),
    location: 'Anjuna, North Goa',
    estimatedBudgetMinor: rupees(90000),
    participantIds: tripAll,
    notes: 'Villa check-out is at 11 am on the last day. Scooters go back to the shop near Anjuna market.',
    createdById: GUEST_USER_ID,
    createdDay: dayOffset(-60),
    itinerary: [
      { id: 'it-goa-1', position: 0, title: 'Check in at Casa Anjuna villa', description: null, date: dayOffset(-34), startTime: '14:00', endTime: null, location: 'Anjuna', estimatedCostMinor: null, notes: null },
      { id: 'it-goa-2', position: 1, title: 'Sunset at Chapora Fort', description: 'Short climb, carry water.', date: dayOffset(-34), startTime: '17:30', endTime: '19:00', location: 'Chapora', estimatedCostMinor: null, notes: null },
      { id: 'it-goa-3', position: 2, title: 'Parasailing at Calangute', description: null, date: dayOffset(-33), startTime: '10:00', endTime: '12:00', location: 'Calangute beach', estimatedCostMinor: rupees(6000), notes: null },
      { id: 'it-goa-4', position: 3, title: 'Spice plantation tour', description: 'Lunch included.', date: dayOffset(-32), startTime: '11:00', endTime: '15:00', location: 'Ponda', estimatedCostMinor: rupees(4000), notes: null },
    ],
    checklist: [
      { id: 'ck-goa-1', position: 0, title: 'Book the villa', assigneeMemberId: T.you, dueDate: dayOffset(-50), completedAt: at(dayOffset(-37), 21), completedById: GUEST_USER_ID },
      { id: 'ck-goa-2', position: 1, title: 'Book flights', assigneeMemberId: T.priya, dueDate: dayOffset(-45), completedAt: at(dayOffset(-36), 19), completedById: 'u-priya' },
      { id: 'ck-goa-3', position: 2, title: 'Rent scooters', assigneeMemberId: T.rahul, dueDate: null, completedAt: at(dayOffset(-34), 15), completedById: 'u-rahul' },
    ],
  });
  addPlan({
    id: 'p-coorg',
    groupId: 'g-trip',
    title: 'Coorg monsoon trek',
    description: 'Tadiandamol summit, coffee estates and a homestay with a view.',
    type: 'TRIP',
    status: 'PLANNING',
    startDate: dayOffset(12),
    endDate: dayOffset(14),
    location: 'Madikeri, Coorg',
    estimatedBudgetMinor: rupees(40000),
    participantIds: tripCore,
    notes: 'Leeches are out after the rains: pack salt and long socks.',
    createdById: 'u-priya',
    createdDay: dayOffset(-16),
    itinerary: [
      { id: 'it-coorg-1', position: 0, title: 'Drive from Bengaluru via Mysuru', description: 'Breakfast stop at Kamat Lokaruchi.', date: dayOffset(12), startTime: '06:00', endTime: '12:30', location: 'Mysuru Road', estimatedCostMinor: rupees(3500), notes: 'Rahul and Priya share the driving.' },
      { id: 'it-coorg-2', position: 1, title: 'Check in and lunch at the homestay', description: null, date: dayOffset(12), startTime: '13:00', endTime: null, location: 'Madikeri', estimatedCostMinor: null, notes: null },
      { id: 'it-coorg-3', position: 2, title: 'Tadiandamol summit trek', description: 'About 7 km up and back. Start early to beat the mist.', date: dayOffset(13), startTime: '05:30', endTime: '12:00', location: 'Kakkabe', estimatedCostMinor: rupees(2000), notes: null },
      { id: 'it-coorg-4', position: 3, title: 'Abbey Falls and coffee estate walk', description: null, date: dayOffset(14), startTime: '09:00', endTime: '13:00', location: 'Abbey Falls', estimatedCostMinor: rupees(1200), notes: null },
    ],
    checklist: [
      { id: 'ck-coorg-1', position: 0, title: 'Book the homestay', assigneeMemberId: T.you, dueDate: dayOffset(-5), completedAt: at(dayOffset(-10), 20), completedById: GUEST_USER_ID },
      { id: 'ck-coorg-2', position: 1, title: 'Plan driving shifts', assigneeMemberId: T.priya, dueDate: null, completedAt: at(dayOffset(-6), 22), completedById: 'u-priya' },
      { id: 'ck-coorg-3', position: 2, title: 'Rent rain gear', assigneeMemberId: T.rahul, dueDate: dayOffset(8), completedAt: null, completedById: null },
      { id: 'ck-coorg-4', position: 3, title: 'Confirm trek permits with the forest office', assigneeMemberId: T.you, dueDate: dayOffset(5), completedAt: null, completedById: null },
      { id: 'ck-coorg-5', position: 4, title: 'Buy snacks for the drive', assigneeMemberId: T.ananya, dueDate: dayOffset(11), completedAt: null, completedById: null },
    ],
  });

  addExpense({
    id: 'e-trip-villa', groupId: 'g-trip', day: dayOffset(-37), time: [21, 5], title: 'Casa Anjuna villa (3 nights)', category: 'accommodation', amount: 24000, paidBy: T.you, among: tripAll, planId: 'p-goa',
    description: 'Private pool, breakfast included.',
    comments: [
      { userId: 'u-priya', body: 'Thanks for booking this! The pool was worth every rupee.', minutesLater: 50 },
      { userId: 'u-rahul', body: 'Can we split the cleaning fee separately next time?', minutesLater: 180 },
    ],
    receipt: { fileName: 'casa-anjuna-invoice.svg', merchant: 'CASA ANJUNA VILLAS', address: 'Mazal Waddo, Anjuna, Goa', lines: [{ label: 'Villa, 3 nights', amountMinor: rupees(21000) }, { label: 'Cleaning fee', amountMinor: rupees(1500) }, { label: 'GST 12% on fee', amountMinor: rupees(1500) }], footer: 'Booking ref CA-20931' },
  });
  addExpense({ id: 'e-trip-flights', groupId: 'g-trip', day: dayOffset(-36), time: [19, 20], title: 'Flights BLR to GOI', category: 'flights', amount: 31500, paidBy: T.priya, among: tripCore, planId: 'p-goa', notes: 'Karan flew in from Mumbai on his own ticket.' });
  addExpense({ id: 'e-trip-scooters', groupId: 'g-trip', day: dayOffset(-34), time: [15, 40], title: 'Scooter rentals', category: 'transport', amount: 3200, paidBy: T.rahul, among: tripAll, planId: 'p-goa' });
  addExpense({
    id: 'e-trip-thalassa', groupId: 'g-trip', day: dayOffset(-34), time: [22, 10], title: 'Dinner at Thalassa', category: 'food', amount: 7850, paidBy: T.ananya, among: tripAll, planId: 'p-goa',
    comments: [{ userId: GUEST_USER_ID, body: 'Best sunset dinner of the trip.', minutesLater: 30 }],
    receipt: { fileName: 'thalassa-bill.svg', merchant: 'THALASSA', address: 'Vagator Beach, Goa', lines: [{ label: 'Mezze platter x2', amountMinor: rupees(1900) }, { label: 'Grilled fish', amountMinor: rupees(1450) }, { label: 'Moussaka', amountMinor: rupees(1100) }, { label: 'Lemonade x5', amountMinor: rupees(1250) }, { label: 'Baklava x3', amountMinor: rupees(1050) }, { label: 'Service charge', amountMinor: rupees(1100) }] },
  });
  addExpense({ id: 'e-trip-parasail', groupId: 'g-trip', day: dayOffset(-33), time: [12, 30], title: 'Parasailing at Calangute', category: 'activities', amount: 6000, paidBy: T.karan, among: [T.you, T.priya, T.rahul, T.karan], method: 'SHARES', values: [1, 1, 2, 1], planId: 'p-goa', notes: 'Rahul went twice.' });
  addExpense({ id: 'e-trip-shack', groupId: 'g-trip', day: dayOffset(-33), time: [14, 45], title: 'Beach shack lunch', category: 'food', amount: 2450, paidBy: T.you, among: tripAll, planId: 'p-goa' });
  addExpense({ id: 'e-trip-snacks', groupId: 'g-trip', day: dayOffset(-32), time: [10, 5], title: 'Groceries and snacks', category: 'groceries', amount: 1870, paidBy: T.priya, among: tripAll, planId: 'p-goa' });
  addExpense({ id: 'e-trip-spice', groupId: 'g-trip', day: dayOffset(-32), time: [16, 0], title: 'Spice plantation tour', category: 'tickets', amount: 4000, paidBy: T.rahul, among: tripCore, method: 'PERCENTAGE', values: [25, 25, 25, 25], planId: 'p-goa' });
  addExpense({ id: 'e-trip-fuel', groupId: 'g-trip', day: dayOffset(-31), time: [9, 30], title: 'Fuel for the scooters', category: 'transport', amount: 2600, paidBy: T.ananya, among: tripAll, planId: 'p-goa' });
  addExpense({ id: 'e-trip-souvenirs', groupId: 'g-trip', day: dayOffset(-31), time: [13, 15], title: 'Cashews and souvenirs', category: 'shopping', amount: 3150, paidBy: T.you, among: [T.you, T.priya, T.ananya], method: 'EXACT', values: [1200, 950, 1000], planId: 'p-goa' });
  addExpense({ id: 'e-trip-tshirts', groupId: 'g-trip', day: dayOffset(-15), title: 'Crew T-shirts', category: 'shopping', amount: 2400, paidBy: T.priya, among: tripCore });
  addExpense({ id: 'e-trip-homestay', groupId: 'g-trip', day: dayOffset(-10), time: [20, 0], title: 'Homestay advance, Coorg', category: 'accommodation', amount: 6000, paidBy: T.you, among: tripCore, planId: 'p-coorg', notes: 'Balance of Rs 9,000 is payable at check-in.' });
  addExpense({ id: 'e-trip-jackets', groupId: 'g-trip', day: dayOffset(-4), time: [18, 45], title: 'Rain jackets', category: 'cat-trek-gear', amount: 3600, paidBy: T.rahul, among: [T.you, T.rahul, T.ananya], planId: 'p-coorg' });

  addSettlement({ groupId: 'g-trip', from: T.karan, to: T.you, amount: 4800, method: 'UPI', day: dayOffset(-26), notes: 'Goa trip share', recordedBy: GUEST_USER_ID });
  addSettlement({ groupId: 'g-trip', from: T.rahul, to: T.priya, amount: 5000, method: 'BANK_TRANSFER', day: dayOffset(-22), recordedBy: 'u-rahul' });
  addSettlement({ groupId: 'g-trip', from: T.ananya, to: T.you, amount: 1000, method: 'CASH', day: dayOffset(-20), recordedBy: 'u-ananya', reversed: { reason: 'Entered twice by mistake', by: GUEST_USER_ID } });

  db.budgets.push({
    id: 'b-trip',
    groupId: 'g-trip',
    totalMinor: rupees(110000),
    currency: CURRENCY,
    startDate: dayOffset(-45),
    endDate: null,
    warningThresholdPct: 80,
    categories: [
      { category: 'accommodation', amountMinor: rupees(32000) },
      { category: 'food', amountMinor: rupees(12000) },
      { category: 'activities', amountMinor: rupees(5000) },
    ],
    updatedAt: at(dayOffset(-45), 12),
  });
  log('g-trip', GUEST_USER_ID, 'BUDGET_SET', 'budget', 'b-trip', `${ME.name} set the group budget to ${formatMoney(rupees(110000), CURRENCY)}`, at(dayOffset(-45), 12));
  log('g-trip', null, 'BUDGET_WARNING', 'budget', 'b-trip', 'Group spending reached 84% of the budget', stamp(dayOffset(-15), 20, 16));

  // =====================================================================
  // Flat 4B — a shared home: monthly rent, bills and groceries.
  // =====================================================================
  const F = { you: 'm-flat-you', rahul: 'm-flat-rahul', meera: 'm-flat-meera', dev: 'm-flat-dev' };
  const flatmates = [F.you, F.rahul, F.meera];
  addGroup({
    id: 'g-flat',
    name: 'Flat 4B, Indiranagar',
    description: 'Rent, bills and groceries for the flat.',
    type: 'HOME',
    currency: CURRENCY,
    accent: '#386641',
    simplifyDebts: true,
    archivedAt: null,
    createdAt: at(dayOffset(-120), 19),
    ownerId: GUEST_USER_ID,
  });
  addMember({ id: F.you, groupId: 'g-flat', displayName: ME.name, role: 'OWNER', userId: GUEST_USER_ID, joinedAt: at(dayOffset(-120), 19) });
  addMember({ id: F.rahul, groupId: 'g-flat', displayName: 'Rahul Mehta', role: 'ADMIN', userId: 'u-rahul', joinedAt: at(dayOffset(-119), 8) });
  addMember({ id: F.meera, groupId: 'g-flat', displayName: 'Meera Kapoor', role: 'MEMBER', userId: 'u-meera', joinedAt: at(dayOffset(-118), 20) });
  addMember({ id: F.dev, groupId: 'g-flat', displayName: 'Dev Patel', email: 'dev.patel@example.com', role: 'MEMBER', userId: null, joinedAt: at(dayOffset(-12), 18) });

  const today = new Date();
  const monthDay = (monthsAgo: number, day: number) => isoDay(new Date(today.getFullYear(), today.getMonth() - monthsAgo, day));
  const past = (day: string) => day <= todayIso();

  const rent = addExpense({ id: 'e-flat-rent-0', groupId: 'g-flat', day: monthDay(2, 1), time: [9, 0], title: 'Monthly rent', category: 'rent', amount: 45000, paidBy: F.rahul, among: flatmates, repeat: 'MONTHLY', notes: 'Rahul transfers the full rent to the landlord.' });
  rent.repeatNextDate = occurrenceDate(rent.date, 'MONTHLY', 3);
  for (const k of [1, 0]) {
    addExpense({ id: `e-flat-rent-${2 - k}`, groupId: 'g-flat', day: monthDay(k, 1), time: [9, 0], title: 'Monthly rent', category: 'rent', amount: 45000, paidBy: F.rahul, among: flatmates, recurringSourceId: rent.id });
  }
  [2840, 3120, 2965].forEach((amount, i) => {
    const day = monthDay(2 - i, 6);
    if (!past(day)) return;
    addExpense({
      id: `e-flat-power-${i}`, groupId: 'g-flat', day, time: [11, 20], title: 'Electricity bill (BESCOM)', category: 'utilities', amount, paidBy: F.you, among: flatmates,
      receipt: i === 1 ? { fileName: 'bescom-bill.svg', merchant: 'BESCOM', address: 'Indiranagar sub-division', lines: [{ label: 'Energy charges 412 units', amountMinor: rupees(2480) }, { label: 'Fixed charges', amountMinor: rupees(420) }, { label: 'Tax', amountMinor: rupees(220) }], footer: 'Paid online. Thank you.' } : undefined,
    });
  });
  [0, 1, 2].forEach((i) => {
    const day = monthDay(2 - i, 10);
    if (past(day)) addExpense({ id: `e-flat-wifi-${i}`, groupId: 'g-flat', day, time: [10, 0], title: 'Wi-Fi (ACT Fibernet)', category: 'utilities', amount: 1179, paidBy: F.meera, among: flatmates });
  });
  [0, 1, 2].forEach((i) => {
    const day = monthDay(2 - i, 2);
    if (past(day)) addExpense({ id: `e-flat-cook-${i}`, groupId: 'g-flat', day, time: [19, 0], title: 'Cook, monthly salary', category: 'misc', amount: 6000, paidBy: F.meera, among: flatmates });
  });
  const groceries: [number, string, number, string][] = [
    [-74, 'BigBasket monthly stock-up', 3380, F.you],
    [-67, 'Zepto top-up', 845, F.meera],
    [-60, 'BigBasket order', 2210, F.rahul],
    [-52, 'Milk and bread (fortnight)', 1120, F.you],
    [-45, 'BigBasket monthly stock-up', 3540, F.meera],
    [-38, 'Zepto top-up', 690, F.rahul],
    [-30, 'BigBasket order', 2460, F.you],
    [-23, 'Fruits and vegetables', 1280, F.meera],
    [-16, 'BigBasket monthly stock-up', 3190, F.rahul],
    [-3, 'Zepto top-up', 935, F.you],
  ];
  groceries.forEach(([offset, title, amount, payer], i) => {
    addExpense({
      id: `e-flat-groc-${i}`, groupId: 'g-flat', day: dayOffset(offset), time: [18, 30], title, category: 'groceries', amount, paidBy: payer,
      among: offset > -12 ? [...flatmates, F.dev] : flatmates,
    });
  });
  addExpense({
    id: 'e-flat-market', groupId: 'g-flat', day: dayOffset(-9), time: [11, 45], title: 'Weekend market run', category: 'groceries', amount: 2290, paidBy: F.meera, among: [],
    description: 'Itemised so the coffee and protein bars go to the right people.',
    items: [
      { description: 'Vegetables and fruit', quantity: 1, unitPrice: 640, memberIds: [F.you, F.rahul, F.meera, F.dev] },
      { description: 'Coffee beans 500 g', quantity: 2, unitPrice: 450, memberIds: [F.you, F.meera] },
      { description: 'Protein bars', quantity: 5, unitPrice: 150, memberIds: [F.rahul] },
    ],
    receipt: { fileName: 'farmers-market.svg', merchant: 'HOPCOMS FRESH', address: '100 Feet Road, Indiranagar', lines: [{ label: 'Vegetables and fruit', amountMinor: rupees(640) }, { label: 'Coffee beans 500 g x2', amountMinor: rupees(900) }, { label: 'Protein bars x5', amountMinor: rupees(750) }] },
  });
  addExpense({ id: 'e-flat-purifier', groupId: 'g-flat', day: dayOffset(-20), time: [16, 10], title: 'Water purifier service', category: 'utilities', amount: 1450, paidBy: F.rahul, among: flatmates });
  addExpense({ id: 'e-flat-cleaning', groupId: 'g-flat', day: dayOffset(-27), time: [12, 0], title: 'Cleaning supplies', category: 'shopping', amount: 860, paidBy: F.you, among: flatmates });
  addExpense({ id: 'e-flat-gas', groupId: 'g-flat', day: dayOffset(-33), time: [9, 40], title: 'Gas cylinder refill', category: 'utilities', amount: 1105, paidBy: F.meera, among: flatmates });
  addExpense({ id: 'e-flat-curtains', groupId: 'g-flat', day: dayOffset(-6), time: [20, 30], title: 'Living room curtains', category: 'shopping', amount: 4200, paidBy: F.you, among: [F.you, F.rahul, F.meera, F.dev], method: 'ADJUSTMENT', values: [0, 600, 0, 0], notes: 'Rahul added a blackout panel for his room.' });

  const rentPaid = monthDay(1, 3);
  if (past(rentPaid)) {
    addSettlement({ groupId: 'g-flat', from: F.meera, to: F.rahul, amount: 15000, method: 'BANK_TRANSFER', day: rentPaid, notes: 'Rent share', recordedBy: 'u-meera' });
    addSettlement({ groupId: 'g-flat', from: F.you, to: F.rahul, amount: 15000, method: 'UPI', methodNote: 'GPay', day: rentPaid, notes: 'Rent share', recordedBy: GUEST_USER_ID });
  }
  addSettlement({ groupId: 'g-flat', from: F.you, to: F.rahul, amount: 15000, method: 'UPI', methodNote: 'GPay', day: monthDay(2, 3), notes: 'Rent share', recordedBy: GUEST_USER_ID });

  db.budgets.push({
    id: 'b-flat',
    groupId: 'g-flat',
    totalMinor: rupees(72000),
    currency: CURRENCY,
    startDate: monthDay(0, 1),
    endDate: isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    warningThresholdPct: 85,
    categories: [
      { category: 'groceries', amountMinor: rupees(9000) },
      { category: 'utilities', amountMinor: rupees(6000) },
    ],
    updatedAt: at(monthDay(0, 1), 9),
  });

  addPlan({
    id: 'p-house',
    groupId: 'g-flat',
    title: 'Housewarming party',
    description: 'Friends from work and the building are coming over.',
    type: 'CELEBRATION',
    status: 'CONFIRMED',
    startDate: dayOffset(2),
    endDate: null,
    location: 'Flat 4B, Indiranagar',
    estimatedBudgetMinor: rupees(12000),
    participantIds: [...flatmates, F.dev],
    notes: 'Ask the security desk to let guests in after 7 pm.',
    createdById: 'u-meera',
    createdDay: dayOffset(-14),
    itinerary: [
      { id: 'it-house-1', position: 0, title: 'Guests arrive', description: null, date: dayOffset(2), startTime: '19:00', endTime: null, location: null, estimatedCostMinor: null, notes: null },
      { id: 'it-house-2', position: 1, title: 'Dinner and cake', description: 'Biryani from Meghana Foods.', date: dayOffset(2), startTime: '21:00', endTime: '22:30', location: null, estimatedCostMinor: rupees(7500), notes: null },
    ],
    checklist: [
      { id: 'ck-house-1', position: 0, title: 'Order the cake', assigneeMemberId: F.meera, dueDate: dayOffset(1), completedAt: at(dayOffset(-2), 13), completedById: 'u-meera' },
      { id: 'ck-house-2', position: 1, title: 'Send invites', assigneeMemberId: F.you, dueDate: null, completedAt: at(dayOffset(-8), 21), completedById: GUEST_USER_ID },
      { id: 'ck-house-3', position: 2, title: 'Buy fairy lights for the balcony', assigneeMemberId: F.rahul, dueDate: dayOffset(1), completedAt: null, completedById: null },
      { id: 'ck-house-4', position: 3, title: 'Clean the balcony', assigneeMemberId: F.you, dueDate: dayOffset(1), completedAt: null, completedById: null },
    ],
  });

  addExpense({ id: 'e-flat-cake', groupId: 'g-flat', day: dayOffset(-2), time: [13, 5], title: 'Cake advance (Theobroma)', category: 'events', amount: 1500, paidBy: F.meera, among: [...flatmates, F.dev], planId: 'p-house' });

  // =====================================================================
  // Friday Dinner Club — weekly dinners; debts kept between the people involved.
  // =====================================================================
  const D = { you: 'm-din-you', priya: 'm-din-priya', meera: 'm-din-meera', ishaan: 'm-din-ishaan' };
  const diners = [D.you, D.priya, D.meera, D.ishaan];
  addGroup({
    id: 'g-dinner',
    name: 'Friday Dinner Club',
    description: 'A new place every Friday. Whoever picks, pays first.',
    type: 'DINNER',
    currency: CURRENCY,
    accent: '#C96F52',
    simplifyDebts: false,
    archivedAt: null,
    createdAt: at(dayOffset(-90), 22),
    ownerId: 'u-priya',
  });
  addMember({ id: D.priya, groupId: 'g-dinner', displayName: 'Priya Nair', role: 'OWNER', userId: 'u-priya', joinedAt: at(dayOffset(-90), 22) });
  addMember({ id: D.you, groupId: 'g-dinner', displayName: ME.name, role: 'MEMBER', userId: GUEST_USER_ID, joinedAt: at(dayOffset(-90), 23) });
  addMember({ id: D.meera, groupId: 'g-dinner', displayName: 'Meera Kapoor', role: 'MEMBER', userId: 'u-meera', joinedAt: at(dayOffset(-89), 9) });
  addMember({ id: D.ishaan, groupId: 'g-dinner', displayName: 'Ishaan Verma', role: 'ADMIN', userId: 'u-ishaan', joinedAt: at(dayOffset(-89), 11) });
  db.categories.push({ id: 'cat-desserts', groupId: 'g-dinner', label: 'Desserts' });

  const back = ((today.getDay() - 5 + 7) % 7) || 7; // days since the most recent past Friday
  const dinners: [string, number, string, string[]][] = [
    ['Toit: pizzas and pints', 4680, D.priya, diners],
    ['Meghana Foods biryani', 2360, D.you, diners],
    ['Truffles burgers', 2890, D.ishaan, [D.you, D.priya, D.ishaan]],
    ['Fava, Mediterranean', 5240, D.meera, diners],
    ['Nagarjuna andhra meals', 1980, D.priya, diners],
    ['Burma Burma', 4410, D.you, diners],
    ['Mavalli Tiffin Rooms', 1240, D.ishaan, diners],
    ['Arbor Brewing Company', 6120, D.meera, [D.you, D.meera, D.ishaan]],
  ];
  dinners.forEach(([title, amount, payer, among], i) => {
    addExpense({ id: `e-din-${i}`, groupId: 'g-dinner', day: dayOffset(-(back + 7 * i)), time: [22, 40], title, category: 'food', amount, paidBy: payer, among });
  });
  addExpense({
    id: 'e-din-bowling', groupId: 'g-dinner', day: dayOffset(-(back + 7 * 2) + 1), time: [21, 0], title: 'Bowling at Amoeba', category: 'entertainment', amount: 3600, paidBy: [[D.you, 2000], [D.ishaan, 1600]], among: diners,
  });
  addExpense({ id: 'e-din-sundaes', groupId: 'g-dinner', day: dayOffset(-(back + 7 * 4) + 1), time: [16, 30], title: 'Corner House sundaes', category: 'cat-desserts', amount: 1160, paidBy: D.ishaan, among: diners });
  addSettlement({ groupId: 'g-dinner', from: D.ishaan, to: D.priya, amount: 1200, method: 'CASH', day: dayOffset(-14), recordedBy: 'u-priya' });
  addSettlement({ groupId: 'g-dinner', from: D.priya, to: D.you, amount: 500, method: 'UPI', methodNote: 'PhonePe', day: dayOffset(-7), notes: 'For the Burma Burma dinner', recordedBy: 'u-priya' });

  addPlan({
    id: 'p-bday',
    groupId: 'g-dinner',
    title: "Meera's birthday dinner",
    description: 'Surprise dinner. Do not tell Meera!',
    type: 'BIRTHDAY',
    status: 'IDEA',
    startDate: dayOffset(20),
    endDate: null,
    location: null,
    estimatedBudgetMinor: rupees(10000),
    participantIds: [D.you, D.priya, D.ishaan],
    notes: null,
    createdById: 'u-priya',
    createdDay: dayOffset(-3),
    itinerary: [],
    checklist: [
      { id: 'ck-bday-1', position: 0, title: 'Book a table', assigneeMemberId: D.priya, dueDate: dayOffset(10), completedAt: null, completedById: null },
      { id: 'ck-bday-2', position: 1, title: 'Pick a gift', assigneeMemberId: D.you, dueDate: dayOffset(15), completedAt: null, completedById: null },
    ],
  });

  // =====================================================================
  // Office Secret Santa — archived and settled.
  // =====================================================================
  const O = { you: 'm-off-you', ishaan: 'm-off-ishaan', neha: 'm-off-neha' };
  addGroup({
    id: 'g-office',
    name: 'Office Secret Santa',
    description: 'Gift exchange with the design team.',
    type: 'OFFICE',
    currency: CURRENCY,
    accent: '#8A6A4F',
    simplifyDebts: true,
    archivedAt: at(dayOffset(-300), 10),
    createdAt: at(dayOffset(-340), 14),
    ownerId: 'u-ishaan',
  });
  addMember({ id: O.ishaan, groupId: 'g-office', displayName: 'Ishaan Verma', role: 'OWNER', userId: 'u-ishaan', joinedAt: at(dayOffset(-340), 14) });
  addMember({ id: O.you, groupId: 'g-office', displayName: ME.name, role: 'ADMIN', userId: GUEST_USER_ID, joinedAt: at(dayOffset(-340), 15) });
  addMember({ id: O.neha, groupId: 'g-office', displayName: 'Neha (HR)', role: 'MEMBER', userId: null, joinedAt: at(dayOffset(-339), 10) });
  addExpense({ id: 'e-off-gifts', groupId: 'g-office', day: dayOffset(-320), title: 'Gift pool', category: 'gifts', amount: 3000, paidBy: O.you, among: [O.you, O.ishaan, O.neha] });
  addExpense({ id: 'e-off-cake', groupId: 'g-office', day: dayOffset(-318), title: 'Cake and snacks', category: 'food', amount: 1500, paidBy: O.ishaan, among: [O.you, O.ishaan, O.neha] });
  addSettlement({ groupId: 'g-office', from: O.neha, to: O.you, amount: 1500, method: 'CASH', day: dayOffset(-310), recordedBy: GUEST_USER_ID });
  log('g-office', 'u-ishaan', 'GROUP_ARCHIVED', 'group', 'g-office', 'Ishaan Verma archived the group', at(dayOffset(-300), 10));

  // =====================================================================
  // Saturday Badminton — you have a pending invitation to join.
  // =====================================================================
  const B = { ananya: 'm-bad-ananya', ishaan: 'm-bad-ishaan', you: 'm-bad-you' };
  addGroup({
    id: 'g-badminton',
    name: 'Saturday Badminton',
    description: 'Court bookings and shuttles for the Saturday morning games.',
    type: 'GENERAL',
    currency: CURRENCY,
    accent: '#4C8157',
    simplifyDebts: true,
    archivedAt: null,
    createdAt: at(dayOffset(-30), 8),
    ownerId: 'u-ananya',
  });
  addMember({ id: B.ananya, groupId: 'g-badminton', displayName: 'Ananya Iyer', role: 'OWNER', userId: 'u-ananya', joinedAt: at(dayOffset(-30), 8) });
  addMember({ id: B.ishaan, groupId: 'g-badminton', displayName: 'Ishaan Verma', role: 'MEMBER', userId: 'u-ishaan', joinedAt: at(dayOffset(-29), 9) });
  addMember({ id: B.you, groupId: 'g-badminton', displayName: ME.name, email: ME.email, role: 'MEMBER', userId: null, joinedAt: at(dayOffset(-1), 19) });
  addExpense({ id: 'e-bad-courts', groupId: 'g-badminton', day: dayOffset(-8), title: 'Court booking, 4 Saturdays', category: 'tickets', amount: 3600, paidBy: B.ananya, among: [B.ananya, B.ishaan] });
  addExpense({ id: 'e-bad-shuttles', groupId: 'g-badminton', day: dayOffset(-8), title: 'Shuttlecocks (tube of 12)', category: 'misc', amount: 1350, paidBy: B.ishaan, among: [B.ananya, B.ishaan] });

  db.invitations.push(
    {
      id: 'inv-badminton',
      groupId: 'g-badminton',
      token: 'demo-badminton',
      email: ME.email,
      role: 'MEMBER',
      memberId: B.you,
      status: 'PENDING',
      expiresAt: at(dayOffset(6), 19),
      createdAt: at(dayOffset(-1), 19),
      acceptedAt: null,
      invitedByName: 'Ananya Iyer',
    },
    {
      id: 'inv-flat-dev',
      groupId: 'g-flat',
      token: 'demo-flat-dev',
      email: 'dev.patel@example.com',
      role: 'MEMBER',
      memberId: F.dev,
      status: 'PENDING',
      expiresAt: at(dayOffset(5), 18),
      createdAt: at(dayOffset(-2), 18),
      acceptedAt: null,
      invitedByName: ME.name,
    },
    {
      id: 'inv-flat-meera',
      groupId: 'g-flat',
      token: 'demo-flat-meera',
      email: 'meera.kapoor@example.com',
      role: 'MEMBER',
      memberId: null,
      status: 'ACCEPTED',
      expiresAt: at(dayOffset(-112), 20),
      createdAt: at(dayOffset(-119), 20),
      acceptedAt: at(dayOffset(-118), 20),
      invitedByName: ME.name,
    },
  );
  log('g-flat', GUEST_USER_ID, 'INVITATION_SENT', 'invitation', 'inv-flat-dev', `${ME.name} invited dev.patel@example.com`, at(dayOffset(-2), 18));

  // ---------- Polls ----------
  db.polls.push(
    {
      id: 'poll-coorg-stay',
      groupId: 'g-trip',
      planId: 'p-coorg',
      question: 'Where should we stay in Coorg?',
      closesAt: new Date(now + 20 * 3_600_000).toISOString(),
      closedAt: null,
      allowVoteChange: true,
      createdById: 'u-priya',
      createdAt: at(dayOffset(-12), 21),
      eligibleMemberIds: [],
      options: [
        { id: 'opt-coorg-1', label: 'Homestay near Madikeri' },
        { id: 'opt-coorg-2', label: 'Riverside tent camp' },
        { id: 'opt-coorg-3', label: 'Plantation bungalow' },
      ],
      votes: [
        { memberId: T.priya, optionId: 'opt-coorg-1' },
        { memberId: T.rahul, optionId: 'opt-coorg-2' },
        { memberId: T.ananya, optionId: 'opt-coorg-1' },
      ],
    },
    {
      id: 'poll-next-trip',
      groupId: 'g-trip',
      planId: null,
      question: 'Where should we go after Coorg?',
      closesAt: null,
      closedAt: null,
      allowVoteChange: true,
      createdById: GUEST_USER_ID,
      createdAt: at(dayOffset(-5), 22),
      eligibleMemberIds: [],
      options: [
        { id: 'opt-next-1', label: 'Hampi' },
        { id: 'opt-next-2', label: 'Gokarna' },
        { id: 'opt-next-3', label: 'Pondicherry' },
      ],
      votes: [
        { memberId: T.you, optionId: 'opt-next-1' },
        { memberId: T.ananya, optionId: 'opt-next-1' },
        { memberId: T.priya, optionId: 'opt-next-3' },
      ],
    },
    {
      id: 'poll-house-theme',
      groupId: 'g-flat',
      planId: 'p-house',
      question: 'Theme for the housewarming?',
      closesAt: at(dayOffset(-3), 21),
      closedAt: at(dayOffset(-3), 21),
      allowVoteChange: false,
      createdById: 'u-meera',
      createdAt: at(dayOffset(-12), 20),
      eligibleMemberIds: [],
      options: [
        { id: 'opt-house-1', label: 'Retro Bollywood' },
        { id: 'opt-house-2', label: 'Garden brunch' },
      ],
      votes: [
        { memberId: F.you, optionId: 'opt-house-1' },
        { memberId: F.meera, optionId: 'opt-house-1' },
        { memberId: F.rahul, optionId: 'opt-house-2' },
      ],
    },
    {
      id: 'poll-bday-place',
      groupId: 'g-dinner',
      planId: 'p-bday',
      question: "Where should we take Meera for her birthday?",
      closesAt: new Date(now + 5 * 86_400_000).toISOString(),
      closedAt: null,
      allowVoteChange: true,
      createdById: 'u-priya',
      createdAt: at(dayOffset(-3), 12),
      eligibleMemberIds: [D.you, D.priya, D.ishaan],
      options: [
        { id: 'opt-bday-1', label: 'Olive Beach' },
        { id: 'opt-bday-2', label: 'Farmlore' },
        { id: 'opt-bday-3', label: 'Byg Brewski' },
      ],
      votes: [
        { memberId: D.priya, optionId: 'opt-bday-1' },
        { memberId: D.ishaan, optionId: 'opt-bday-3' },
      ],
    },
  );
  for (const p of db.polls) {
    log(p.groupId, p.createdById, 'POLL_CREATED', 'poll', p.id, `${userName(p.createdById)} started a poll: "${p.question}"`, p.createdAt, p.planId);
  }
  log('g-flat', null, 'POLL_CLOSED', 'poll', 'poll-house-theme', 'Poll closed: "Theme for the housewarming?" — "Retro Bollywood" won with 2 votes', at(dayOffset(-3), 21), 'p-house');

  // ---------- Notifications ----------
  const notify = (n: Omit<GuestDb['notifications'][number], 'id' | 'readAt'> & { read?: boolean }) => {
    const { read, ...rest } = n;
    db.notifications.push({ id: `ntf-${db.notifications.length + 1}`, readAt: read ? rest.createdAt : null, ...rest });
  };
  notify({ type: 'PLAN_UPCOMING', title: 'Upcoming plan', body: `Housewarming party (Flat 4B, Indiranagar) starts on ${dayOffset(2)} · Flat 4B, Indiranagar`, link: '/groups/g-flat/plans/p-house', groupId: 'g-flat', createdAt: new Date(now - 40 * 60_000).toISOString() });
  notify({ type: 'POLL_DEADLINE', title: 'Poll closing soon', body: '"Where should we stay in Coorg?" closes within 24 hours and you have not voted yet', link: '/groups/g-trip/plans/p-coorg', groupId: 'g-trip', createdAt: new Date(now - 2 * 3_600_000).toISOString() });
  notify({ type: 'INVITATION', title: 'Group invitation', body: 'Ananya Iyer invited you to join Saturday Badminton', link: '/groups', groupId: 'g-badminton', createdAt: at(dayOffset(-1), 19) });
  notify({ type: 'EXPENSE_CREATED', title: 'New expense', body: `Rahul Mehta added "Rain jackets" (${formatMoney(rupees(3600), CURRENCY)}) in Weekend Wanderers`, link: '/groups/g-trip/expenses/e-trip-jackets', groupId: 'g-trip', createdAt: stamp(dayOffset(-4), 18, 46) });
  notify({ type: 'EXPENSE_CREATED', title: 'New expense', body: `Meera Kapoor added "Weekend market run" (${formatMoney(rupees(2290), CURRENCY)}) in Flat 4B, Indiranagar`, link: '/groups/g-flat/expenses/e-flat-market', groupId: 'g-flat', createdAt: stamp(dayOffset(-9), 11, 46), read: true });
  notify({ type: 'BUDGET_WARNING', title: 'Approaching budget limit', body: 'Weekend Wanderers has used 84% of its budget.', link: '/groups/g-trip/budget', groupId: 'g-trip', createdAt: stamp(dayOffset(-15), 20, 16), read: true });
  notify({ type: 'SETTLEMENT', title: 'Repayment recorded', body: `Karan Shah paid Guest User ${formatMoney(rupees(4800), CURRENCY)} in Weekend Wanderers`, link: '/groups/g-trip/balances', groupId: 'g-trip', createdAt: stamp(dayOffset(-26), 18, 30), read: true });
  notify({ type: 'COMMENT', title: 'New comment', body: 'Priya Nair commented on "Casa Anjuna villa (3 nights)": Thanks for booking this! The pool was worth every rupee.', link: '/groups/g-trip/expenses/e-trip-villa', groupId: 'g-trip', createdAt: at(dayOffset(-37), 21, 55), read: true });
  notify({ type: 'POLL_CLOSED', title: 'Poll closed', body: '"Theme for the housewarming?" — "Retro Bollywood" won with 2 votes', link: '/groups/g-flat/plans/p-house', groupId: 'g-flat', createdAt: at(dayOffset(-3), 21), read: true });
  notify({ type: 'MEMBER_JOINED', title: 'New member', body: 'Dev Patel was added to Flat 4B, Indiranagar', link: '/groups/g-flat/members', groupId: 'g-flat', createdAt: at(dayOffset(-12), 18), read: true });
  db.notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return db;
}
