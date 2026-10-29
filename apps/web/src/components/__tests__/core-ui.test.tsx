import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { api } from '../../api/api';
import { openSettleDialog, setCreateGroupOpen } from '../../store/ui';
import { groupFixture, renderWithApp } from '../expenses/__tests__/testUtils';
import { CreateGroupDialog } from '../groups/CreateGroupDialog';
import { draftsValid } from '../groups/GroupFields';
import { SettleDialog } from '../settlements/SettleDialog';
import { EmptyState, ErrorState } from '../common/States';
import { BalanceLabel } from '../common/Money';
import { ExpenseListSkeleton, GroupCardSkeleton } from '../common/Skeletons';

describe('group creation', () => {
  it('requires a group name and validates member emails', async () => {
    const user = userEvent.setup();
    const { store, wrapper } = renderWithApp(<CreateGroupDialog />);
    render(wrapper);
    store.dispatch(setCreateGroupOpen(true));
    const dialog = await screen.findByRole('dialog', { name: 'Create a group' });

    await user.click(within(dialog).getByRole('button', { name: 'Create group' }));
    expect(await within(dialog).findByText('Give your group a name')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: /Shared home/ }));
    expect(within(dialog).getByRole('radio', { name: /Shared home/ })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(dialog).getByRole('button', { name: 'Add person' }));
    await user.type(within(dialog).getByLabelText('Email (optional)'), 'not-an-email');
    expect(within(dialog).getByText('Enter a valid email')).toBeInTheDocument();
  });

  it('accepts placeholder members without email and rejects the creator’s own email', () => {
    expect(draftsValid([{ displayName: 'Bob', email: '' }])).toBe(true);
    expect(draftsValid([{ displayName: '', email: '' }])).toBe(false);
    expect(draftsValid([{ displayName: 'Me', email: 'alice@example.com' }], 'alice@example.com')).toBe(false);
  });
});

describe('settlement confirmation', () => {
  function setup() {
    const { store, wrapper } = renderWithApp(<SettleDialog />);
    store.dispatch(api.util.upsertQueryData('group', 'g1', groupFixture));
    store.dispatch(
      api.util.upsertQueryData('balances', 'g1', {
        currency: 'INR',
        totalSpendingMinor: 30000,
        balances: [
          { memberId: 'm1', paidMinor: 30000, shareMinor: 10000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0, netMinor: 20000 },
          { memberId: 'm2', paidMinor: 0, shareMinor: 10000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0, netMinor: -10000 },
          { memberId: 'm3', paidMinor: 0, shareMinor: 10000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0, netMinor: -10000 },
        ],
        suggestions: [
          { fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 10000 },
          { fromMemberId: 'm3', toMemberId: 'm1', amountMinor: 10000 },
        ],
      }),
    );
    render(wrapper);
    store.dispatch(openSettleDialog({ groupId: 'g1', fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 10000 }));
    return store;
  }

  it('prefills the suggestion and previews the remaining balances for a partial payment', async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await screen.findByRole('dialog', { name: 'Record a repayment' });
    const amount = within(dialog).getByLabelText('Amount paid');
    await waitFor(() => expect(amount).toHaveValue('100.00'));
    expect(within(dialog).getByText(/does not move money/)).toBeInTheDocument();

    await user.clear(amount);
    await user.type(amount, '40');
    expect(within(dialog).getByText(/Bob owes ₹60.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Alice is owed ₹160.00/)).toBeInTheDocument();
  });

  it('warns before recording more than the payer owes', async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await screen.findByRole('dialog', { name: 'Record a repayment' });
    const amount = within(dialog).getByLabelText('Amount paid');
    await waitFor(() => expect(amount).toHaveValue('100.00'));
    await user.clear(amount);
    await user.type(amount, '150');
    expect(within(dialog).getByText(/more than Bob owes/)).toBeInTheDocument();
  });

  it('rejects an invalid amount without submitting', async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await screen.findByRole('dialog', { name: 'Record a repayment' });
    const amount = within(dialog).getByLabelText('Amount paid');
    await waitFor(() => expect(amount).toHaveValue('100.00'));
    await user.clear(amount);
    await user.type(amount, '1.234');
    await user.click(within(dialog).getByRole('button', { name: 'Record repayment' }));
    expect(within(dialog).getByText('Enter a valid positive amount')).toBeInTheDocument();
  });
});

describe('states', () => {
  it('renders empty states with a next action', () => {
    const { wrapper } = renderWithApp(<EmptyState icon={null} title="No expenses yet" action={<button type="button">Add expense</button>} />);
    render(wrapper);
    expect(screen.getByText('No expenses yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeInTheDocument();
  });

  it('maps a 404 to a non-revealing message and network failures to a retry', async () => {
    const user = userEvent.setup();
    let retried = 0;
    const { wrapper } = renderWithApp(
      <>
        <ErrorState error={{ status: 404, data: { error: { message: 'Group not found' } } }} />
        <ErrorState error={{ status: 'FETCH_ERROR', error: 'TypeError' }} onRetry={() => retried++} />
      </>,
    );
    render(wrapper);
    expect(screen.getByText('It may have been removed, or you may not have access to it.')).toBeInTheDocument();
    expect(screen.getByText(/Could not reach ShareSpace/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retried).toBe(1);
  });

  it('marks loading skeletons as busy for assistive technology', () => {
    const { wrapper } = renderWithApp(
      <>
        <ExpenseListSkeleton />
        <GroupCardSkeleton />
      </>,
    );
    render(wrapper);
    expect(screen.getByLabelText('Loading expenses')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Loading groups')).toHaveAttribute('aria-busy', 'true');
  });

  it('describes balances in words, not colour alone', () => {
    const { wrapper } = renderWithApp(
      <>
        <BalanceLabel netMinor={-2500} currency="INR" />
        <BalanceLabel netMinor={0} currency="INR" name="Bob" />
      </>,
    );
    render(wrapper);
    expect(screen.getByText('You owe')).toBeInTheDocument();
    expect(screen.getByText('₹25.00')).toBeInTheDocument();
    expect(screen.getByText('Settled up')).toBeInTheDocument();
  });
});
