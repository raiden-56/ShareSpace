import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import { DEFAULT_PREFERENCES } from '@sharespace/core';
import { api } from '../../../api/api';
import type { ChecklistItem, Poll } from '../../../api/types';
import { makeStore } from '../../../store';
import { buildTheme } from '../../../theme/theme';
import { ChecklistView } from '../Checklist';
import { PollCardView } from '../PollCard';
import { isPastPlan, planBudgetStatus, sortPlans } from '../planUtils';

function renderUi(ui: ReactElement) {
  const store = makeStore();
  // Seed the session so no request is made from tests.
  void store.dispatch(
    api.util.upsertQueryData('me', undefined, {
      user: { id: 'u1', email: 'a@example.com', name: 'Asha', avatarColor: '#386641', createdAt: '2026-01-01T00:00:00.000Z' },
      preferences: DEFAULT_PREFERENCES,
    }),
  );
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <ThemeProvider theme={buildTheme('light', true)}>{ui}</ThemeProvider>
      </MemoryRouter>
    </Provider>,
  );
}

const basePoll: Poll = {
  id: 'p1',
  groupId: 'g1',
  planId: null,
  question: 'Where should we go?',
  closesAt: null,
  closedAt: null,
  allowVoteChange: true,
  createdById: 'u2',
  createdAt: '2026-10-01T10:00:00.000Z',
  eligibleMemberIds: [],
  totalVotes: 4,
  options: [
    { id: 'o1', label: 'Goa', votes: 3 },
    { id: 'o2', label: 'Gokarna', votes: 1 },
  ],
  myVote: null,
  canVote: true,
  isEligible: true,
};

