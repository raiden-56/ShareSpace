import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { buildTheme, chartPalette } from '../../../theme/theme';
import { assignColors, foldSeries, OTHER_KEY } from '../fold';
import { CategoryBreakdownChart, SpendingOverTimeChart } from '../Charts';

const theme = buildTheme('light', true);

describe('foldSeries', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k, i) => ({ key: k, label: k.toUpperCase(), amountMinor: (i + 1) * 100 }));

  it('keeps the six largest rows in descending order and folds the rest into Other', () => {
    const folded = foldSeries(rows, 6);
    expect(folded.map((r) => r.key)).toEqual(['h', 'g', 'f', 'e', 'd', 'c', OTHER_KEY]);
    const other = folded[6]!;
    expect(other).toMatchObject({ isOther: true, count: 2, amountMinor: 300, label: 'Other (2)' });
    expect(folded.reduce((a, r) => a + r.amountMinor, 0)).toBe(rows.reduce((a, r) => a + r.amountMinor, 0));
  });

  it('does not add an Other row when everything fits and drops zero rows', () => {
    const folded = foldSeries([{ key: 'x', label: 'X', amountMinor: 0 }, { key: 'y', label: 'Y', amountMinor: 5 }]);
    expect(folded).toEqual([{ key: 'y', label: 'Y', amountMinor: 5, isOther: false, count: 1 }]);
  });

  it('breaks ties deterministically by label', () => {
    const folded = foldSeries([{ key: 'b', label: 'Beta', amountMinor: 1 }, { key: 'a', label: 'Alpha', amountMinor: 1 }]);
    expect(folded.map((r) => r.key)).toEqual(['a', 'b']);
  });
});

describe('assignColors', () => {
  it('assigns palette slots in fixed key order (never by rank) and neutral beyond the palette', () => {
    const keys = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'];
    const colors = assignColors(keys, chartPalette.light, chartPalette.other.light);
    expect(colors.get('k1')).toBe(chartPalette.light[0]);
    expect(colors.get('k6')).toBe(chartPalette.light[5]);
    expect(colors.get('k7')).toBe(chartPalette.other.light);
    // Removing a series does not repaint the survivors when the key order is kept stable.
    const filtered = assignColors(keys, chartPalette.light, chartPalette.other.light);
    expect(filtered.get('k3')).toBe(colors.get('k3'));
  });
});

describe('chart table view', () => {
  it('shows every category as a table row after toggling "View as table"', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={theme}>
        <CategoryBreakdownChart
          currency="INR"
          rows={[
            { key: 'food', label: 'Food', amountMinor: 150000 },
            { key: 'transport', label: 'Transport', amountMinor: 50000 },
          ]}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: /Largest: Food at ₹1,500.00/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View as table' }));
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('Food')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('₹1,500.00')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View as chart' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders an honest empty state instead of a chart when there is no spending', () => {
    render(
      <ThemeProvider theme={theme}>
        <SpendingOverTimeChart currency="INR" granularity="day" buckets={[{ key: '2026-01-01', amountMinor: 0 }]} />
      </ThemeProvider>,
    );
    expect(screen.getByText('No expenses recorded in this period.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View as table' })).not.toBeInTheDocument();
  });
});
