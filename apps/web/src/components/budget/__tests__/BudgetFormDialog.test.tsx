import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { makeStore } from '../../../store';
import { buildTheme } from '../../../theme/theme';
import { BudgetFormDialog, budgetFormSchema, toBudgetInput } from '../BudgetFormDialog';

function renderDialog(onSubmitValues = vi.fn()) {
  render(
    <Provider store={makeStore()}>
      <MemoryRouter>
        <ThemeProvider theme={buildTheme('light', true)}>
          <BudgetFormDialog open onClose={() => undefined} groupId="g1" currency="INR" existing={null} categories={[{ id: 'food', label: 'Food' }]} onSubmitValues={onSubmitValues} />
        </ThemeProvider>
      </MemoryRouter>
    </Provider>,
  );
  return onSubmitValues;
}

describe('BudgetFormDialog', () => {
  it('shows validation messages for an invalid amount and threshold', async () => {
    const user = userEvent.setup();
    const onSubmit = renderDialog();
    await user.type(screen.getByLabelText(/Total budget/), '12.345');
    const threshold = screen.getByLabelText('Warn when spending reaches');
    await user.clear(threshold);
    await user.type(threshold, '5');
    await user.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(await screen.findByText(/Enter a total budget greater than zero with at most 2 decimal places/)).toBeInTheDocument();
    expect(screen.getByText('Warning threshold must be a whole number between 10 and 100')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits exact minor units', async () => {
    const user = userEvent.setup();
    const onSubmit = renderDialog();
    await user.type(screen.getByLabelText(/Total budget/), '25,000.50');
    await user.click(screen.getByRole('button', { name: 'Save budget' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ totalMinor: 2500050, startDate: null, endDate: null, warningThresholdPct: 80, categories: [] });
  });
});

describe('budgetFormSchema', () => {
  it('rejects an end date before the start date and duplicate categories', () => {
    const result = budgetFormSchema('INR').safeParse({
      total: '100',
      startDate: '2026-05-10',
      endDate: '2026-05-01',
      threshold: '80',
      categories: [
        { category: 'food', amount: '10' },
        { category: 'food', amount: '20' },
      ],
    });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).toContain('End date must be on or after the start date');
    expect(messages).toContain('Each category can only have one budget');
  });

  it('converts category amounts to minor units', () => {
    expect(toBudgetInput({ total: '100', startDate: '', endDate: '', threshold: '75', categories: [{ category: 'food', amount: '0.01' }] }, 'INR')).toEqual({
      totalMinor: 10000,
      startDate: null,
      endDate: null,
      warningThresholdPct: 75,
      categories: [{ category: 'food', amountMinor: 1 }],
    });
  });
});
