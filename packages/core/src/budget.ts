import { type Minor } from './money';

export type BudgetState = 'NORMAL' | 'APPROACHING' | 'EXCEEDED';

export interface BudgetStatus {
  budgetMinor: Minor;
  spentMinor: Minor;
  remainingMinor: Minor;
  /** Percentage used, in basis points (10000 = 100%). Integer, rounded down. */
  usedBps: number;
  state: BudgetState;
}

/**
 * Budget status from recorded spending only. Settlements between members are repayments,
 * not group spending, and must never be included in `spentMinor`.
 */
export function computeBudgetStatus(budgetMinor: Minor, spentMinor: Minor, warningThresholdPct: number): BudgetStatus {
  if (!Number.isSafeInteger(budgetMinor) || budgetMinor <= 0) throw new Error('Budget must be positive');
  if (!Number.isSafeInteger(spentMinor) || spentMinor < 0) throw new Error('Spending must be non-negative');
  const usedBps = Number((BigInt(spentMinor) * 10_000n) / BigInt(budgetMinor));
  const state: BudgetState =
    spentMinor > budgetMinor ? 'EXCEEDED' : usedBps >= warningThresholdPct * 100 ? 'APPROACHING' : 'NORMAL';
  return { budgetMinor, spentMinor, remainingMinor: budgetMinor - spentMinor, usedBps, state };
}

/** True when the state moved to a more severe level (used to trigger one-off warnings). */
export function budgetStateWorsened(before: BudgetState, after: BudgetState): boolean {
  const rank: Record<BudgetState, number> = { NORMAL: 0, APPROACHING: 1, EXCEEDED: 2 };
  return rank[after] > rank[before];
}
