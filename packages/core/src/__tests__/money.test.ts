import { describe, expect, it } from 'vitest';
import { computeBudgetStatus, budgetStateWorsened } from '../budget';
import { escapeCsvCell, toCsv } from '../csv';
import { convertComponents, convertMinor, parseRate } from '../fx';
import { formatMoney, minorToDecimalString, parseAmountToMinor } from '../money';
import { bucketKey, spendingByCategory, spendingByMember, spendingOverTime, type ReportExpense } from '../reports';
import { expenseSchema, groupCreateSchema, pollSchema } from '../schemas';

describe('money parsing and formatting', () => {
  it('parses decimal input into minor units without float error', () => {
    expect(parseAmountToMinor('0.1', 2)).toBe(10);
    expect(parseAmountToMinor('1,234.56', 2)).toBe(123456);
    expect(parseAmountToMinor('19.99', 2)).toBe(1999);
    expect(parseAmountToMinor('100', 0)).toBe(100);
    expect(parseAmountToMinor('1.234', 2)).toBeNull();
    expect(parseAmountToMinor('-5', 2)).toBeNull();
    expect(parseAmountToMinor('abc', 2)).toBeNull();
    expect(parseAmountToMinor('', 2)).toBeNull();
    expect(parseAmountToMinor('1.5', 0)).toBeNull();
  });

  it('round-trips to exact decimal strings', () => {
    expect(minorToDecimalString(5, 2)).toBe('0.05');
    expect(minorToDecimalString(-123456, 2)).toBe('-1234.56');
    expect(minorToDecimalString(7, 0)).toBe('7');
  });

  it('formats INR with Indian digit grouping', () => {
    expect(formatMoney(12345678, 'INR')).toBe('₹1,23,456.78');
    expect(formatMoney(1500, 'USD')).toBe('$15.00');
    expect(formatMoney(-1500, 'USD')).toBe('-$15.00');
    expect(formatMoney(1500, 'USD', { signed: true })).toBe('+$15.00');
  });
});

describe('fx conversion', () => {
  it('parses rates exactly', () => {
    expect(parseRate('83.25')).toEqual({ num: 8325n, den: 100n });
    expect(parseRate('0')).toBeNull();
    expect(parseRate('-1')).toBeNull();
    expect(parseRate('1e5')).toBeNull();
  });

  it('converts with half-up rounding across decimal places', () => {
    expect(convertMinor(1000, 2, 2, '83.25')).toBe(83250); // $10.00 → ₹832.50
    expect(convertMinor(1, 2, 2, '0.5')).toBe(1); // 0.5 paise rounds up
    expect(convertMinor(1000, 0, 2, '0.55')).toBe(55000); // ¥1000 → ₹550.00
  });

  it('converts components so they still sum to the converted total', () => {
    const parts = [333, 333, 334];
    const converted = convertComponents(parts, convertMinor(1000, 2, 2, '83.3333'));
    expect(converted.reduce((a, b) => a + b, 0)).toBe(83333);
  });
});

describe('budget status', () => {
  it('classifies normal, approaching and exceeded', () => {
    expect(computeBudgetStatus(10000, 5000, 80)).toMatchObject({ state: 'NORMAL', remainingMinor: 5000, usedBps: 5000 });
    expect(computeBudgetStatus(10000, 8000, 80).state).toBe('APPROACHING');
    expect(computeBudgetStatus(10000, 10000, 80).state).toBe('APPROACHING');
    expect(computeBudgetStatus(10000, 10001, 80)).toMatchObject({ state: 'EXCEEDED', remainingMinor: -1 });
  });

  it('detects when a warning should fire', () => {
    expect(budgetStateWorsened('NORMAL', 'APPROACHING')).toBe(true);
    expect(budgetStateWorsened('APPROACHING', 'APPROACHING')).toBe(false);
    expect(budgetStateWorsened('EXCEEDED', 'NORMAL')).toBe(false);
  });

  it('rejects invalid inputs', () => {
    expect(() => computeBudgetStatus(0, 0, 80)).toThrow();
    expect(() => computeBudgetStatus(100, -1, 80)).toThrow();
  });
});

