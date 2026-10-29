import { Fragment, type ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import type { ExpenseSummary } from '../../api/types';
import { useFormat } from '../../hooks/useAuth';

/** Renders expense rows, with day headers when the list is sorted by date. */
export function ExpenseList({ items, byDay, renderRow }: { items: ExpenseSummary[]; byDay: boolean; renderRow: (e: ExpenseSummary) => ReactNode }) {
  const fmt = useFormat();
  if (!byDay) {
    return (
      <Stack component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} divider={<Box component="li" aria-hidden sx={{ borderTop: 1, borderColor: 'divider' }} />}>
        {items.map((e) => (
          <Box component="li" key={e.id}>
            {renderRow(e)}
          </Box>
        ))}
      </Stack>
    );
  }
  const days: { date: string; rows: ExpenseSummary[] }[] = [];
  for (const e of items) {
    const last = days[days.length - 1];
    if (last && last.date === e.date) last.rows.push(e);
    else days.push({ date: e.date, rows: [e] });
  }
  return (
    <Box>
      {days.map((d, i) => (
        <Fragment key={`${d.date}-${i}`}>
          <Typography variant="overline" component="h3" sx={{ display: 'block', mt: i === 0 ? 0 : 2, mb: 0.25 }}>
            {fmt.day(d.date)}
          </Typography>
          <Stack component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} divider={<Box component="li" aria-hidden sx={{ borderTop: 1, borderColor: 'divider' }} />}>
            {d.rows.map((e) => (
              <Box component="li" key={e.id}>
                {renderRow(e)}
              </Box>
            ))}
          </Stack>
        </Fragment>
      ))}
    </Box>
  );
}
