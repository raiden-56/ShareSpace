import { computeBudgetStatus, type BudgetStatus } from '@sharespace/core';
import type { PlanSummary } from '../../api/types';
import { todayLocal } from '../../lib/format';

/** Warning threshold for plan estimates (matches the default group budget threshold). */
export const PLAN_BUDGET_WARNING_PCT = 80;

/** A plan is "past" once it is completed/cancelled or its last day is before today. */
export function isPastPlan(plan: Pick<PlanSummary, 'status' | 'startDate' | 'endDate'>, today = todayLocal()): boolean {
  if (plan.status === 'COMPLETED' || plan.status === 'CANCELLED') return true;
  return (plan.endDate ?? plan.startDate) < today;
}

/** Upcoming/ongoing plans first (soonest first), then past plans (most recent first). */
export function sortPlans<T extends Pick<PlanSummary, 'status' | 'startDate' | 'endDate' | 'title'>>(plans: readonly T[], today = todayLocal()): T[] {
  const upcoming = plans.filter((p) => !isPastPlan(p, today)).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
  const past = plans.filter((p) => isPastPlan(p, today)).sort((a, b) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title));
  return [...upcoming, ...past];
}

/** Estimated-vs-actual status, or null when the plan has no estimate. */
export function planBudgetStatus(plan: Pick<PlanSummary, 'estimatedBudgetMinor' | 'actualSpendingMinor'>): BudgetStatus | null {
  if (!plan.estimatedBudgetMinor || plan.estimatedBudgetMinor <= 0) return null;
  return computeBudgetStatus(plan.estimatedBudgetMinor, plan.actualSpendingMinor, PLAN_BUDGET_WARNING_PCT);
}

export function formatDateRange(format: (v: string) => string, start: string, end: string | null): string {
  if (!end || end === start) return format(start);
  return `${format(start)} – ${format(end)}`;
}
