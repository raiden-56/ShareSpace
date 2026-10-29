import { parseAmountToMinor, type ExpenseQuery } from '@sharespace/core';

/** Filter keys kept in the URL so views are shareable and notification links (e.g. ?deleted=true) work. */
export const FILTER_KEYS = ['from', 'to', 'min', 'max', 'category', 'payer', 'participant', 'plan', 'mine', 'deleted', 'group'] as const;
export const SORTS = [
  { value: 'date', label: 'Date' },
  { value: 'amount', label: 'Amount' },
  { value: 'category', label: 'Category' },
  { value: 'payer', label: 'Payer' },
  { value: 'created', label: 'Recently added' },
] as const;
export const PAGE_SIZE = 25;

type Sort = (typeof SORTS)[number]['value'];

export function activeFilterCount(params: URLSearchParams, ignore: string[] = []): number {
  return FILTER_KEYS.filter((k) => !ignore.includes(k) && params.get(k)).length;
}

export function amountParamError(text: string | null, decimals: number): string | null {
  if (!text) return null;
  return parseAmountToMinor(text, decimals) === null ? 'Enter a valid amount' : null;
}

export type ParsedExpenseQuery = ExpenseQuery & { sort: Sort; order: 'asc' | 'desc'; page: number; pageSize: number };

/** Converts URL params into the API's expense query (amounts become integer minor units). */
export function toExpenseQuery(params: URLSearchParams, decimals: number): ParsedExpenseQuery {
  const sortParam = params.get('sort');
  const sort: Sort = SORTS.some((s) => s.value === sortParam) ? (sortParam as Sort) : 'date';
  const order: 'asc' | 'desc' = params.get('order') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const min = params.get('min') ? parseAmountToMinor(params.get('min')!, decimals) : null;
  const max = params.get('max') ? parseAmountToMinor(params.get('max')!, decimals) : null;
  const iso = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    q: params.get('q') || undefined,
    from: iso(params.get('from')),
    to: iso(params.get('to')),
    minAmount: min ?? undefined,
    maxAmount: max ?? undefined,
    category: params.get('category') || undefined,
    payerId: params.get('payer') || undefined,
    participantId: params.get('participant') || undefined,
    planId: params.get('plan') || undefined,
    involvesMe: params.get('mine') === 'true' ? 'true' : undefined,
    deleted: params.get('deleted') === 'true' ? 'true' : undefined,
    sort,
    order,
    page,
    pageSize: PAGE_SIZE,
  };
}

/** Query string for CSV export: the same filters, without pagination. */
export function exportQueryString(query: ExpenseQuery): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (k === 'page' || k === 'pageSize' || v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
