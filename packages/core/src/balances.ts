import { type Minor } from './money';

export interface LedgerExpense {
  id: string;
  amountMinor: Minor;
  payers: { memberId: string; amountMinor: Minor }[];
  shares: { memberId: string; amountMinor: Minor }[];
  deleted?: boolean;
}

export const SETTLEMENT_STATUSES = ['RECORDED', 'REVERSED'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export interface LedgerSettlement {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: Minor;
  status: SettlementStatus;
}

export interface MemberBalance {
  memberId: string;
  /** Total contributed as a payer of expenses. */
  paidMinor: Minor;
  /** Total allocated share of expenses (what they consumed). */
  shareMinor: Minor;
  /** Repayments this member sent to others. */
  settlementsPaidMinor: Minor;
  /** Repayments this member received from others. */
  settlementsReceivedMinor: Minor;
  /**
   * Net position. Positive = the group owes this member. Negative = this member owes the group.
   * net = paid − share + settlementsPaid − settlementsReceived
   */
  netMinor: Minor;
}

/**
 * Computes every member's net position from recorded payer contributions, allocated shares and
 * recorded (non-reversed) settlements. Deleted expenses and reversed settlements have no effect.
 * Throws if the ledger is internally inconsistent (nets must always sum to zero).
 */
export function computeBalances(
  memberIds: readonly string[],
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
): MemberBalance[] {
  const map = new Map<string, MemberBalance>();
  const get = (id: string): MemberBalance => {
    let entry = map.get(id);
    if (!entry) {
      entry = { memberId: id, paidMinor: 0, shareMinor: 0, settlementsPaidMinor: 0, settlementsReceivedMinor: 0, netMinor: 0 };
      map.set(id, entry);
    }
    return entry;
  };
  memberIds.forEach(get);

  for (const expense of expenses) {
    if (expense.deleted) continue;
    const paid = expense.payers.reduce((a, p) => a + p.amountMinor, 0);
    const shared = expense.shares.reduce((a, s) => a + s.amountMinor, 0);
    if (paid !== expense.amountMinor || shared !== expense.amountMinor) {
      throw new Error(`Expense ${expense.id} is unbalanced`);
    }
    for (const p of expense.payers) get(p.memberId).paidMinor += p.amountMinor;
    for (const s of expense.shares) get(s.memberId).shareMinor += s.amountMinor;
  }

  for (const s of settlements) {
    if (s.status !== 'RECORDED') continue;
    get(s.fromMemberId).settlementsPaidMinor += s.amountMinor;
    get(s.toMemberId).settlementsReceivedMinor += s.amountMinor;
  }

  let total = 0;
  for (const b of map.values()) {
    b.netMinor = b.paidMinor - b.shareMinor + b.settlementsPaidMinor - b.settlementsReceivedMinor;
    total += b.netMinor;
  }
  if (total !== 0) throw new Error('Ledger is unbalanced: net positions do not sum to zero');
  return [...map.values()];
}

export interface Transfer {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: Minor;
}

/**
 * Suggests transfers that settle all net positions.
 *
 * Algorithm (deterministic greedy):
 * 1. Members with a zero balance are ignored.
 * 2. Debtor/creditor pairs with exactly matching amounts are settled first (one transfer each).
 * 3. Then the largest remaining debtor repeatedly pays the largest remaining creditor.
 *
 * This always produces at most (n − 1) transfers for n non-zero members and settles every balance
 * exactly. It is a heuristic: finding the true minimum number of transfers is NP-hard in general,
 * so optimality is not claimed for every input.
 */
export function suggestSettlements(balances: readonly { memberId: string; netMinor: Minor }[]): Transfer[] {
  const total = balances.reduce((a, b) => a + b.netMinor, 0);
  if (total !== 0) throw new Error('Balances must sum to zero');

  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const debtors = balances.filter((b) => b.netMinor < 0).map((b) => ({ id: b.memberId, amt: -b.netMinor })).sort(byId);
  const creditors = balances.filter((b) => b.netMinor > 0).map((b) => ({ id: b.memberId, amt: b.netMinor })).sort(byId);
  const transfers: Transfer[] = [];

  // Pass 1: exact matches.
  for (const d of debtors) {
    const c = creditors.find((x) => x.amt > 0 && x.amt === d.amt);
    if (c) {
      transfers.push({ fromMemberId: d.id, toMemberId: c.id, amountMinor: d.amt });
      c.amt = 0;
      d.amt = 0;
    }
  }

  // Pass 2: largest debtor pays largest creditor. Stable sort keeps ties ordered by member id.
  const desc = (a: { amt: number }, b: { amt: number }) => b.amt - a.amt;
  for (;;) {
    const d = debtors.filter((x) => x.amt > 0).sort(desc)[0];
    const c = creditors.filter((x) => x.amt > 0).sort(desc)[0];
    if (!d || !c) break;
    const amount = Math.min(d.amt, c.amt);
    transfers.push({ fromMemberId: d.id, toMemberId: c.id, amountMinor: amount });
    d.amt -= amount;
    c.amt -= amount;
  }

  return transfers;
}

/** Validates a proposed repayment against current balances (partial settlements are allowed). */
export function validateSettlement(
  balances: readonly MemberBalance[],
  fromMemberId: string,
  toMemberId: string,
  amountMinor: Minor,
): { ok: true } | { ok: false; error: string } {
  if (fromMemberId === toMemberId) return { ok: false, error: 'Payer and recipient must be different members' };
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { ok: false, error: 'Amount must be greater than zero' };
  const ids = new Set(balances.map((b) => b.memberId));
  if (!ids.has(fromMemberId) || !ids.has(toMemberId)) return { ok: false, error: 'Both members must belong to the group' };
  return { ok: true };
}

/**
 * Who owes whom without simplification: each debt stays between the two people it arose between.
 *
 * Per expense, members who paid less than their share owe members who paid more than theirs.
 * Debtors and creditors are matched in the order they appear on the expense (single-payer
 * expenses, the common case, simply mean "each participant owes the payer their share").
 * Recorded settlements reduce the debt between the two members involved. All pairs are then
 * netted, so A→B 200 and B→A 50 become a single A→B 150.
 *
 * Each member's total across the returned transfers always equals their net balance from
 * `computeBalances`, so settling every transfer settles the group exactly.
 */
export function computePairwiseDebts(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
): Transfer[] {
  // owed.get("a|b") = amount a owes b, kept only for a < b; negative means b owes a.
  const owed = new Map<string, Minor>();
  const add = (from: string, to: string, amount: Minor) => {
    if (from === to || amount === 0) return;
    const [a, b, sign] = from < to ? [from, to, 1] : [to, from, -1];
    const key = `${a}|${b}`;
    owed.set(key, (owed.get(key) ?? 0) + sign * amount);
  };

  for (const expense of expenses) {
    if (expense.deleted) continue;
    const net = new Map<string, Minor>();
    const order: string[] = [];
    const bump = (id: string, delta: Minor) => {
      if (!net.has(id)) order.push(id);
      net.set(id, (net.get(id) ?? 0) + delta);
    };
    for (const p of expense.payers) bump(p.memberId, p.amountMinor);
    for (const s of expense.shares) bump(s.memberId, -s.amountMinor);
    const debtors = order.filter((id) => net.get(id)! < 0).map((id) => ({ id, amt: -net.get(id)! }));
    const creditors = order.filter((id) => net.get(id)! > 0).map((id) => ({ id, amt: net.get(id)! }));
    let c = 0;
    for (const d of debtors) {
      while (d.amt > 0 && c < creditors.length) {
        const creditor = creditors[c]!;
        const amount = Math.min(d.amt, creditor.amt);
        add(d.id, creditor.id, amount);
        d.amt -= amount;
        creditor.amt -= amount;
        if (creditor.amt === 0) c++;
      }
    }
  }

  // A repayment from X to Y reduces what X owes Y (or creates a debt Y→X if X overpaid).
  for (const s of settlements) {
    if (s.status !== 'RECORDED') continue;
    add(s.toMemberId, s.fromMemberId, s.amountMinor);
  }

  const transfers: Transfer[] = [];
  for (const [key, amount] of [...owed.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (amount === 0) continue;
    const [a, b] = key.split('|') as [string, string];
    transfers.push(amount > 0 ? { fromMemberId: a, toMemberId: b, amountMinor: amount } : { fromMemberId: b, toMemberId: a, amountMinor: -amount });
  }
  return transfers;
}

/** Net amount between two members across a set of transfers. Positive = `other` owes `me`. */
export function netBetween(transfers: readonly Transfer[], me: string, other: string): Minor {
  let total = 0;
  for (const t of transfers) {
    if (t.fromMemberId === other && t.toMemberId === me) total += t.amountMinor;
    else if (t.fromMemberId === me && t.toMemberId === other) total -= t.amountMinor;
  }
  return total;
}
