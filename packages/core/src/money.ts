/**
 * Money primitives. All monetary values are integer minor units (e.g. paise for INR).
 * Floating point is never used as the source of truth; it only appears at display time.
 */

export type Minor = number;

export interface CurrencyInfo {
  code: string;
  name: string;
  decimals: number;
  symbol: string;
}

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'INR', name: 'Indian Rupee', decimals: 2, symbol: '₹' },
  { code: 'USD', name: 'US Dollar', decimals: 2, symbol: '$' },
  { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€' },
  { code: 'GBP', name: 'British Pound', decimals: 2, symbol: '£' },
  { code: 'AED', name: 'UAE Dirham', decimals: 2, symbol: 'AED' },
  { code: 'SGD', name: 'Singapore Dollar', decimals: 2, symbol: 'S$' },
  { code: 'AUD', name: 'Australian Dollar', decimals: 2, symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', decimals: 2, symbol: 'C$' },
  { code: 'CHF', name: 'Swiss Franc', decimals: 2, symbol: 'CHF' },
  { code: 'THB', name: 'Thai Baht', decimals: 2, symbol: '฿' },
  { code: 'JPY', name: 'Japanese Yen', decimals: 0, symbol: '¥' },
] as const;

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [string, ...string[]];

export function getCurrency(code: string): CurrencyInfo {
  const found = CURRENCIES.find((c) => c.code === code);
  if (!found) throw new Error(`Unsupported currency: ${code}`);
  return found;
}

export function isSupportedCurrency(code: string): boolean {
  return CURRENCIES.some((c) => c.code === code);
}

export function assertMinor(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of minor units`);
  }
}

export function sumMinor(values: readonly number[]): Minor {
  let total = 0;
  for (const v of values) {
    assertMinor(v);
    total += v;
  }
  assertMinor(total, 'sum');
  return total;
}

/**
 * Parse a user-entered decimal string ("1,234.50") into minor units.
 * Returns null when the input is not a valid non-negative amount with at most `decimals` fraction digits.
 */
export function parseAmountToMinor(input: string, decimals: number): Minor | null {
  const cleaned = input.trim().replace(/[,\s_]/g, '');
  if (cleaned === '') return null;
  const pattern = decimals > 0 ? new RegExp(`^(\\d+)(?:\\.(\\d{0,${decimals}}))?$`) : /^(\d+)$/;
  const match = pattern.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? '0';
  const frac = (match[2] ?? '').padEnd(decimals, '0');
  const minor = Number(BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac === '' ? '0' : frac));
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

/** Exact decimal string for a minor-unit amount, e.g. 123456 (2 dp) -> "1234.56". */
export function minorToDecimalString(minor: Minor, decimals: number): string {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor).toString().padStart(decimals + 1, '0');
  const whole = decimals > 0 ? abs.slice(0, -decimals) : abs;
  const frac = decimals > 0 ? abs.slice(-decimals) : '';
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export interface FormatOptions {
  locale?: string;
  /** Show "+" for positive amounts. */
  signed?: boolean;
  /** Drop the currency symbol. */
  plain?: boolean;
  compact?: boolean;
}

export function formatMoney(minor: Minor, currencyCode: string, options: FormatOptions = {}): string {
  const { decimals } = getCurrency(currencyCode);
  const locale = options.locale ?? (currencyCode === 'INR' ? 'en-IN' : 'en-US');
  const formatter = new Intl.NumberFormat(locale, {
    style: options.plain ? 'decimal' : 'currency',
    currency: currencyCode,
    minimumFractionDigits: options.compact ? 0 : decimals,
    maximumFractionDigits: options.compact ? 1 : decimals,
    notation: options.compact ? 'compact' : 'standard',
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  });
  // Intl accepts exact decimal strings, which avoids float rounding for large values.
  const text = minorToDecimalString(minor, decimals);
  return formatter.format(text as unknown as number);
}
