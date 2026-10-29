import { allocateEqually, allocateProportionally } from './allocate';
import { type Minor } from './money';

export const SPLIT_METHODS = ['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES', 'ITEMIZED'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

/** Percentages are expressed in basis points: 100% = 10_000 (two decimal places of precision). */
export const FULL_PERCENT_BPS = 10_000;
/** Shares are expressed in hundredths so "1.5 shares" = 150. */
export const SHARE_SCALE = 100;

export interface SplitParticipantInput {
  memberId: string;
  /**
   * Meaning depends on the method:
   * - EQUAL: ignored
   * - EXACT: amount in minor units
   * - PERCENTAGE: basis points (2500 = 25.00%)
   * - SHARES: hundredths of a share (100 = 1 share)
   * - ITEMIZED: ignored (derived from items)
   */
  value?: number;
}

export interface SplitItemInput {
  description: string;
  quantity: number;
  unitPriceMinor: Minor;
  memberIds: string[];
}

export interface SplitAdjustments {
  taxMinor?: Minor;
  serviceMinor?: Minor;
  discountMinor?: Minor;
}

export interface SplitInput {
  method: SplitMethod;
  totalMinor: Minor;
  participants: SplitParticipantInput[];
  items?: SplitItemInput[];
  adjustments?: SplitAdjustments;
}

export interface ShareResult {
  memberId: string;
  amountMinor: Minor;
}

export interface ItemizedBreakdown {
  memberId: string;
  itemsMinor: Minor;
  taxMinor: Minor;
  serviceMinor: Minor;
  discountMinor: Minor;
  totalMinor: Minor;
}

export type SplitErrorCode =
  | 'INVALID_TOTAL'
  | 'NO_PARTICIPANTS'
  | 'DUPLICATE_PARTICIPANT'
  | 'INVALID_VALUE'
  | 'SUM_MISMATCH'
  | 'ZERO_WEIGHTS'
  | 'INVALID_ITEM'
  | 'INVALID_ADJUSTMENT';

export type SplitResult =
  | { ok: true; shares: ShareResult[]; itemized?: ItemizedBreakdown[] }
  | { ok: false; code: SplitErrorCode; error: string; differenceMinor?: Minor };

const fail = (code: SplitErrorCode, error: string, differenceMinor?: Minor): SplitResult => ({
  ok: false,
  code,
  error,
  differenceMinor,
});

function isNonNegInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

export function itemLineTotal(item: Pick<SplitItemInput, 'quantity' | 'unitPriceMinor'>): Minor {
  return item.quantity * item.unitPriceMinor;
}

/**
 * Computes each participant's share of an expense. Pure and deterministic.
 * When ok, the returned shares always sum exactly to `totalMinor`.
 * Error messages avoid currency formatting; callers can use `differenceMinor` to format their own.
 */
export function computeSplit(input: SplitInput): SplitResult {
  const { method, totalMinor } = input;
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    return fail('INVALID_TOTAL', 'Amount must be greater than zero');
  }

  if (method === 'ITEMIZED') return computeItemized(input);

  const participants = input.participants;
  if (participants.length === 0) return fail('NO_PARTICIPANTS', 'Select at least one participant');
  const ids = new Set(participants.map((p) => p.memberId));
  if (ids.size !== participants.length) return fail('DUPLICATE_PARTICIPANT', 'Each participant can only appear once');

  switch (method) {
    case 'EQUAL': {
      const amounts = allocateEqually(totalMinor, participants.length);
      return { ok: true, shares: participants.map((p, i) => ({ memberId: p.memberId, amountMinor: amounts[i]! })) };
    }
    case 'EXACT': {
      for (const p of participants) {
        if (!isNonNegInt(p.value)) return fail('INVALID_VALUE', 'Enter a valid amount for every participant');
      }
      const sum = participants.reduce((a, p) => a + (p.value ?? 0), 0);
      if (sum !== totalMinor) {
        const diff = totalMinor - sum;
        return fail('SUM_MISMATCH', diff > 0 ? 'Exact amounts are less than the total' : 'Exact amounts exceed the total', diff);
      }
      return { ok: true, shares: participants.map((p) => ({ memberId: p.memberId, amountMinor: p.value! })) };
    }
    case 'PERCENTAGE': {
      for (const p of participants) {
        if (!isNonNegInt(p.value) || p.value > FULL_PERCENT_BPS) {
          return fail('INVALID_VALUE', 'Enter a percentage between 0 and 100 for every participant');
        }
      }
      const sum = participants.reduce((a, p) => a + (p.value ?? 0), 0);
      if (sum !== FULL_PERCENT_BPS) {
        return fail('SUM_MISMATCH', `Percentages must add up to 100% (currently ${(sum / 100).toFixed(2)}%)`);
      }
      const amounts = allocateProportionally(totalMinor, participants.map((p) => p.value!));
      return { ok: true, shares: participants.map((p, i) => ({ memberId: p.memberId, amountMinor: amounts[i]! })) };
    }
    case 'SHARES': {
      for (const p of participants) {
        if (!isNonNegInt(p.value)) return fail('INVALID_VALUE', 'Enter a valid number of shares for every participant');
      }
      const sum = participants.reduce((a, p) => a + (p.value ?? 0), 0);
      if (sum === 0) return fail('ZERO_WEIGHTS', 'At least one participant must have more than zero shares');
      const amounts = allocateProportionally(totalMinor, participants.map((p) => p.value!));
      return { ok: true, shares: participants.map((p, i) => ({ memberId: p.memberId, amountMinor: amounts[i]! })) };
    }
    default:
      return fail('INVALID_VALUE', 'Unknown split method');
  }
}

