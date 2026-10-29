import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { occurrenceDate } from '@sharespace/core';
import type { ExpenseDetail, ExpenseSummary } from '../../../api/types';
import { formatDate, todayLocal } from '../../../lib/format';
import { ExpenseForm } from '../ExpenseForm';
import { defaultInitial } from '../ExpenseDialog';
import { ExpenseRow } from '../ExpenseRow';
import { initialFromExpense } from '../splitModel';
import { groupFixture, renderWithApp } from './testUtils';

function setup() {
  const onSubmit = vi.fn();
  const { wrapper } = renderWithApp(
    <>
      <ExpenseForm formId="f" group={groupFixture} plans={[]} initial={defaultInitial(groupFixture)} onSubmit={onSubmit} />
      <button type="submit" form="f">
        Save
      </button>
    </>,
  );
  render(wrapper);
  return { onSubmit, user: userEvent.setup() };
}

const amountInput = () => screen.getByRole('textbox', { name: /^Amount/ });

describe('split by adjustment', () => {
  it('previews equal shares plus each extra amount, and rejects adjustments over the total', async () => {
    const { user } = setup();
    await user.type(amountInput(), '100');
    await user.click(screen.getByRole('button', { name: /^Adjustment/ }));
    expect(screen.getByText(/add extra amounts for anyone who should pay more/)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Extra amount for Bob' }), '30');
    // ₹70 split three ways (23.34 / 23.33 / 23.33), with Bob's ₹30 on top.
    expect(screen.getByTestId('share-m1')).toHaveTextContent('₹23.34');
    expect(screen.getByTestId('share-m2')).toHaveTextContent('₹53.33');
    expect(screen.getByTestId('share-m3')).toHaveTextContent('₹23.33');
    expect(screen.getByText('Split adds up to ₹100.00.')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Extra amount for Chen' }), '80');
    expect(screen.getByText('Adjustments are ₹10.00 more than the total.')).toBeInTheDocument();
  });

  it('submits each adjustment in minor units (blank = 0)', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByRole('textbox', { name: /What was it for/ }), 'Pizza');
    await user.type(amountInput(), '100');
    await user.click(screen.getByRole('button', { name: /^Adjustment/ }));
    await user.type(screen.getByRole('textbox', { name: 'Extra amount for Bob' }), '30.50');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].split).toEqual({
      method: 'ADJUSTMENT',
      participants: [
        { memberId: 'm1', value: 0 },
        { memberId: 'm2', value: 3050 },
        { memberId: 'm3', value: 0 },
      ],
    });
  });

  it('loads saved adjustments back into the form when editing', () => {
    const expense = {
      title: 'Pizza',
      originalAmountMinor: 10000,
      originalCurrency: 'INR',
      fxRate: null,
      date: '2026-10-01',
      category: 'food',
      planId: null,
      notes: null,
      splitMethod: 'ADJUSTMENT',
      repeatInterval: 'NONE',
      payers: [{ memberId: 'm1', amountMinor: 10000, originalAmountMinor: 10000 }],
      shares: [
        { memberId: 'm1', amountMinor: 4000, originalAmountMinor: 4000, inputValue: 0 },
        { memberId: 'm2', amountMinor: 6000, originalAmountMinor: 6000, inputValue: 2000 },
      ],
      items: [],
      adjustments: { taxMinor: 0, serviceMinor: 0, discountMinor: 0 },
    } as unknown as ExpenseDetail;
    const initial = initialFromExpense(expense);
    expect(initial.split.method).toBe('ADJUSTMENT');
    expect(initial.split.adjustment).toEqual({ m2: '20.00' });
    expect(initial.basics.repeat).toBe('NONE');
  });
});

describe('repeating expenses in the form', () => {
  it('defaults to one-off and submits repeat: NONE', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByRole('textbox', { name: /What was it for/ }), 'Lunch');
    await user.type(amountInput(), '50');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].repeat).toBe('NONE');
  });

  it('shows when the next repeat is added and submits the schedule', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByRole('textbox', { name: /What was it for/ }), 'Rent');
    await user.type(amountInput(), '15000');
    await user.click(screen.getByRole('combobox', { name: 'Repeat' }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Every month' }));
    const next = formatDate(occurrenceDate(todayLocal(), 'MONTHLY', 1));
    expect(screen.getByText(new RegExp(`Next added on ${next}\\.`))).toBeInTheDocument();
    expect(screen.getByText(/added automatically the next time someone opens ShareSpace/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].repeat).toBe('MONTHLY');
  });
});

function summary(overrides: Partial<ExpenseSummary>): ExpenseSummary {
  return {
    id: 'e1',
    groupId: 'g1',
    title: 'Dinner',
    amountMinor: 30000,
    currency: 'INR',
    originalAmountMinor: 30000,
    originalCurrency: 'INR',
    fxRate: null,
    date: '2026-10-01',
    category: 'food',
    splitMethod: 'EQUAL',
    repeatInterval: 'NONE',
    repeatNextDate: null,
    recurringSourceId: null,
    planId: null,
    payers: [{ memberId: 'm1', amountMinor: 30000 }],
    shares: [
      { memberId: 'm1', amountMinor: 10000 },
      { memberId: 'm2', amountMinor: 10000 },
      { memberId: 'm3', amountMinor: 10000 },
    ],
    createdById: 'user-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    version: 1,
    commentCount: 0,
    attachmentCount: 0,
    ...overrides,
  };
}

function renderRow(expense: ExpenseSummary) {
  const { wrapper } = renderWithApp(<ExpenseRow expense={expense} myMemberId="m1" memberName={(id) => ({ m1: 'Alice', m2: 'Bob', m3: 'Chen' })[id] ?? '?'} categoryName={() => 'Food'} />);
  return render(wrapper);
}

describe('expense rows from the viewer’s side', () => {
  it('says how much you lent when you paid more than your share', () => {
    renderRow(summary({}));
    expect(screen.getByText('You lent ₹200.00')).toBeInTheDocument();
  });

  it('says how much you borrowed when someone else paid for you', () => {
    renderRow(summary({ payers: [{ memberId: 'm2', amountMinor: 30000 }] }));
    expect(screen.getByText('You borrowed ₹100.00')).toBeInTheDocument();
  });

  it('distinguishes not involved from paying exactly your share', () => {
    const { unmount } = renderRow(summary({ payers: [{ memberId: 'm2', amountMinor: 30000 }], shares: [{ memberId: 'm2', amountMinor: 15000 }, { memberId: 'm3', amountMinor: 15000 }] }));
    expect(screen.getByText('Not involved')).toBeInTheDocument();
    unmount();
    renderRow(summary({ payers: [{ memberId: 'm1', amountMinor: 10000 }, { memberId: 'm2', amountMinor: 20000 }] }));
    expect(screen.getByText('You paid your share')).toBeInTheDocument();
  });

  it('marks repeating expenses and the copies added from them', () => {
    const { unmount } = renderRow(summary({ repeatInterval: 'MONTHLY', repeatNextDate: '2026-11-01' }));
    expect(screen.getByText('Repeats monthly')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAccessibleName(/Repeats monthly/);
    unmount();
    renderRow(summary({ id: 'e2', recurringSourceId: 'e1' }));
    expect(screen.getByText('Added automatically')).toBeInTheDocument();
  });
});
