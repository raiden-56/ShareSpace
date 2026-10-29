import { describe, expect, it } from 'vitest';
import { computeBalances, computePairwiseDebts, netBetween, suggestSettlements, type LedgerExpense, type LedgerSettlement } from '../balances';
import { dueOccurrences, MAX_OCCURRENCES_PER_SYNC, occurrenceDate } from '../recurring';
import { computeSplit } from '../split';

function expense(id: string, payers: Record<string, number>, shares: Record<string, number>): LedgerExpense {
  const amount = Object.values(payers).reduce((a, b) => a + b, 0);
  return {
    id,
    amountMinor: amount,
    payers: Object.entries(payers).map(([memberId, amountMinor]) => ({ memberId, amountMinor })),
    shares: Object.entries(shares).map(([memberId, amountMinor]) => ({ memberId, amountMinor })),
  };
}

const settled = (id: string, from: string, to: string, amountMinor: number): LedgerSettlement => ({ id, fromMemberId: from, toMemberId: to, amountMinor, status: 'RECORDED' });

describe('netting across expenses', () => {
  it('nets two expenses paid by different people into one repayment', () => {
    // I pay ₹200 for both of us, my friend pays ₹100 for both of us: total ₹300, ₹150 each.
    const ledger = [expense('dinner', { me: 20000 }, { me: 10000, friend: 10000 }), expense('taxi', { friend: 10000 }, { me: 5000, friend: 5000 })];
    const balances = computeBalances(['me', 'friend'], ledger, []);
    expect(balances.find((b) => b.memberId === 'me')!.netMinor).toBe(5000);
    expect(suggestSettlements(balances)).toEqual([{ fromMemberId: 'friend', toMemberId: 'me', amountMinor: 5000 }]);
    expect(computePairwiseDebts(ledger, [])).toEqual([{ fromMemberId: 'friend', toMemberId: 'me', amountMinor: 5000 }]);
  });

  it('nets expenses paid entirely for the other person', () => {
    // I pay ₹200 that is all for my friend; my friend pays ₹100 that is all for me: they owe me ₹100.
    const ledger = [expense('a', { me: 20000 }, { friend: 20000 }), expense('b', { friend: 10000 }, { me: 10000 })];
    expect(computePairwiseDebts(ledger, [])).toEqual([{ fromMemberId: 'friend', toMemberId: 'me', amountMinor: 10000 }]);
  });

  it('applies a repayment and settles to zero', () => {
    const ledger = [expense('a', { me: 20000 }, { friend: 20000 }), expense('b', { friend: 10000 }, { me: 10000 })];
    expect(computePairwiseDebts(ledger, [settled('s1', 'friend', 'me', 4000)])).toEqual([{ fromMemberId: 'friend', toMemberId: 'me', amountMinor: 6000 }]);
    expect(computePairwiseDebts(ledger, [settled('s1', 'friend', 'me', 10000)])).toEqual([]);
  });
});

describe('pairwise debts without simplification', () => {
  it('keeps debts between the people who incurred them', () => {
    // a paid for b, b paid for c: simplified would be c→a, pairwise keeps b→a and c→b.
    const ledger = [expense('1', { a: 1000 }, { b: 1000 }), expense('2', { b: 1000 }, { c: 1000 })];
    expect(suggestSettlements(computeBalances(['a', 'b', 'c'], ledger, []))).toEqual([{ fromMemberId: 'c', toMemberId: 'a', amountMinor: 1000 }]);
    expect(computePairwiseDebts(ledger, [])).toEqual([
      { fromMemberId: 'b', toMemberId: 'a', amountMinor: 1000 },
      { fromMemberId: 'c', toMemberId: 'b', amountMinor: 1000 },
    ]);
  });

  it('splits a multi-payer expense between the over-payers', () => {
    // a paid 60, b paid 40, split three ways (3334/3333/3333): c owes a 2666 and b 667.
    const ledger = [expense('1', { a: 6000, b: 4000 }, { a: 3334, b: 3333, c: 3333 })];
    expect(computePairwiseDebts(ledger, [])).toEqual([
      { fromMemberId: 'c', toMemberId: 'a', amountMinor: 2666 },
      { fromMemberId: 'c', toMemberId: 'b', amountMinor: 667 },
    ]);
  });

  it('ignores deleted expenses and reversed settlements', () => {
    const ledger = [{ ...expense('1', { a: 1000 }, { b: 1000 }), deleted: true }];
    expect(computePairwiseDebts(ledger, [{ ...settled('s', 'b', 'a', 500), status: 'REVERSED' }])).toEqual([]);
  });

  it('always agrees with net balances (property check)', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const people = ['a', 'b', 'c', 'd', 'e'];
    for (let run = 0; run < 200; run++) {
      const ledger: LedgerExpense[] = [];
      for (let i = 0; i < 1 + rand(8); i++) {
        const total = 1 + rand(100000);
        const participants = people.filter(() => rand(2) === 1);
        if (participants.length === 0) participants.push('a');
        const split = computeSplit({ method: 'SHARES', totalMinor: total, participants: participants.map((memberId) => ({ memberId, value: 1 + rand(300) })) });
        if (!split.ok) throw new Error(split.error);
        const payerA = people[rand(5)]!;
        const payerB = people[rand(5)]!;
        const first = payerA === payerB ? total : 1 + rand(total);
        const payers = payerA === payerB || first === total ? [{ memberId: payerA, amountMinor: total }] : [{ memberId: payerA, amountMinor: first }, { memberId: payerB, amountMinor: total - first }];
        ledger.push({ id: `${run}-${i}`, amountMinor: total, payers, shares: split.shares });
      }
      const settlements = [settled('s', people[rand(5)]!, people[(rand(4) + 1) % 5]!, 1 + rand(5000))].filter((s) => s.fromMemberId !== s.toMemberId);
      const balances = computeBalances(people, ledger, settlements);
      const transfers = computePairwiseDebts(ledger, settlements);
      for (const b of balances) {
        const fromTransfers = transfers.reduce((sum, t) => sum + (t.toMemberId === b.memberId ? t.amountMinor : 0) - (t.fromMemberId === b.memberId ? t.amountMinor : 0), 0);
        expect(fromTransfers).toBe(b.netMinor);
      }
      for (const t of transfers) expect(t.amountMinor).toBeGreaterThan(0);
    }
  });

  it('reports the net between two people', () => {
    const transfers = [
      { fromMemberId: 'b', toMemberId: 'a', amountMinor: 700 },
      { fromMemberId: 'a', toMemberId: 'c', amountMinor: 300 },
    ];
    expect(netBetween(transfers, 'a', 'b')).toBe(700);
    expect(netBetween(transfers, 'a', 'c')).toBe(-300);
    expect(netBetween(transfers, 'b', 'c')).toBe(0);
  });
});

