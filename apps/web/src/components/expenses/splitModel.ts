/**
 * Pure helpers that turn the expense form's text inputs into the integer-minor-unit payloads the
 * core split engine and the API expect. All money maths is delegated to @sharespace/core.
 */
import {
  allocateEqually,
  computeSplit,
  FULL_PERCENT_BPS,
  formatMoney,
  getCurrency,
  parseAmountToMinor,
  validatePayers,
  type ItemizedBreakdown,
  type PayerInput,
  type RepeatInterval,
  type SplitMethod,
  type SplitPayload,
} from '@sharespace/core';
import type { ExpenseDetail } from '../../api/types';
import { bpsToInput, minorToInput, parseScaled, sharesToInput } from '../../lib/format';

export interface ItemDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  memberIds: string[];
}

export interface SplitDraft {
  method: SplitMethod;
  participantIds: string[];
  /** Per-member text inputs, kept separately per method so switching methods never mixes units. */
  exact: Record<string, string>;
  percent: Record<string, string>;
  shares: Record<string, string>;
  /** ADJUSTMENT: extra amount each person pays on top of an equal share (blank = none). */
  adjustment: Record<string, string>;
  items: ItemDraft[];
  tax: string;
  service: string;
  discount: string;
}

export interface PayerDraft {
  multiple: boolean;
  payerId: string;
  amounts: Record<string, string>;
}

export type Tone = 'info' | 'error' | 'success';

export type SplitPreview =
  | { ok: true; shares: { memberId: string; amountMinor: number }[]; itemized?: ItemizedBreakdown[]; split: SplitPayload }
  | { ok: false; tone: Tone; message: string };

export type PayerPreview = { ok: true; payers: PayerInput[] } | { ok: false; tone: Tone; message: string };

let itemSeq = 0;
export function newItem(memberIds: string[] = []): ItemDraft {
  itemSeq += 1;
  return { key: `item-${itemSeq}-${Date.now()}`, description: '', quantity: '1', unitPrice: '', memberIds };
}

export function emptySplitDraft(participantIds: string[]): SplitDraft {
  return {
    method: 'EQUAL',
    participantIds,
    exact: {},
    percent: {},
    shares: Object.fromEntries(participantIds.map((id) => [id, '1'])),
    adjustment: {},
    items: [newItem(participantIds)],
    tax: '',
    service: '',
    discount: '',
  };
}

/** Even percentages (in basis points, remainder to the first people) as editable strings. */
export function evenPercents(ids: string[]): Record<string, string> {
  const bps = allocateEqually(FULL_PERCENT_BPS, ids.length);
  return Object.fromEntries(ids.map((id, i) => [id, bpsToInput(bps[i]!)]));
}

/** Participants in stable member order (the order the server uses for remainder distribution). */
export function orderedParticipants(draft: SplitDraft, memberOrder: string[]): string[] {
  const chosen = new Set(draft.participantIds);
  return memberOrder.filter((id) => chosen.has(id));
}

function parseOptionalAmount(text: string, decimals: number): number | null {
  if (text.trim() === '') return 0;
  return parseAmountToMinor(text, decimals);
}

