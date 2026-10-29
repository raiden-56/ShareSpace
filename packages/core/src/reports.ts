import { type Minor } from './money';

export interface ReportExpense {
  id: string;
  groupId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  category: string;
  /** In the group's primary currency. */
  amountMinor: Minor;
  planId?: string | null;
  payers: { memberId: string; amountMinor: Minor }[];
  shares: { memberId: string; amountMinor: Minor }[];
}

export interface Bucket {
  key: string;
  amountMinor: Minor;
  count: number;
}

export function inDateRange(date: string, from?: string | null, to?: string | null): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function groupSum<T>(rows: readonly T[], keyOf: (row: T) => string, amountOf: (row: T) => Minor): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key) ?? { key, amountMinor: 0, count: 0 };
    bucket.amountMinor += amountOf(row);
    bucket.count += 1;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => b.amountMinor - a.amountMinor || a.key.localeCompare(b.key));
}

export function spendingByCategory(expenses: readonly ReportExpense[]): Bucket[] {
  return groupSum(expenses, (e) => e.category, (e) => e.amountMinor);
}

export function spendingByGroup(expenses: readonly ReportExpense[]): Bucket[] {
  return groupSum(expenses, (e) => e.groupId, (e) => e.amountMinor);
}

export function spendingByPlan(expenses: readonly ReportExpense[]): Bucket[] {
  return groupSum(
    expenses.filter((e) => e.planId),
    (e) => e.planId!,
    (e) => e.amountMinor,
  );
}

/** Per member: what they paid and what they consumed (their allocated shares). */
export function spendingByMember(
  expenses: readonly ReportExpense[],
): { memberId: string; paidMinor: Minor; shareMinor: Minor }[] {
  const map = new Map<string, { memberId: string; paidMinor: Minor; shareMinor: Minor }>();
  const get = (id: string) => {
    let row = map.get(id);
    if (!row) {
      row = { memberId: id, paidMinor: 0, shareMinor: 0 };
      map.set(id, row);
    }
    return row;
  };
  for (const e of expenses) {
    for (const p of e.payers) get(p.memberId).paidMinor += p.amountMinor;
    for (const s of e.shares) get(s.memberId).shareMinor += s.amountMinor;
  }
  return [...map.values()].sort((a, b) => b.shareMinor - a.shareMinor);
}

export type Granularity = 'day' | 'week' | 'month';

/** Bucket key for a YYYY-MM-DD date. Weeks start on Monday and are keyed by their Monday. */
export function bucketKey(date: string, granularity: Granularity): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Spending per period, with empty periods filled in so trends are not misleading. */
export function spendingOverTime(
  expenses: readonly ReportExpense[],
  granularity: Granularity,
  from?: string,
  to?: string,
): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (const e of expenses) {
    const key = bucketKey(e.date, granularity);
    const b = buckets.get(key) ?? { key, amountMinor: 0, count: 0 };
    b.amountMinor += e.amountMinor;
    b.count += 1;
    buckets.set(key, b);
  }
  const dates = expenses.map((e) => e.date).sort();
  const start = from ?? dates[0];
  const end = to ?? dates[dates.length - 1];
  if (start && end && start <= end) {
    const cursor = new Date(`${bucketKey(start, granularity)}${granularity === 'month' ? '-01' : ''}T00:00:00Z`);
    const endKey = bucketKey(end, granularity);
    for (let guard = 0; guard < 1000; guard++) {
      const key = bucketKey(cursor.toISOString().slice(0, 10), granularity);
      if (key > endKey) break;
      if (!buckets.has(key)) buckets.set(key, { key, amountMinor: 0, count: 0 });
      if (granularity === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
      else if (granularity === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Picks a sensible granularity for a date span so charts stay readable. */
export function pickGranularity(from: string, to: string): Granularity {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days <= 45) return 'day';
  if (days <= 200) return 'week';
  return 'month';
}
