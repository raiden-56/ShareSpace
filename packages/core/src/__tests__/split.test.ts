import { describe, expect, it } from 'vitest';
import { allocateEqually, allocateProportionally } from '../allocate';
import { computeSplit, validatePayers, type SplitInput } from '../split';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const amounts = (input: SplitInput) => {
  const r = computeSplit(input);
  if (!r.ok) throw new Error(r.error);
  return r.shares.map((s) => s.amountMinor);
};

describe('allocateProportionally', () => {
  it('never creates or loses money', () => {
    for (let total = 1; total < 500; total += 7) {
      for (const weights of [[1, 1, 1], [2, 1, 1], [3333, 3333, 3334], [1, 0, 5, 9], [7]]) {
        expect(sum(allocateProportionally(total, weights))).toBe(total);
      }
    }
  });

  it('gives leftover units to the largest remainders, ties to earlier recipients', () => {
    expect(allocateEqually(100, 3)).toEqual([34, 33, 33]);
    expect(allocateEqually(101, 3)).toEqual([34, 34, 33]);
    expect(allocateProportionally(10, [1, 2])).toEqual([3, 7]); // 3.33 / 6.67 → largest remainder is index 1
  });

  it('handles negative totals symmetrically', () => {
    expect(allocateEqually(-100, 3)).toEqual([-34, -33, -33]);
  });

  it('rejects impossible allocations', () => {
    expect(() => allocateProportionally(5, [])).toThrow();
    expect(() => allocateProportionally(5, [0, 0])).toThrow();
    expect(() => allocateProportionally(5, [-1, 2])).toThrow();
    expect(() => allocateProportionally(1.5, [1])).toThrow();
  });

  it('is exact for very large amounts', () => {
    const big = 999_999_999_999;
    expect(sum(allocateProportionally(big, [1, 1, 1, 1, 1, 1, 1]))).toBe(big);
  });
});

describe('equal split', () => {
  it('splits ₹100.00 among three with one-paise remainder going to the first participant', () => {
    const r = computeSplit({
      method: 'EQUAL',
      totalMinor: 10000,
      participants: [{ memberId: 'a' }, { memberId: 'b' }, { memberId: 'c' }],
    });
    expect(r.ok && r.shares).toEqual([
      { memberId: 'a', amountMinor: 3334 },
      { memberId: 'b', amountMinor: 3333 },
      { memberId: 'c', amountMinor: 3333 },
    ]);
  });

  it('supports a single participant', () => {
    expect(amounts({ method: 'EQUAL', totalMinor: 12345, participants: [{ memberId: 'a' }] })).toEqual([12345]);
  });

  it('rejects zero and negative amounts', () => {
    const p = [{ memberId: 'a' }];
    expect(computeSplit({ method: 'EQUAL', totalMinor: 0, participants: p }).ok).toBe(false);
    expect(computeSplit({ method: 'EQUAL', totalMinor: -500, participants: p }).ok).toBe(false);
    expect(computeSplit({ method: 'EQUAL', totalMinor: 10.5, participants: p }).ok).toBe(false);
  });

  it('rejects empty and duplicate participants', () => {
    expect(computeSplit({ method: 'EQUAL', totalMinor: 100, participants: [] })).toMatchObject({ ok: false, code: 'NO_PARTICIPANTS' });
    expect(
      computeSplit({ method: 'EQUAL', totalMinor: 100, participants: [{ memberId: 'a' }, { memberId: 'a' }] }),
    ).toMatchObject({ ok: false, code: 'DUPLICATE_PARTICIPANT' });
  });
});

describe('exact split', () => {
  it('accepts amounts that match the total, including unequal ones', () => {
    expect(
      amounts({ method: 'EXACT', totalMinor: 1000, participants: [{ memberId: 'a', value: 700 }, { memberId: 'b', value: 300 }] }),
    ).toEqual([700, 300]);
  });

  it('reports the exact one-paise difference when short', () => {
    const r = computeSplit({
      method: 'EXACT',
      totalMinor: 1000,
      participants: [{ memberId: 'a', value: 500 }, { memberId: 'b', value: 499 }],
    });
    expect(r).toMatchObject({ ok: false, code: 'SUM_MISMATCH', differenceMinor: 1 });
  });

  it('reports overshoot as a negative difference', () => {
    const r = computeSplit({
      method: 'EXACT',
      totalMinor: 1000,
      participants: [{ memberId: 'a', value: 600 }, { memberId: 'b', value: 401 }],
    });
    expect(r).toMatchObject({ ok: false, differenceMinor: -1 });
  });

  it('rejects missing or negative values', () => {
    expect(computeSplit({ method: 'EXACT', totalMinor: 100, participants: [{ memberId: 'a' }] }).ok).toBe(false);
    expect(computeSplit({ method: 'EXACT', totalMinor: 100, participants: [{ memberId: 'a', value: -100 }] }).ok).toBe(false);
  });
});

describe('percentage split', () => {
  it('splits by basis points and reconciles the remainder', () => {
    // 33.33% / 33.33% / 33.34% of ₹100.01
    const result = amounts({
      method: 'PERCENTAGE',
      totalMinor: 10001,
      participants: [
        { memberId: 'a', value: 3333 },
        { memberId: 'b', value: 3333 },
        { memberId: 'c', value: 3334 },
      ],
    });
    expect(sum(result)).toBe(10001);
    expect(result).toEqual([3333, 3333, 3335]);
  });

  it('requires exactly 100%', () => {
    const r = computeSplit({
      method: 'PERCENTAGE',
      totalMinor: 1000,
      participants: [{ memberId: 'a', value: 5000 }, { memberId: 'b', value: 4999 }],
    });
    expect(r).toMatchObject({ ok: false, code: 'SUM_MISMATCH' });
    expect(!r.ok && r.error).toContain('99.99%');
  });

  it('allows 0% participants', () => {
    expect(
      amounts({ method: 'PERCENTAGE', totalMinor: 1000, participants: [{ memberId: 'a', value: 10000 }, { memberId: 'b', value: 0 }] }),
    ).toEqual([1000, 0]);
  });
});