export function buildSplit(
  draft: SplitDraft,
  totalMinor: number | null,
  currency: string,
  memberOrder: string[],
  nameOf: (id: string) => string,
): SplitPreview {
  if (totalMinor === null || totalMinor <= 0) return { ok: false, tone: 'info', message: 'Enter the amount to see each share.' };
  const { decimals } = getCurrency(currency);
  const money = (m: number) => formatMoney(m, currency);
  const ids = orderedParticipants(draft, memberOrder);

  let participants: { memberId: string; value?: number }[] = [];
  let items: SplitPayload['items'];
  let adjustments: SplitPayload['adjustments'];

  switch (draft.method) {
    case 'EQUAL':
      participants = ids.map((memberId) => ({ memberId }));
      break;
    case 'EXACT':
      for (const id of ids) {
        const v = parseOptionalAmount(draft.exact[id] ?? '', decimals);
        if (v === null) return { ok: false, tone: 'error', message: `Enter a valid amount for ${nameOf(id)} (up to ${decimals} decimal places).` };
        participants.push({ memberId: id, value: v });
      }
      break;
    case 'PERCENTAGE':
      for (const id of ids) {
        const text = draft.percent[id] ?? '';
        const v = text.trim() === '' ? 0 : parseScaled(text, 2);
        if (v === null || v > FULL_PERCENT_BPS) return { ok: false, tone: 'error', message: `Enter a percentage between 0 and 100 for ${nameOf(id)} (up to 2 decimal places).` };
        participants.push({ memberId: id, value: v });
      }
      break;
    case 'SHARES':
      for (const id of ids) {
        const text = draft.shares[id] ?? '';
        const v = text.trim() === '' ? 0 : parseScaled(text, 2);
        if (v === null) return { ok: false, tone: 'error', message: `Enter a valid number of shares for ${nameOf(id)}.` };
        participants.push({ memberId: id, value: v });
      }
      break;
    case 'ADJUSTMENT':
      for (const id of ids) {
        const v = parseOptionalAmount(draft.adjustment[id] ?? '', decimals);
        if (v === null) return { ok: false, tone: 'error', message: `Enter a valid adjustment for ${nameOf(id)} (up to ${decimals} decimal places).` };
        participants.push({ memberId: id, value: v });
      }
      break;
    case 'ITEMIZED': {
      items = [];
      for (const [i, item] of draft.items.entries()) {
        const label = item.description.trim() || `Item ${i + 1}`;
        if (!/^\d+$/.test(item.quantity.trim()) || Number(item.quantity) < 1) {
          return { ok: false, tone: 'error', message: `${label}: quantity must be a whole number of at least 1.` };
        }
        const price = parseAmountToMinor(item.unitPrice, decimals);
        if (price === null) return { ok: false, tone: 'error', message: `${label}: enter a valid price.` };
        if (item.memberIds.length === 0) return { ok: false, tone: 'error', message: `${label}: choose who shared it.` };
        items.push({ description: label, quantity: Number(item.quantity), unitPriceMinor: price, memberIds: memberOrder.filter((m) => item.memberIds.includes(m)) });
      }
      const tax = parseOptionalAmount(draft.tax, decimals);
      const service = parseOptionalAmount(draft.service, decimals);
      const discount = parseOptionalAmount(draft.discount, decimals);
      if (tax === null || service === null || discount === null) return { ok: false, tone: 'error', message: 'Enter valid tax, service and discount amounts.' };
      adjustments = { taxMinor: tax, serviceMinor: service, discountMinor: discount };
      break;
    }
  }

  const result = computeSplit({ method: draft.method, totalMinor, participants, items, adjustments });
  if (!result.ok) {
    const diff = result.differenceMinor;
    if (result.code === 'SUM_MISMATCH' && diff !== undefined) {
      if (draft.method === 'ITEMIZED') {
        return {
          ok: false,
          tone: 'error',
          message: diff > 0 ? `Items and charges are ${money(diff)} less than the amount.` : `Items and charges are ${money(-diff)} more than the amount.`,
        };
      }
      if (draft.method === 'ADJUSTMENT') {
        return { ok: false, tone: 'error', message: `Adjustments are ${money(-diff)} more than the total.` };
      }
      return { ok: false, tone: 'error', message: diff > 0 ? `${money(diff)} left to assign.` : `${money(-diff)} over the total.` };
    }
    return { ok: false, tone: 'error', message: result.error.endsWith('.') ? result.error : `${result.error}.` };
  }

  const split: SplitPayload = {
    method: draft.method,
    participants: draft.method === 'ITEMIZED' ? [] : participants,
    ...(draft.method === 'ITEMIZED' ? { items, adjustments } : {}),
  } as SplitPayload;
  return { ok: true, shares: result.shares, itemized: result.itemized, split };
}

/** Sum of the items and adjustments, used to offer "use items total as the amount". */
export function itemizedTotal(draft: SplitDraft, currency: string): number | null {
  const { decimals } = getCurrency(currency);
  let sum = 0;
  for (const item of draft.items) {
    const price = parseAmountToMinor(item.unitPrice, decimals);
    if (price === null || !/^\d+$/.test(item.quantity.trim())) return null;
    sum += price * Number(item.quantity);
  }
  const tax = parseOptionalAmount(draft.tax, decimals);
  const service = parseOptionalAmount(draft.service, decimals);
  const discount = parseOptionalAmount(draft.discount, decimals);
  if (tax === null || service === null || discount === null) return null;
  const total = sum + tax + service - discount;
  return total > 0 ? total : null;
}

