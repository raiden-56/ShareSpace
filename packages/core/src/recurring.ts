/** How often a repeating expense is added again. NONE = a one-off expense. */
export const REPEAT_INTERVALS = ['NONE', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type RepeatInterval = (typeof REPEAT_INTERVALS)[number];

export const REPEAT_LABELS: Record<RepeatInterval, string> = {
  NONE: 'Does not repeat',
  WEEKLY: 'Every week',
  FORTNIGHTLY: 'Every 2 weeks',
  MONTHLY: 'Every month',
  QUARTERLY: 'Every 3 months',
  YEARLY: 'Every year',
};

/** Safety cap so a long-dormant series cannot create an unbounded number of expenses in one go. */
export const MAX_OCCURRENCES_PER_SYNC = 60;

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { y, m, d };
};
const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Date of the n-th repeat (n = 1 is the first repeat after `startDate`), as YYYY-MM-DD.
 * Always computed from the start date, so a series starting on the 31st falls on the last day of
 * shorter months and returns to the 31st afterwards (Jan 31 → Feb 28 → Mar 31).
 */
export function occurrenceDate(startDate: string, interval: RepeatInterval, n: number): string {
  if (interval === 'NONE') throw new Error('A non-repeating expense has no occurrences');
  const { y, m, d } = parse(startDate);
  if (interval === 'WEEKLY' || interval === 'FORTNIGHTLY') {
    const date = new Date(Date.UTC(y, m - 1, d + n * (interval === 'WEEKLY' ? 7 : 14)));
    return date.toISOString().slice(0, 10);
  }
  const months = n * (interval === 'MONTHLY' ? 1 : interval === 'QUARTERLY' ? 3 : 12);
  const total = (m - 1) + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

/**
 * Repeats that are due on or before `today`, starting after the `done` repeats already created.
 * Returns at most MAX_OCCURRENCES_PER_SYNC entries; `next` is the first repeat still in the future
 * (or the next one to create, when the cap was hit).
 */
export function dueOccurrences(
  startDate: string,
  interval: RepeatInterval,
  done: number,
  today: string,
): { due: { n: number; date: string }[]; next: { n: number; date: string } | null } {
  if (interval === 'NONE') return { due: [], next: null };
  const due: { n: number; date: string }[] = [];
  let n = done + 1;
  for (;;) {
    const date = occurrenceDate(startDate, interval, n);
    if (date > today || due.length >= MAX_OCCURRENCES_PER_SYNC) return { due, next: { n, date } };
    due.push({ n, date });
    n++;
  }
}