describe('PollCardView', () => {
  it('enables voting only after an option is selected and submits that option', async () => {
    const onVote = vi.fn();
    renderUi(<PollCardView poll={basePoll} canClose={false} onVote={onVote} onRetract={vi.fn()} onClose={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Where should we go?' });
    const vote = screen.getByRole('button', { name: 'Vote' });
    expect(vote).toBeDisabled();
    await userEvent.click(within(group).getByRole('radio', { name: 'Gokarna' }));
    expect(vote).toBeEnabled();
    await userEvent.click(vote);
    expect(onVote).toHaveBeenCalledWith('o2');
  });

  it('shows results as counts and percentages in text', () => {
    renderUi(<PollCardView poll={basePoll} canClose={false} onVote={vi.fn()} onRetract={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('poll-result-o1')).toHaveTextContent('3 votes · 75%');
    expect(screen.getByTestId('poll-result-o2')).toHaveTextContent('1 vote · 25%');
    expect(screen.getByText('4 votes')).toBeInTheDocument();
  });

  it('offers change and retract when the user has voted', () => {
    renderUi(<PollCardView poll={{ ...basePoll, myVote: 'o1' }} canClose={false} onVote={vi.fn()} onRetract={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Change vote' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retract vote' })).toBeEnabled();
    expect(screen.getByText('Your vote')).toBeInTheDocument();
  });

  it('disables voting on a closed poll and states the outcome', () => {
    renderUi(
      <PollCardView
        poll={{ ...basePoll, closedAt: '2026-10-02T10:00:00.000Z', canVote: false }}
        canClose
        onVote={vi.fn()}
        onRetract={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Vote' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close poll' })).not.toBeInTheDocument();
    expect(screen.getByText('Decision: Goa (3 votes)')).toBeInTheDocument();
  });

  it('reports ties and tells ineligible members they cannot vote', () => {
    const tie = { ...basePoll, closedAt: '2026-10-02T10:00:00.000Z', canVote: false, options: [{ id: 'o1', label: 'Goa', votes: 2 }, { id: 'o2', label: 'Gokarna', votes: 2 }] };
    const { unmount } = renderUi(<PollCardView poll={tie} canClose={false} onVote={vi.fn()} onRetract={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Tie between Goa and Gokarna (2 votes each)')).toBeInTheDocument();
    unmount();
    renderUi(<PollCardView poll={{ ...basePoll, canVote: false, isEligible: false }} canClose={false} onVote={vi.fn()} onRetract={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/not eligible to vote/i)).toBeInTheDocument();
  });
});

const items: ChecklistItem[] = [
  { id: 'c1', position: 0, title: 'Book hotel', assigneeMemberId: 'm1', dueDate: '2026-10-01', completedAt: null, completedById: null },
  { id: 'c2', position: 1, title: 'Buy tickets', assigneeMemberId: null, dueDate: '2026-12-01', completedAt: null, completedById: null },
  { id: 'c3', position: 2, title: 'Confirm restaurant', assigneeMemberId: null, dueDate: null, completedAt: '2026-10-20T08:00:00.000Z', completedById: 'u1' },
];

function renderChecklist(overrides: Partial<Parameters<typeof ChecklistView>[0]> = {}) {
  const props = {
    items,
    members: [{ id: 'm1', displayName: 'Asha' }],
    memberName: (id: string) => (id === 'm1' ? 'Asha' : 'Someone'),
    userName: (id: string) => (id === 'u1' ? 'Asha' : 'A member'),
    canEdit: true,
    today: '2026-10-29',
    onToggle: vi.fn(),
    onAdd: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  renderUi(<ChecklistView {...props} />);
  return props;
}

describe('ChecklistView', () => {
  it('filters tasks and shows counts', async () => {
    renderChecklist();
    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open (2)' }));
    expect(screen.getByText('Book hotel')).toBeInTheDocument();
    expect(screen.queryByText('Confirm restaurant')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done (1)' }));
    expect(screen.getByText('Confirm restaurant')).toBeInTheDocument();
    expect(screen.queryByText('Book hotel')).not.toBeInTheDocument();
  });

  it('toggles completion and shows who completed a task', async () => {
    const props = renderChecklist();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark "Buy tickets" as done' }));
    expect(props.onToggle).toHaveBeenCalledWith(items[1], true);
    expect(screen.getByText('Completed by Asha · 20 Oct 2026')).toBeInTheDocument();
  });

  it('marks overdue tasks with text, not colour alone', () => {
    renderChecklist();
    expect(screen.getByText('Overdue · was due 01 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Due 01 Dec 2026')).toBeInTheDocument();
  });

  it('validates and submits new tasks', async () => {
    const props = renderChecklist();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Enter a task')).toBeInTheDocument();
    expect(props.onAdd).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('New task'), 'Pack essentials');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(props.onAdd).toHaveBeenCalledWith({ title: 'Pack essentials', assigneeMemberId: null, dueDate: null });
  });

  it('is read-only for viewers', () => {
    renderChecklist({ canEdit: false });
    expect(screen.queryByLabelText('New task')).not.toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });
});

describe('plan helpers', () => {
  const plan = (id: string, startDate: string, status: 'PLANNING' | 'COMPLETED' = 'PLANNING', endDate: string | null = null) => ({ id, title: id, startDate, endDate, status });

  it('orders upcoming plans first and past plans after', () => {
    const sorted = sortPlans([plan('past', '2026-01-01'), plan('later', '2026-12-01'), plan('soon', '2026-11-01'), plan('done', '2026-11-15', 'COMPLETED')], '2026-10-29');
    expect(sorted.map((p) => p.id)).toEqual(['soon', 'later', 'done', 'past']);
    expect(isPastPlan(plan('ongoing', '2026-10-20', 'PLANNING', '2026-11-02'), '2026-10-29')).toBe(false);
  });

  it('computes estimated-vs-actual status only when an estimate exists', () => {
    expect(planBudgetStatus({ estimatedBudgetMinor: null, actualSpendingMinor: 500 })).toBeNull();
    expect(planBudgetStatus({ estimatedBudgetMinor: 10000, actualSpendingMinor: 8500 })?.state).toBe('APPROACHING');
    expect(planBudgetStatus({ estimatedBudgetMinor: 10000, actualSpendingMinor: 12000 })?.state).toBe('EXCEEDED');
  });
});
