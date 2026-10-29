import { allocateProportionally } from './allocate';
import { assertMinor, type Minor } from './money';

const RATE_PATTERN = /^(\d{1,9})(?:\.(\d{1,10}))?$/;

/** Parses a positive decimal exchange-rate string into an exact rational (numerator / denominator). */
export function parseRate(rate: string): { num: bigint; den: bigint } | null {
  const match = RATE_PATTERN.exec(rate.trim());
  if (!match) return null;
  const frac = match[2] ?? '';
  const num = BigInt((match[1] ?? '0') + frac);
  if (num === 0n) return null;
  return { num, den: 10n ** BigInt(frac.length) };
}

/**
 * Converts an amount between currencies using a manually supplied rate
 * (1 unit of source currency = `rate` units of target currency).
 * Rounds half away from zero to the target currency's minor unit.
 */
export function convertMinor(amountMinor: Minor, fromDecimals: number, toDecimals: number, rate: string): Minor {
  assertMinor(amountMinor);
  const parsed = parseRate(rate);
  if (!parsed) throw new Error('Invalid exchange rate');
  const sign = amountMinor < 0 ? -1n : 1n;
  const abs = BigInt(Math.abs(amountMinor));
  // target_minor = abs * rate * 10^toDecimals / 10^fromDecimals
  const numerator = abs * parsed.num * 10n ** BigInt(toDecimals);
  const denominator = parsed.den * 10n ** BigInt(fromDecimals);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  const result = Number(rounded * sign);
  assertMinor(result, 'converted amount');
  return result;
}

/**
 * Converts component amounts (payer contributions or shares) that sum to an original total
 * so that the converted components sum exactly to the converted total.
 */
export function convertComponents(components: readonly Minor[], convertedTotal: Minor): Minor[] {
  return allocateProportionally(convertedTotal, components);
}