describe('shares split', () => {
  it('splits 2:1:1', () => {
    expect(
      amounts({
        method: 'SHARES',
        totalMinor: 400000,
        participants: [
          { memberId: 'a', value: 200 },
          { memberId: 'b', value: 100 },
          { memberId: 'c', value: 100 },
        ],
      }),
    ).toEqual([200000, 100000, 100000]);
  });

  it('handles fractional shares and indivisible totals', () => {
    const result = amounts({
      method: 'SHARES',
      totalMinor: 1001,
      participants: [
        { memberId: 'a', value: 150 },
        { memberId: 'b', value: 150 },
        { memberId: 'c', value: 100 },
      ],
    });
    expect(sum(result)).toBe(1001);
    expect(result).toEqual([376, 375, 250]);
  });

  it('rejects all-zero shares', () => {
    expect(
      computeSplit({ method: 'SHARES', totalMinor: 100, participants: [{ memberId: 'a', value: 0 }] }),
    ).toMatchObject({ ok: false, code: 'ZERO_WEIGHTS' });
  });
});

describe('itemized split', () => {
  it('assigns items only to the people who had them and allocates tax proportionally', () => {
    const r = computeSplit({
      method: 'ITEMIZED',
      totalMinor: 1100 + 600 + 170, // items 1700 + tax 170
      participants: [],
      items: [
        { description: 'Pizza', quantity: 1, unitPriceMinor: 1100, memberIds: ['a', 'b'] },
        { description: 'Beer', quantity: 2, unitPriceMinor: 300, memberIds: ['b'] },
      ],
      adjustments: { taxMinor: 170 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // a: 550 items, b: 550 + 600 = 1150 items. Tax 170 split 550:1150 → 55 : 115
    expect(r.shares).toEqual([
      { memberId: 'a', amountMinor: 605 },
      { memberId: 'b', amountMinor: 1265 },
    ]);
    expect(r.itemized?.[1]).toMatchObject({ itemsMinor: 1150, taxMinor: 115 });
  });

  it('applies discounts and service charges and still sums exactly', () => {
    const r = computeSplit({
      method: 'ITEMIZED',
      totalMinor: 1000 + 333 + 100 - 50,
      participants: [],
      items: [
        { description: 'Thali', quantity: 1, unitPriceMinor: 1000, memberIds: ['a', 'b', 'c'] },
        { description: 'Lassi', quantity: 1, unitPriceMinor: 333, memberIds: ['c'] },
      ],
      adjustments: { serviceMinor: 100, discountMinor: 50 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(sum(r.shares.map((s) => s.amountMinor))).toBe(1383);
  });

  it('rejects items that do not match the expense amount', () => {
    const r = computeSplit({
      method: 'ITEMIZED',
      totalMinor: 999,
      participants: [],
      items: [{ description: 'A', quantity: 1, unitPriceMinor: 1000, memberIds: ['a'] }],
    });
    expect(r).toMatchObject({ ok: false, code: 'SUM_MISMATCH', differenceMinor: -1 });
  });

  it('rejects unassigned items and invalid quantities', () => {
    const base = { method: 'ITEMIZED' as const, totalMinor: 100, participants: [] };
    expect(computeSplit({ ...base, items: [{ description: 'A', quantity: 1, unitPriceMinor: 100, memberIds: [] }] }).ok).toBe(false);
    expect(computeSplit({ ...base, items: [{ description: 'A', quantity: 0, unitPriceMinor: 100, memberIds: ['a'] }] }).ok).toBe(false);
    expect(computeSplit({ ...base, items: [] }).ok).toBe(false);
  });

  it('rejects a discount larger than the bill', () => {
    const r = computeSplit({
      method: 'ITEMIZED',
      totalMinor: 1,
      participants: [],
      items: [{ description: 'A', quantity: 1, unitPriceMinor: 100, memberIds: ['a'] }],
      adjustments: { discountMinor: 200 },
    });
    expect(r.ok).toBe(false);
  });
});

describe('validatePayers', () => {
  it('accepts multiple payers that sum to the total (₹4,000 = ₹3,000 + ₹1,000)', () => {
    expect(validatePayers(400000, [{ memberId: 'a', amountMinor: 300000 }, { memberId: 'b', amountMinor: 100000 }])).toEqual({ ok: true });
  });

  it('rejects contributions that do not add up', () => {
    expect(validatePayers(400000, [{ memberId: 'a', amountMinor: 300000 }])).toMatchObject({ ok: false, differenceMinor: 100000 });
  });

  it('rejects duplicates, empty lists and non-positive amounts', () => {
    expect(validatePayers(100, []).ok).toBe(false);
    expect(validatePayers(100, [{ memberId: 'a', amountMinor: 50 }, { memberId: 'a', amountMinor: 50 }]).ok).toBe(false);
    expect(validatePayers(100, [{ memberId: 'a', amountMinor: 100 }, { memberId: 'b', amountMinor: 0 }]).ok).toBe(false);
  });
});