function computeItemized(input: SplitInput): SplitResult {
  const items = input.items ?? [];
  if (items.length === 0) return fail('INVALID_ITEM', 'Add at least one item');
  const tax = input.adjustments?.taxMinor ?? 0;
  const service = input.adjustments?.serviceMinor ?? 0;
  const discount = input.adjustments?.discountMinor ?? 0;
  if (![tax, service, discount].every(isNonNegInt)) {
    return fail('INVALID_ADJUSTMENT', 'Tax, service and discount must be zero or positive');
  }

  // Participant order is the order of first appearance across items (deterministic).
  const order: string[] = [];
  const itemTotals = new Map<string, number>();
  let itemsSubtotal = 0;

  for (const [index, item] of items.entries()) {
    const label = item.description.trim() || `Item ${index + 1}`;
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) return fail('INVALID_ITEM', `${label}: quantity must be at least 1`);
    if (!isNonNegInt(item.unitPriceMinor)) return fail('INVALID_ITEM', `${label}: enter a valid price`);
    if (item.memberIds.length === 0) return fail('INVALID_ITEM', `${label}: assign it to at least one person`);
    if (new Set(item.memberIds).size !== item.memberIds.length) return fail('INVALID_ITEM', `${label}: duplicate participant`);
    const line = itemLineTotal(item);
    if (!Number.isSafeInteger(line)) return fail('INVALID_ITEM', `${label}: amount is too large`);
    itemsSubtotal += line;
    const perPerson = allocateEqually(line, item.memberIds.length);
    item.memberIds.forEach((id, i) => {
      if (!itemTotals.has(id)) {
        order.push(id);
        itemTotals.set(id, 0);
      }
      itemTotals.set(id, itemTotals.get(id)! + perPerson[i]!);
    });
  }

  if (itemsSubtotal === 0 && (tax > 0 || service > 0 || discount > 0)) {
    return fail('INVALID_ADJUSTMENT', 'Adjustments need at least one priced item to be allocated');
  }
  if (discount > itemsSubtotal + tax + service) return fail('INVALID_ADJUSTMENT', 'Discount cannot exceed the bill');
  const computedTotal = itemsSubtotal + tax + service - discount;
  if (computedTotal !== input.totalMinor) {
    return fail('SUM_MISMATCH', 'Items and adjustments do not add up to the expense amount', input.totalMinor - computedTotal);
  }

  // Tax, service and discount are allocated in proportion to each person's item subtotal.
  const weights = order.map((id) => itemTotals.get(id)!);
  const taxAlloc = allocateProportionally(tax, weights);
  const serviceAlloc = allocateProportionally(service, weights);
  const discountAlloc = allocateProportionally(discount, weights);

  const itemized: ItemizedBreakdown[] = order.map((memberId, i) => {
    const itemsMinor = weights[i]!;
    const t = taxAlloc[i]!;
    const s = serviceAlloc[i]!;
    const d = discountAlloc[i]!;
    return { memberId, itemsMinor, taxMinor: t, serviceMinor: s, discountMinor: d, totalMinor: itemsMinor + t + s - d };
  });

  return { ok: true, shares: itemized.map((b) => ({ memberId: b.memberId, amountMinor: b.totalMinor })), itemized };
}

export interface PayerInput {
  memberId: string;
  amountMinor: Minor;
}

export type PayerValidation = { ok: true } | { ok: false; error: string; differenceMinor?: Minor };

/** Payer contributions must be positive, unique per member, and sum exactly to the expense total. */
export function validatePayers(totalMinor: Minor, payers: readonly PayerInput[]): PayerValidation {
  if (payers.length === 0) return { ok: false, error: 'Select who paid' };
  if (new Set(payers.map((p) => p.memberId)).size !== payers.length) {
    return { ok: false, error: 'Each payer can only appear once' };
  }
  for (const p of payers) {
    if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) {
      return { ok: false, error: 'Each payer must have contributed a positive amount' };
    }
  }
  const sum = payers.reduce((a, p) => a + p.amountMinor, 0);
  if (sum !== totalMinor) {
    const diff = totalMinor - sum;
    return {
      ok: false,
      error: diff > 0 ? 'Payer contributions are less than the total' : 'Payer contributions exceed the total',
      differenceMinor: diff,
    };
  }
  return { ok: true };
}
