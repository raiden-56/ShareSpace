import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useSearchParams } from 'react-router-dom';
import { DEFAULT_CATEGORIES } from '@sharespace/core';
import { ExpenseFilters } from '../../components/expenses/ExpenseFilters';
import { activeFilterCount, toExpenseQuery } from '../../components/expenses/filterParams';
import { groupFixture, renderWithApp } from '../../components/expenses/__tests__/testUtils';

function Harness() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  return (
    <>
      <ExpenseFilters params={params} onChange={(next) => setParams(next)} categories={[...DEFAULT_CATEGORIES]} members={groupFixture.members} decimals={2} currencySymbol="₹" />
      <output data-testid="search">{location.search}</output>
    </>
  );
}

describe('ExpenseFilters', () => {
  it('writes search and toggles into the URL and resets pagination', async () => {
    const user = userEvent.setup();
    const { wrapper } = renderWithApp(<Harness />, { route: '/expenses?page=3' });
    render(wrapper);
    await user.type(screen.getByRole('textbox', { name: 'Search expenses' }), 'taxi');
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('q=taxi'));
    expect(screen.getByTestId('search')).not.toHaveTextContent('page=');

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(screen.getByRole('switch', { name: 'Show deleted expenses' }));
    expect(screen.getByTestId('search')).toHaveTextContent('deleted=true');
    await user.click(screen.getByRole('switch', { name: 'Only expenses that affect my balance' }));
    expect(screen.getByTestId('search')).toHaveTextContent('mine=true');
    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Sort descending/ }));
    expect(screen.getByTestId('search')).toHaveTextContent('order=asc');
  });

  it('converts URL filters into an API query with minor units', () => {
    const params = new URLSearchParams('min=10.5&max=abc&mine=true&sort=amount&order=asc&page=2&from=2026-01-01');
    expect(toExpenseQuery(params, 2)).toMatchObject({ minAmount: 1050, maxAmount: undefined, involvesMe: 'true', sort: 'amount', order: 'asc', page: 2, from: '2026-01-01' });
    expect(activeFilterCount(params)).toBe(4);
  });
});
