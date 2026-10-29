import { describe, expect, it } from 'vitest';
import { computeBalances, suggestSettlements, type LedgerExpense, type LedgerSettlement } from '../balances';
import { computeSplit } from '../split';

const members = ['alice', 'bob', 'chen', 'dia'];

function equalExpense(id: string, amount: number, payer: string, participants: string[]): LedgerExpense {
  const split = computeSplit({ method: 'EQUAL', totalMinor: amount, participants: participants.map((memberId) => ({ memberId })) });
  if (!split.ok) throw new Error(split.error);
  return { id, amountMinor: amount, payers: [{ memberId: payer, amountMinor: amount }], shares: split.shares };
}

const netOf = (balances: ReturnType<typeof computeBalances>) => Object.fromEntries(balances.map((b) => [b.memberId, b.netMinor]));

function applyTransfers(nets: Record<string, number>, transfers: ReturnType<typeof suggestSettlements>) {
  const next = { ...nets };
  for (const t of transfers) {
    next[t.fromMemberId] = (next[t.fromMemberId] ?? 0) + t.amountMinor;
    next[t.toMemberId] = (next[t.toMemberId] ?? 0) - t.amountMinor;
  }
  return next;
}

describe('computeBalances', () => {
  it('computes net = paid − share for a single equal expense', () => {
    const balances = computeBalances(members.slice(0, 3), [equalExpense('e1', 30000, 'alice', ['alice', 'bob', 'chen'])], []);
    expect(netOf(balances)).toEqual({ alice: 20000, bob: -10000, chen: -10000 });
    const alice = balances.find((b) => b.memberId === 'alice')!;
    expect(alice.paidMinor).toBe(30000);
    expect(alice.shareMinor).toBe(10000);
  });

  it('handles multiple payers independently of participant shares', () => {
    const expense: LedgerExpense = {
      id: 'e1',
      amountMinor: 400000,
      payers: [
        { memberId: 'alice', amountMinor: 300000 },
        { memberId: 'bob', amountMinor: 100000 },
      ],
      shares: [
        { memberId: 'alice', amountMinor: 100000 },
        { memberId: 'bob', amountMinor: 100000 },
        { memberId: 'chen', amountMinor: 100000 },
        { memberId: 'dia', amountMinor: 100000 },
      ],
    };
    expect(netOf(computeBalances(members, [expense], []))).toEqual({ alice: 200000, bob: 0, chen: -100000, dia: -100000 });
  });

  it('applies partial and multiple settlements', () => {
    const expenses = [equalExpense('e1', 30000, 'alice', ['alice', 'bob', 'chen'])];
    const settlements: LedgerSettlement[] = [
      { id: 's1', fromMemberId: 'bob', toMemberId: 'alice', amountMinor: 4000, status: 'RECORDED' },
      { id: 's2', fromMemberId: 'bob', toMemberId: 'alice', amountMinor: 1000, status: 'RECORDED' },
    ];
    expect(netOf(computeBalances(members.slice(0, 3), expenses, settlements))).toEqual({ alice: 15000, bob: -5000, chen: -10000 });
  });

  it('ignores reversed settlements and deleted expenses', () => {
    const expenses = [
      equalExpense('e1', 30000, 'alice', ['alice', 'bob', 'chen']),
      { ...equalExpense('e2', 99999, 'bob', ['alice', 'bob']), deleted: true },
    ];
    const settlements: LedgerSettlement[] = [
      { id: 's1', fromMemberId: 'bob', toMemberId: 'alice', amountMinor: 10000, status: 'REVERSED' },
    ];
    expect(netOf(computeBalances(members.slice(0, 3), expenses, settlements))).toEqual({ alice: 20000, bob: -10000, chen: -10000 });
  });

  it('reflects an edited expense exactly once (recomputation from source records)', () => {
    const original = equalExpense('e1', 30000, 'alice', ['alice', 'bob', 'chen']);
    const edited = equalExpense('e1', 60000, 'alice', ['alice', 'bob']);
    // The ledger only ever contains the current version of an expense.
    expect(netOf(computeBalances(members.slice(0, 3), [edited], []))).toEqual({ alice: 30000, bob: -30000, chen: 0 });
    expect(netOf(computeBalances(members.slice(0, 3), [original], []))).toEqual({ alice: 20000, bob: -10000, chen: -10000 });
  });

  it('keeps members with no activity at zero and the ledger summing to zero', () => {
    const balances = computeBalances(members, [equalExpense('e1', 10001, 'chen', ['alice', 'bob', 'chen'])], []);
    expect(balances.find((b) => b.memberId === 'dia')!.netMinor).toBe(0);
    expect(balances.reduce((a, b) => a + b.netMinor, 0)).toBe(0);
  });

  it('rejects an unbalanced expense', () => {
    const bad: LedgerExpense = { id: 'x', amountMinor: 100, payers: [{ memberId: 'alice', amountMinor: 100 }], shares: [{ memberId: 'bob', amountMinor: 99 }] };
    expect(() => computeBalances(members, [bad], [])).toThrow(/unbalanced/);
  });
});

