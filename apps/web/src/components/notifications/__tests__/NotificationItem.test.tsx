import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { buildTheme } from '../../../theme/theme';
import type { Notification } from '../../../api/types';
import { NotificationItem } from '../NotificationItem';

const base: Notification = {
  id: 'n1',
  type: 'EXPENSE_CREATED',
  title: 'New expense',
  body: 'Alice added "Dinner" (₹900.00) in Goa Trip',
  link: '/groups/g1/expenses/e1',
  groupId: 'g1',
  readAt: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};

function renderItem(n: Notification) {
  const onOpen = vi.fn();
  const onToggleRead = vi.fn();
  render(
    <ThemeProvider theme={buildTheme('light', true)}>
      <ul>
        <NotificationItem notification={n} onOpen={onOpen} onToggleRead={onToggleRead} />
      </ul>
    </ThemeProvider>,
  );
  return { onOpen, onToggleRead };
}

describe('NotificationItem', () => {
  it('announces unread state without relying on colour and marks as read on request', async () => {
    const user = userEvent.setup();
    const { onToggleRead, onOpen } = renderItem(base);
    expect(screen.getByText('Unread:', { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark as read: New expense' }));
    expect(onToggleRead).toHaveBeenCalledWith(base);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the notification when the body is clicked', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderItem(base);
    await user.click(screen.getByText(/Alice added/));
    expect(onOpen).toHaveBeenCalledWith(base);
  });

  it('offers "mark as unread" for read notifications', () => {
    renderItem({ ...base, readAt: new Date().toISOString() });
    expect(screen.queryByText('Unread:', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as unread: New expense' })).toBeInTheDocument();
  });
});
