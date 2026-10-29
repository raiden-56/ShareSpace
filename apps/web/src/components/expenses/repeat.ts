import type { RepeatInterval } from '@sharespace/core';
import type { ExpenseSummary } from '../../api/types';

const SHORT: Record<Exclude<RepeatInterval, 'NONE'>, string> = {
  WEEKLY: 'Repeats weekly',
  FORTNIGHTLY: 'Repeats every 2 weeks',
  MONTHLY: 'Repeats monthly',
  QUARTERLY: 'Repeats every 3 months',
  YEARLY: 'Repeats yearly',
};

/** Short label for list rows: the repeating template, or a copy added from one. Null for one-off expenses. */
export function repeatBadge(expense: Pick<ExpenseSummary, 'repeatInterval' | 'recurringSourceId'>): string | null {
  if (expense.repeatInterval !== 'NONE') return SHORT[expense.repeatInterval];
  if (expense.recurringSourceId) return 'Added automatically';
  return null;
}

export type ViewerPosition =
  | { kind: 'lent'; amountMinor: number }
  | { kind: 'borrowed'; amountMinor: number }
  | { kind: 'even' }
  | { kind: 'uninvolved' };

/** The viewer's position on one expense, like Splitwise: paid more than their share = lent. */
export function viewerPosition(expense: Pick<ExpenseSummary, 'payers' | 'shares'>, myMemberId: string): ViewerPosition {
  const paid = expense.payers.filter((p) => p.memberId === myMemberId).reduce((a, p) => a + p.amountMinor, 0);
  const share = expense.shares.filter((s) => s.memberId === myMemberId).reduce((a, s) => a + s.amountMinor, 0);
  if (paid === 0 && share === 0) return { kind: 'uninvolved' };
  const net = paid - share;
  if (net > 0) return { kind: 'lent', amountMinor: net };
  if (net < 0) return { kind: 'borrowed', amountMinor: -net };
  return { kind: 'even' };
}

export function viewerPositionText(position: ViewerPosition, money: (minor: number) => string): string {
  switch (position.kind) {
    case 'lent':
      return `You lent ${money(position.amountMinor)}`;
    case 'borrowed':
      return `You borrowed ${money(position.amountMinor)}`;
    case 'even':
      return 'You paid your share';
    case 'uninvolved':
      return 'Not involved';
  }
}

/** Theme colour for the position text; the words always carry the meaning too. */
export function viewerPositionColor(position: ViewerPosition): string {
  return position.kind === 'lent' ? 'money.positive' : position.kind === 'borrowed' ? 'money.negative' : 'text.secondary';
}