describe('suggestSettlements', () => {
  it('returns no transfers when everyone is settled', () => {
    expect(suggestSettlements([{ memberId: 'a', netMinor: 0 }, { memberId: 'b', netMinor: 0 }])).toEqual([]);
  });

  it('settles a simple debt with a single transfer', () => {
    expect(suggestSettlements([{ memberId: 'a', netMinor: 500 }, { memberId: 'b', netMinor: -500 }])).toEqual([
      { fromMemberId: 'b', toMemberId: 'a', amountMinor: 500 },
    ]);
  });

  it('settles every balance to zero with at most n−1 transfers and no duplicates', () => {
    const nets = { a: 12345, b: -2345, c: -5000, d: -4999, e: -1, f: 0 };
    const transfers = suggestSettlements(Object.entries(nets).map(([memberId, netMinor]) => ({ memberId, netMinor })));
    const after = applyTransfers(nets, transfers);
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
    expect(transfers.length).toBeLessThanOrEqual(4); // 5 non-zero members
    const pairs = transfers.map((t) => `${t.fromMemberId}->${t.toMemberId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(transfers.every((t) => t.amountMinor > 0)).toBe(true);
    expect(transfers.some((t) => t.fromMemberId === 'f' || t.toMemberId === 'f')).toBe(false);
  });

  it('prefers exact matches', () => {
    const transfers = suggestSettlements([
      { memberId: 'a', netMinor: 700 },
      { memberId: 'b', netMinor: 300 },
      { memberId: 'c', netMinor: -300 },
      { memberId: 'd', netMinor: -700 },
    ]);
    expect(transfers).toHaveLength(2);
    expect(transfers).toContainEqual({ fromMemberId: 'c', toMemberId: 'b', amountMinor: 300 });
    expect(transfers).toContainEqual({ fromMemberId: 'd', toMemberId: 'a', amountMinor: 700 });
  });

  it('is deterministic', () => {
    const input = [
      { memberId: 'x', netMinor: 100 },
      { memberId: 'y', netMinor: 100 },
      { memberId: 'z', netMinor: -200 },
    ];
    expect(suggestSettlements(input)).toEqual(suggestSettlements([...input].reverse()));
  });

  it('rejects balances that do not sum to zero', () => {
    expect(() => suggestSettlements([{ memberId: 'a', netMinor: 1 }])).toThrow();
  });

  it('settles randomly generated ledgers exactly (property check)', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 200; round++) {
      const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
      const expenses: LedgerExpense[] = [];
      for (let i = 0; i < 8; i++) {
        const participants = ids.filter(() => rand() > 0.4);
        if (participants.length === 0) continue;
        expenses.push(equalExpense(`e${i}`, 1 + Math.floor(rand() * 100000), ids[Math.floor(rand() * ids.length)]!, participants));
      }
      const balances = computeBalances(ids, expenses, []);
      const nets = netOf(balances);
      const transfers = suggestSettlements(balances);
      const nonZero = balances.filter((b) => b.netMinor !== 0).length;
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      expect(Object.values(applyTransfers(nets, transfers)).every((v) => v === 0)).toBe(true);
    }
  });

  it('recomputes remaining suggestions after a partial repayment', () => {
    const expenses = [equalExpense('e1', 90000, 'alice', ['alice', 'bob', 'chen'])];
    const before = computeBalances(['alice', 'bob', 'chen'], expenses, []);
    expect(suggestSettlements(before)).toHaveLength(2);
    const after = computeBalances(['alice', 'bob', 'chen'], expenses, [
      { id: 's', fromMemberId: 'bob', toMemberId: 'alice', amountMinor: 10000, status: 'RECORDED' },
    ]);
    expect(suggestSettlements(after)).toEqual([
      { fromMemberId: 'chen', toMemberId: 'alice', amountMinor: 30000 },
      { fromMemberId: 'bob', toMemberId: 'alice', amountMinor: 20000 },
    ]);
  });
});
