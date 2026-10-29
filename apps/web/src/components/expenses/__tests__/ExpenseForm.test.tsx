import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpenseForm } from '../ExpenseForm';
import { defaultInitial } from '../ExpenseDialog';
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

describe('ExpenseForm', () => {
  it('shows each participant’s equal share before saving', async () => {
    const { user } = setup();
    await user.type(amountInput(), '100');
    expect(screen.getByTestId('share-m1')).toHaveTextContent('₹33.34');
    expect(screen.getByTestId('share-m2')).toHaveTextContent('₹33.33');
    expect(screen.getByTestId('share-m3')).toHaveTextContent('₹33.33');
    expect(screen.getByText('Split adds up to ₹100.00.')).toBeInTheDocument();
  });

  it('switches methods and validates that percentages total 100%', async () => {
    const { user } = setup();
    await user.type(amountInput(), '100');
    await user.click(screen.getByRole('button', { name: /^Percent/ }));
    // Switching prefills an even split the user can adjust.
    expect(screen.getByRole('textbox', { name: 'Percentage for Alice' })).toHaveValue('33.34');
    const bob = screen.getByRole('textbox', { name: 'Percentage for Bob' });
    await user.clear(bob);
    await user.type(bob, '30');
    expect(screen.getByText(/Percentages must add up to 100% \(currently 96\.67%\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Shares/ }));
    expect(screen.getByRole('textbox', { name: 'Shares for Alice' })).toHaveValue('1');
    expect(screen.getByTestId('share-m1')).toHaveTextContent('₹33.34');
  });

  it('flags multiple payers whose contributions do not match the total', async () => {
    const { user } = setup();
    await user.type(amountInput(), '4000');
    await user.click(screen.getByRole('switch', { name: 'Multiple payers' }));
    const alice = screen.getByRole('textbox', { name: 'Amount paid by Alice' });
    expect(alice).toHaveValue('4000.00');
    await user.clear(alice);
    await user.type(alice, '3000');
    expect(screen.getByText('₹1,000.00 left to assign to payers.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Amount paid by Bob' }), '1000');
    expect(screen.getByText('Payer contributions add up to the total.')).toBeInTheDocument();
  });

  it('submits integer minor units with the chosen split', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByRole('textbox', { name: /What was it for/ }), 'Dinner');
    await user.type(amountInput(), '300.01');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload] = onSubmit.mock.calls[0]!;
    expect(payload).toMatchObject({
      title: 'Dinner',
      amountMinor: 30001,
      currency: 'INR',
      payers: [{ memberId: 'm1', amountMinor: 30001 }],
      split: { method: 'EQUAL', participants: [{ memberId: 'm1' }, { memberId: 'm2' }, { memberId: 'm3' }] },
    });
  });

  it('does not submit an invalid split', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByRole('textbox', { name: /What was it for/ }), 'Taxi');
    await user.type(amountInput(), '10');
    await user.click(screen.getByRole('button', { name: /^Exact/ }));
    await user.type(screen.getByRole('textbox', { name: 'Amount for Alice' }), '4');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('₹6.00 left to assign.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
