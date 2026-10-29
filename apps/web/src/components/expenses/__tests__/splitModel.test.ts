import { describe, expect, it } from 'vitest';
import { buildPayers, buildSplit, emptySplitDraft, evenPercents, newItem } from '../splitModel';

const order = ['a', 'b', 'c'];
const nameOf = (id: string) => ({ a: 'Alice', b: 'Bob', c: 'Chen' })[id] ?? id;

describe('buildSplit', () => {
  it('previews an equal split with deterministic paise remainder', () => {
    const r = buildSplit(emptySplitDraft(order), 10000, 'INR', order, nameOf);
    expect(r.ok && r.shares.map((s) => s.amountMinor)).toEqual([3334, 3333, 3333]);
    expect(r.ok && r.split).toEqual({ method: 'EQUAL', participants: [{ memberId: 'a' }, { memberId: 'b' }, { memberId: 'c' }] });
  });

  it('asks for the amount before previewing', () => {
    expect(buildSplit(emptySplitDraft(order), null, 'INR', order, nameOf)).toMatchObject({ ok: false, tone: 'info' });
  });

  it('reports how much is left to assign for exact splits', () => {
    const draft = { ...emptySplitDraft(order), method: 'EXACT' as const, exact: { a: '50', b: '49.99', c: '' } };
    expect(buildSplit(draft, 10000, 'INR', order, nameOf)).toMatchObject({ ok: false, message: '₹0.01 left to assign.' });
  });

  it('converts percentages to basis points and requires 100%', () => {
    const bad = { ...emptySplitDraft(order), method: 'PERCENTAGE' as const, percent: { a: '50', b: '30', c: '19.99' } };
    const r = buildSplit(bad, 10000, 'INR', order, nameOf);
    expect(r).toMatchObject({ ok: false, tone: 'error' });
    expect(!r.ok && r.message).toContain('99.99%');
    const good = { ...bad, percent: evenPercents(order) };
    const ok = buildSplit(good, 10000, 'INR', order, nameOf);
    expect(ok.ok && ok.split.participants.map((p) => p.value)).toEqual([3334, 3333, 3333]);
  });

  it('supports fractional shares', () => {
    const draft = { ...emptySplitDraft(order), method: 'SHARES' as const, shares: { a: '2', b: '1', c: '1' } };
    const r = buildSplit(draft, 400000, 'INR', order, nameOf);
    expect(r.ok && r.shares.map((s) => s.amountMinor)).toEqual([200000, 100000, 100000]);
  });

  it('builds itemized payloads and reports mismatches with the total', () => {
    const draft = {
      ...emptySplitDraft(order),
      method: 'ITEMIZED' as const,
      items: [{ ...newItem(['a', 'b']), description: 'Pizza', unitPrice: '11' }],
      tax: '1',
    };
    expect(buildSplit(draft, 1200, 'INR', order, nameOf)).toMatchObject({ ok: true });
    expect(buildSplit(draft, 1300, 'INR', order, nameOf)).toMatchObject({ ok: false, message: 'Items and charges are ₹1.00 less than the amount.' });
  });

  it('rejects malformed input with a named message', () => {
    const draft = { ...emptySplitDraft(order), method: 'EXACT' as const, exact: { a: 'abc' } };
    expect(buildSplit(draft, 100, 'INR', order, nameOf)).toMatchObject({ ok: false, message: expect.stringContaining('Alice') });
  });
});

describe('buildPayers', () => {
  it('uses the single payer for the whole amount', () => {
    expect(buildPayers({ multiple: false, payerId: 'a', amounts: {} }, 500, 'INR', order, nameOf)).toEqual({ ok: true, payers: [{ memberId: 'a', amountMinor: 500 }] });
  });

  it('validates multiple payer contributions against the total', () => {
    const short = buildPayers({ multiple: true, payerId: 'a', amounts: { a: '3000', b: '500' } }, 400000, 'INR', order, nameOf);
    expect(short).toMatchObject({ ok: false, message: '₹500.00 left to assign to payers.' });
    const exact = buildPayers({ multiple: true, payerId: 'a', amounts: { a: '3000', b: '1000' } }, 400000, 'INR', order, nameOf);
    expect(exact).toEqual({ ok: true, payers: [{ memberId: 'a', amountMinor: 300000 }, { memberId: 'b', amountMinor: 100000 }] });
  });
});
