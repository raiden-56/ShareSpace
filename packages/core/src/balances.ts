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