describe('split by adjustment', () => {
  const people = [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 3000 }, { memberId: 'c' }];

  it('charges each adjustment to that person and splits the rest equally', () => {
    // ₹100 total, b had a ₹30 extra: ₹70 split three ways (2334/2333/2333), b pays 2333 + 3000.
    const result = computeSplit({ method: 'ADJUSTMENT', totalMinor: 10000, participants: people });
    expect(result).toEqual({ ok: true, shares: [{ memberId: 'a', amountMinor: 2334 }, { memberId: 'b', amountMinor: 5333 }, { memberId: 'c', amountMinor: 2333 }] });
  });

  it('rejects adjustments larger than the total', () => {
    const result = computeSplit({ method: 'ADJUSTMENT', totalMinor: 2000, participants: people });
    expect(result).toMatchObject({ ok: false, code: 'SUM_MISMATCH', differenceMinor: -1000 });
  });

  it('rejects negative adjustments', () => {
    const result = computeSplit({ method: 'ADJUSTMENT', totalMinor: 2000, participants: [{ memberId: 'a', value: -1 }] });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
  });

  it('is an equal split when every adjustment is zero', () => {
    const result = computeSplit({ method: 'ADJUSTMENT', totalMinor: 100, participants: [{ memberId: 'a' }, { memberId: 'b' }, { memberId: 'c' }] });
    expect(result).toEqual(computeSplit({ method: 'EQUAL', totalMinor: 100, participants: [{ memberId: 'a' }, { memberId: 'b' }, { memberId: 'c' }] }));
  });
});

describe('repeating expenses', () => {
  it('steps weekly and fortnightly across month and year ends', () => {
    expect(occurrenceDate('2026-12-28', 'WEEKLY', 1)).toBe('2027-01-04');
    expect(occurrenceDate('2026-02-20', 'FORTNIGHTLY', 1)).toBe('2026-03-06');
  });

  it('clamps month ends and returns to the original day', () => {
    expect(occurrenceDate('2026-01-31', 'MONTHLY', 1)).toBe('2026-02-28');
    expect(occurrenceDate('2026-01-31', 'MONTHLY', 2)).toBe('2026-03-31');
    expect(occurrenceDate('2028-01-31', 'MONTHLY', 1)).toBe('2028-02-29');
    expect(occurrenceDate('2026-11-30', 'QUARTERLY', 1)).toBe('2027-02-28');
    expect(occurrenceDate('2028-02-29', 'YEARLY', 1)).toBe('2029-02-28');
    expect(occurrenceDate('2028-02-29', 'YEARLY', 4)).toBe('2032-02-29');
  });

  it('lists the repeats that are due and the next one', () => {
    expect(dueOccurrences('2026-08-15', 'MONTHLY', 0, '2026-10-29')).toEqual({
      due: [{ n: 1, date: '2026-09-15' }, { n: 2, date: '2026-10-15' }],
      next: { n: 3, date: '2026-11-15' },
    });
    expect(dueOccurrences('2026-08-15', 'MONTHLY', 2, '2026-10-29').due).toEqual([]);
    expect(dueOccurrences('2026-10-29', 'NONE', 0, '2026-12-31')).toEqual({ due: [], next: null });
  });

  it('caps how many repeats are created at once', () => {
    const result = dueOccurrences('2020-01-01', 'WEEKLY', 0, '2026-10-29');
    expect(result.due).toHaveLength(MAX_OCCURRENCES_PER_SYNC);
    expect(result.next).toEqual({ n: MAX_OCCURRENCES_PER_SYNC + 1, date: occurrenceDate('2020-01-01', 'WEEKLY', MAX_OCCURRENCES_PER_SYNC + 1) });
  });
});