export function buildPayers(draft: PayerDraft, totalMinor: number | null, currency: string, memberOrder: string[], nameOf: (id: string) => string): PayerPreview {
  if (totalMinor === null || totalMinor <= 0) return { ok: false, tone: 'info', message: 'Enter the amount first.' };
  if (!draft.multiple) {
    if (!draft.payerId) return { ok: false, tone: 'error', message: 'Select who paid.' };
    return { ok: true, payers: [{ memberId: draft.payerId, amountMinor: totalMinor }] };
  }
  const { decimals } = getCurrency(currency);
  const payers: PayerInput[] = [];
  for (const id of memberOrder) {
    const text = draft.amounts[id] ?? '';
    if (text.trim() === '') continue;
    const v = parseAmountToMinor(text, decimals);
    if (v === null) return { ok: false, tone: 'error', message: `Enter a valid amount for ${nameOf(id)}.` };
    if (v > 0) payers.push({ memberId: id, amountMinor: v });
  }
  const check = validatePayers(totalMinor, payers);
  if (!check.ok) {
    const diff = check.differenceMinor;
    if (diff !== undefined) {
      const money = formatMoney(Math.abs(diff), currency);
      return { ok: false, tone: 'error', message: diff > 0 ? `${money} left to assign to payers.` : `Payers exceed the total by ${money}.` };
    }
    return { ok: false, tone: 'error', message: check.error.endsWith('.') ? check.error : `${check.error}.` };
  }
  return { ok: true, payers };
}

export interface FormBasics {
  title: string;
  amount: string;
  currency: string;
  fxRate: string;
  date: string;
  category: string;
  planId: string;
  notes: string;
  repeat: RepeatInterval;
}

export interface ExpenseFormInitial {
  basics: FormBasics;
  payers: PayerDraft;
  split: SplitDraft;
}

/** Prefills the form from an existing expense (edit or duplicate). Amounts stay in the original currency. */
export function initialFromExpense(e: ExpenseDetail, overrides: Partial<FormBasics> = {}): ExpenseFormInitial {
  const cur = e.originalCurrency;
  const ids = e.shares.map((s) => s.memberId);
  const split = emptySplitDraft(ids);
  split.method = e.splitMethod;
  for (const s of e.shares) {
    if (s.inputValue === null) continue;
    if (e.splitMethod === 'EXACT') split.exact[s.memberId] = minorToInput(s.inputValue, cur);
    if (e.splitMethod === 'PERCENTAGE') split.percent[s.memberId] = bpsToInput(s.inputValue);
    if (e.splitMethod === 'SHARES') split.shares[s.memberId] = sharesToInput(s.inputValue);
    if (e.splitMethod === 'ADJUSTMENT' && s.inputValue > 0) split.adjustment[s.memberId] = minorToInput(s.inputValue, cur);
  }
  if (e.splitMethod === 'ITEMIZED') {
    split.items = e.items.map((it) => ({ ...newItem(it.memberIds), description: it.description, quantity: String(it.quantity), unitPrice: minorToInput(it.unitPriceMinor, cur) }));
    split.tax = e.adjustments.taxMinor ? minorToInput(e.adjustments.taxMinor, cur) : '';
    split.service = e.adjustments.serviceMinor ? minorToInput(e.adjustments.serviceMinor, cur) : '';
    split.discount = e.adjustments.discountMinor ? minorToInput(e.adjustments.discountMinor, cur) : '';
  }
  return {
    basics: {
      title: e.title,
      amount: minorToInput(e.originalAmountMinor, cur),
      currency: cur,
      fxRate: e.fxRate ?? '',
      date: e.date,
      category: e.category,
      planId: e.planId ?? '',
      notes: e.notes ?? '',
      repeat: e.repeatInterval,
      ...overrides,
    },
    payers: {
      multiple: e.payers.length > 1,
      payerId: e.payers[0]?.memberId ?? '',
      amounts: Object.fromEntries(e.payers.map((p) => [p.memberId, minorToInput(p.originalAmountMinor, cur)])),
    },
    split,
  };
}
