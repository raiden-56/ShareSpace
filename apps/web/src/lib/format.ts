import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from 'date-fns';
import { DEFAULT_PREFERENCES, formatMoney as coreFormatMoney, getCurrency, minorToDecimalString, type Preferences } from '@sharespace/core';

export { coreFormatMoney as formatMoney };

/** Formats a date-only ISO string (YYYY-MM-DD) or timestamp using the user's preferred format. */
export function formatDate(value: string | null | undefined, pattern: Preferences['dateFormat'] = DEFAULT_PREFERENCES.dateFormat): string {
  if (!value) return '';
  const d = value.length === 10 ? parseISO(`${value}T00:00:00`) : parseISO(value);
  if (Number.isNaN(d.getTime())) return value;
  return format(d, pattern);
}

export function formatDateTime(value: string, pattern: Preferences['dateFormat'] = DEFAULT_PREFERENCES.dateFormat): string {
  const d = parseISO(value);
  return `${format(d, pattern)}, ${format(d, 'HH:mm')}`;
}

/** "Today", "Yesterday", or the formatted date. */
export function formatRelativeDay(value: string, pattern: Preferences['dateFormat'] = DEFAULT_PREFERENCES.dateFormat): string {
  const d = value.length === 10 ? parseISO(`${value}T00:00:00`) : parseISO(value);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, pattern);
}

export function timeAgo(value: string): string {
  return `${formatDistanceToNowStrict(parseISO(value))} ago`;
}

/** Local calendar date as YYYY-MM-DD (not UTC, so "today" matches the user's wall clock). */
export function todayLocal(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function addDaysLocal(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return format(d, 'yyyy-MM-dd');
}

/** Minor units → editable decimal string ("1234.50"), used to prefill amount inputs. */
export function minorToInput(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return '';
  return minorToDecimalString(minor, getCurrency(currency).decimals);
}

/** Basis points → editable percent string ("33.33"). */
export function bpsToInput(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.?0+$/, '');
}

/** Hundredths of a share → editable string ("1.5"). */
export function sharesToInput(hundredths: number): string {
  return (hundredths / 100).toFixed(2).replace(/\.?0+$/, '');
}

/** Parses a non-negative decimal with up to `decimals` places into an integer scaled by 10^decimals. */
export function parseScaled(input: string, decimals: number): number | null {
  const cleaned = input.trim().replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{0,${decimals}}))?$`).exec(cleaned);
  if (!match) return null;
  const value = Number(match[1]) * 10 ** decimals + Number((match[2] ?? '').padEnd(decimals, '0') || '0');
  return Number.isSafeInteger(value) ? value : null;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')).toUpperCase();
}