describe('reports', () => {
  const rows: ReportExpense[] = [
    { id: '1', groupId: 'g', date: '2026-01-01', category: 'food', amountMinor: 300, payers: [{ memberId: 'a', amountMinor: 300 }], shares: [{ memberId: 'a', amountMinor: 150 }, { memberId: 'b', amountMinor: 150 }] },
    { id: '2', groupId: 'g', date: '2026-01-03', category: 'food', amountMinor: 200, payers: [{ memberId: 'b', amountMinor: 200 }], shares: [{ memberId: 'b', amountMinor: 200 }] },
    { id: '3', groupId: 'g', date: '2026-01-03', category: 'transport', amountMinor: 1000, payers: [{ memberId: 'a', amountMinor: 1000 }], shares: [{ memberId: 'a', amountMinor: 1000 }] },
  ];

  it('aggregates by category and member', () => {
    expect(spendingByCategory(rows)).toEqual([
      { key: 'transport', amountMinor: 1000, count: 1 },
      { key: 'food', amountMinor: 500, count: 2 },
    ]);
    expect(spendingByMember(rows)).toEqual([
      { memberId: 'a', paidMinor: 1300, shareMinor: 1150 },
      { memberId: 'b', paidMinor: 200, shareMinor: 350 },
    ]);
  });

  it('fills empty days so trends are not misleading', () => {
    expect(spendingOverTime(rows, 'day').map((b) => [b.key, b.amountMinor])).toEqual([
      ['2026-01-01', 300],
      ['2026-01-02', 0],
      ['2026-01-03', 1200],
    ]);
  });

  it('keys weeks by Monday and months by YYYY-MM', () => {
    expect(bucketKey('2026-10-29', 'week')).toBe('2026-10-26');
    expect(bucketKey('2026-10-29', 'month')).toBe('2026-10');
  });
});

describe('csv', () => {
  it('escapes quotes, commas and formula prefixes', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCsvCell(-12.5)).toBe('-12.5');
    expect(toCsv(['x'], [[null]])).toBe('x\r\n\r\n');
  });
});

describe('schemas', () => {
  it('validates an expense payload', () => {
    const ok = expenseSchema.safeParse({
      clientRequestId: '6f1c0b3e-0a3f-4f0e-9c51-2f6a0e7b9d11',
      title: 'Dinner',
      amountMinor: 1000,
      currency: 'INR',
      date: '2026-02-29',
      category: 'food',
      payers: [{ memberId: 'a', amountMinor: 1000 }],
      split: { method: 'EQUAL', participants: [{ memberId: 'a' }] },
    });
    expect(ok.success).toBe(false); // 2026 is not a leap year
    const fixed = expenseSchema.safeParse({
      clientRequestId: '6f1c0b3e-0a3f-4f0e-9c51-2f6a0e7b9d11',
      title: 'Dinner',
      amountMinor: 1000,
      currency: 'INR',
      date: '2026-02-28',
      category: 'food',
      payers: [{ memberId: 'a', amountMinor: 1000 }],
      split: { method: 'EQUAL', participants: [{ memberId: 'a' }] },
    });
    expect(fixed.success).toBe(true);
  });

  it('rejects negative and fractional amounts', () => {
    const base = { name: 'Trip', type: 'TRIP', currency: 'INR' };
    expect(groupCreateSchema.safeParse({ ...base, budgetMinor: -1 }).success).toBe(false);
    expect(groupCreateSchema.safeParse({ ...base, budgetMinor: 1.5 }).success).toBe(false);
    expect(groupCreateSchema.safeParse(base).success).toBe(true);
  });

  it('requires unique poll options', () => {
    expect(pollSchema.safeParse({ question: 'Where?', options: ['Goa', 'goa'] }).success).toBe(false);
  });
});
