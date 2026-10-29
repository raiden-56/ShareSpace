import { assertMinor, type Minor } from './money';

/**
 * Split `total` minor units proportionally to non-negative integer `weights`
 * using the largest-remainder method.
 *
 * Rounding policy (documented and deterministic):
 * 1. Each recipient first receives floor(total * weight / sumWeights).
 * 2. The leftover minor units (always fewer than the number of recipients) are handed out
 *    one at a time to recipients with the largest fractional remainder.
 * 3. Ties are broken by input order (earlier recipients first).
 *
 * The result always sums exactly to `total`. Money is never created or lost.
 * Negative totals are supported (allocated by magnitude, sign restored).
 */
export function allocateProportionally(total: Minor, weights: readonly number[]): Minor[] {
  assertMinor(total, 'total');
  if (weights.length === 0) {
    if (total === 0) return [];
    throw new Error('Cannot allocate a non-zero amount to no recipients');
  }
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) throw new Error('Weights must be non-negative integers');
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    if (total === 0) return weights.map(() => 0);
    throw new Error('Cannot allocate using weights that sum to zero');
  }

  const sign = total < 0 ? -1n : 1n;
  const magnitude = BigInt(Math.abs(total));
  const W = BigInt(weightSum);

  const base: bigint[] = [];
  const remainders: { index: number; rem: bigint }[] = [];
  let allocated = 0n;
  weights.forEach((w, index) => {
    const product = magnitude * BigInt(w);
    const share = product / W;
    base.push(share);
    remainders.push({ index, rem: product % W });
    allocated += share;
  });

  let leftover = magnitude - allocated;
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const { index } of remainders) {
    if (leftover === 0n) break;
    base[index] = (base[index] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return base.map((v) => Number(v * sign));
}

/** Equal split: indivisible minor units go to the earliest recipients in input order. */
export function allocateEqually(total: Minor, count: number): Minor[] {
  if (!Number.isInteger(count) || count < 0) throw new Error('count must be a non-negative integer');
  return allocateProportionally(total, Array.from({ length: count }, () => 1));
}
