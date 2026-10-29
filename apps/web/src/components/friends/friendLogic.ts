import type { ExpenseSummary, Friend, FriendGroup } from '../../api/types';

export type FriendFilter = 'all' | 'owes-you' | 'you-owe' | 'settled';

/** Which filter chips a friend matches. Someone can owe you in one currency and be owed in another. */
export function matchesFilter(friend: Friend, filter: FriendFilter): boolean {
  switch (filter) {
    case 'owes-you':
      return friend.balances.some((b) => b.netMinor > 0);
    case 'you-owe':
      return friend.balances.some((b) => b.netMinor < 0);
    case 'settled':
      return friend.balances.length === 0;
    default:
      return true;
  }
}

/** Per-currency totals across friends: what you are owed and what you owe. */
export function totalsByCurrency(friends: readonly Friend[]): { currency: string; owedToYouMinor: number; youOweMinor: number }[] {
  const map = new Map<string, { owedToYouMinor: number; youOweMinor: number }>();
  for (const f of friends) {
    for (const b of f.balances) {
      const entry = map.get(b.currency) ?? { owedToYouMinor: 0, youOweMinor: 0 };
      if (b.netMinor > 0) entry.owedToYouMinor += b.netMinor;
      else entry.youOweMinor += -b.netMinor;
      map.set(b.currency, entry);
    }
  }
  return [...map.entries()].map(([currency, t]) => ({ currency, ...t }));
}

export interface SettleLeg {
  group: FriendGroup;
  amountMinor: number;
  /** true: the friend pays you in this group; false: you pay the friend. */
  theyPay: boolean;
}

/**
 * The repayments the server will record for a friend settle-up (mirrors POST /friends/:key/settle).
 * Paying the whole net settles every group in that currency, each in its own direction.
 * A smaller amount pays down same-direction groups, largest first.
 */
export function planSettlement(groups: readonly FriendGroup[], currency: string, amountMinor: number): SettleLeg[] {
  // The server lists a friend's groups largest balance first; keep that order here.
  const inCurrency = groups.filter((g) => g.currency === currency && g.netMinor !== 0);
  const net = inCurrency.reduce((a, g) => a + g.netMinor, 0);
  if (net === 0 || amountMinor <= 0 || amountMinor > Math.abs(net)) return [];
  if (amountMinor === Math.abs(net)) {
    return inCurrency.map((g) => ({ group: g, amountMinor: Math.abs(g.netMinor), theyPay: g.netMinor > 0 }));
  }
  const legs: SettleLeg[] = [];
  let remaining = amountMinor;
  for (const g of inCurrency.filter((x) => Math.sign(x.netMinor) === Math.sign(net))) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, Math.abs(g.netMinor));
    legs.push({ group: g, amountMinor: amount, theyPay: g.netMinor > 0 });
    remaining -= amount;
  }
  return legs;
}

/** Your own position on one expense: positive = you lent (paid more than your share), negative = you borrowed. */
export function myNetOnExpense(expense: Pick<ExpenseSummary, 'payers' | 'shares'>, myMemberId: string): number {
  const paid = expense.payers.filter((p) => p.memberId === myMemberId).reduce((a, p) => a + p.amountMinor, 0);
  const share = expense.shares.filter((s) => s.memberId === myMemberId).reduce((a, s) => a + s.amountMinor, 0);
  return paid - share;
}

/** URL for a friend's page. Keys contain "." and may contain "@", so they are always encoded. */
export const friendPath = (key: string) => `/friends/${encodeURIComponent(key)}`;
