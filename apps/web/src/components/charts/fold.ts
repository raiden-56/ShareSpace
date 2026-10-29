import { format, parseISO } from 'date-fns';
import type { Granularity } from '@sharespace/core';

export interface RankedRow {
  key: string;
  label: string;
  amountMinor: number;
}

export interface FoldedRow extends RankedRow {
  /** True for the aggregated "Other" row. */
  isOther: boolean;
  /** How many original rows this entry stands for. */
  count: number;
}

export const OTHER_KEY = '__other';

/**
 * Keeps the `max` largest rows (ties broken by label so the order is deterministic) and folds the
 * remainder into a single "Other" row. The total is preserved exactly.
 */
export function foldSeries(rows: readonly RankedRow[], max = 6): FoldedRow[] {
  const sorted = [...rows]
    .filter((r) => r.amountMinor !== 0)
    .sort((a, b) => b.amountMinor - a.amountMinor || a.label.localeCompare(b.label));
  if (sorted.length <= max) return sorted.map((r) => ({ ...r, isOther: false, count: 1 }));
  const kept = sorted.slice(0, max).map((r) => ({ ...r, isOther: false, count: 1 }));
  const rest = sorted.slice(max);
  return [
    ...kept,
    {
      key: OTHER_KEY,
      label: `Other (${rest.length})`,
      amountMinor: rest.reduce((a, r) => a + r.amountMinor, 0),
      isOther: true,
      count: rest.length,
    },
  ];
}

/**
 * Assigns categorical colours by an entity's position in a fixed key order (not by its rank),
 * so filtering never repaints the remaining series. Keys beyond the palette get the neutral colour.
 */
export function assignColors(orderedKeys: readonly string[], palette: readonly string[], other: string): Map<string, string> {
  const map = new Map<string, string>();
  orderedKeys.forEach((key, i) => map.set(key, i < palette.length ? palette[i]! : other));
  return map;
}

/** Human label for a time bucket key (YYYY-MM-DD for day/week, YYYY-MM for month). */
export function bucketLabel(key: string, granularity: Granularity, long = false): string {
  if (granularity === 'month') return format(parseISO(`${key}-01`), long ? 'MMMM yyyy' : 'MMM yy');
  const d = parseISO(key);
  if (granularity === 'week') return long ? `Week of ${format(d, 'd MMM yyyy')}` : format(d, 'd MMM');
  return format(d, long ? 'EEE, d MMM yyyy' : 'd MMM');
}

export const GRANULARITY_LABEL: Record<Granularity, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
