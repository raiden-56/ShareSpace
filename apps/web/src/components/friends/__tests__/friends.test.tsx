import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { api } from '../../../api/api';
import type { Friend, FriendDetailResponse, FriendGroup } from '../../../api/types';
import Friends from '../../../pages/Friends';
import FriendDetail from '../../../pages/FriendDetail';
import { renderWithApp } from '../../expenses/__tests__/testUtils';
import { FriendSettleDialog } from '../FriendSettleDialog';
import { planSettlement } from '../friendLogic';

const group = (id: string, name: string, netMinor: number, extra: Partial<FriendGroup> = {}): FriendGroup => ({
  groupId: id,
  groupName: name,
  currency: 'INR',
  accent: '#386641',
  isDirect: false,
  archived: false,
  role: 'OWNER',
  myMemberId: `${id}-me`,
  theirMemberId: `${id}-them`,
  theirStatus: 'ACTIVE',
  netMinor,
  ...extra,
});

const friend = (key: string, name: string, groups: FriendGroup[], extra: Partial<Friend> = {}): Friend => {
  const net = groups.reduce((a, g) => a + g.netMinor, 0);
  return {
    key,
    name,
    email: null,
    userId: key.startsWith('u.') ? key.slice(2) : null,
    avatarColor: null,
    isPlaceholder: !key.startsWith('u.'),
    balances: net === 0 ? [] : [{ currency: 'INR', netMinor: net }],
    groups,
    directGroupId: null,
    ...extra,
  };
};

// Bob: you owe ₹300 in the trip, he owes you ₹50 in the flat → you owe ₹250 overall.
const bob = friend('u.user-2', 'Bob', [group('trip', 'Trip', -30000), group('flat', 'Flat', 5000)]);
const chen = friend('m.chen', 'Chen', [group('trip', 'Trip', 12000)]);
const dia = friend('u.user-4', 'Dia', [group('flat', 'Flat', 0)]);

describe('friends list', () => {
  function setup() {
    const { store, wrapper } = renderWithApp(<Friends />);
    store.dispatch(api.util.upsertQueryData('friends', undefined, { friends: [bob, chen, dia] }));
    render(wrapper);
  }

  it('states each balance in words and totals what you owe and are owed', async () => {
    setup();
    const list = await screen.findByRole('navigation', { name: 'Friends' });
    const bobRow = within(list).getByRole('link', { name: /Bob/ });
    expect(within(bobRow).getByText('you owe')).toBeInTheDocument();
    expect(within(bobRow).getByText('₹250.00')).toBeInTheDocument();
    expect(within(bobRow).getByText('2 shared groups')).toBeInTheDocument();
    const chenRow = within(list).getByRole('link', { name: /Chen/ });
    expect(within(chenRow).getByText('owes you')).toBeInTheDocument();
    expect(within(chenRow).getByText('Added by name')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: /Dia/ })).toHaveTextContent('Settled up');
    expect(bobRow).toHaveAttribute('href', '/friends/u.user-2');
  });

  it('filters by balance direction and by name', async () => {
    const user = userEvent.setup();
    setup();
    const list = await screen.findByRole('navigation', { name: 'Friends' });
    await user.click(screen.getByRole('button', { name: 'Owe you' }));
    expect(within(list).getAllByRole('link').map((l) => l.textContent)).toEqual([expect.stringContaining('Chen')]);
    await user.click(screen.getByRole('button', { name: 'Settled up' }));
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(within(list).getByRole('link')).toHaveTextContent('Dia');
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByRole('textbox', { name: 'Search friends by name' }), 'bo');
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(within(list).getByRole('link')).toHaveTextContent('Bob');
  });

  it('explains how friends appear when there are none', async () => {
    const { store, wrapper } = renderWithApp(<Friends />);
    store.dispatch(api.util.upsertQueryData('friends', undefined, { friends: [] }));
    render(wrapper);
    expect(await screen.findByText('No friends yet')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create group' }));
    expect(store.getState().ui.createGroupOpen).toBe(true);
  });
});

describe('settle up with a friend', () => {
  it('mirrors the server plan: full settles every group, partial pays the largest debt first', () => {
    expect(planSettlement(bob.groups, 'INR', 25000).map((l) => [l.group.groupId, l.amountMinor, l.theyPay])).toEqual([
      ['trip', 30000, false],
      ['flat', 5000, true],
    ]);
    expect(planSettlement(bob.groups, 'INR', 10000).map((l) => [l.group.groupId, l.amountMinor])).toEqual([['trip', 10000]]);
    expect(planSettlement(bob.groups, 'INR', 25001)).toEqual([]);
  });

  function setup() {
    const { wrapper } = renderWithApp(<FriendSettleDialog open onClose={() => undefined} friend={bob} />);
    render(wrapper);
    return screen.findByRole('dialog', { name: 'Settle up with Bob' });
  }

  it('prefills the full net balance and previews every group it settles', async () => {
    const dialog = await setup();
    expect(within(dialog).getByLabelText('Amount paid')).toHaveValue('250.00');
    expect(within(dialog).getByText('You pay Bob')).toBeInTheDocument();
    expect(within(dialog).getByText(/does not move money/)).toBeInTheDocument();
    const preview = within(dialog).getByRole('region', { name: 'Repayments that will be recorded' });
    expect(preview).toHaveTextContent('You pay Bob ₹300.00 in Trip');
    expect(preview).toHaveTextContent('Bob pays you ₹50.00 in Flat');
    expect(preview).toHaveTextContent('only the net ₹250.00 changes hands');
  });

  it('previews a partial repayment against the largest debt only', async () => {
    const user = userEvent.setup();
    const dialog = await setup();
    const amount = within(dialog).getByLabelText('Amount paid');
    await user.clear(amount);
    await user.type(amount, '100');
    const preview = within(dialog).getByRole('region', { name: 'Repayments that will be recorded' });
    expect(preview).toHaveTextContent('You pay Bob ₹100.00 in Trip');
    expect(preview).not.toHaveTextContent('Flat');
  });

  it('blocks recording more than the outstanding balance', async () => {
    const user = userEvent.setup();
    const dialog = await setup();
    const amount = within(dialog).getByLabelText('Amount paid');
    await user.clear(amount);
    await user.type(amount, '300');
    expect(within(dialog).queryByRole('region', { name: 'Repayments that will be recorded' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Record repayment' }));
    expect(within(dialog).getAllByText(/more than the ₹250.00 outstanding/).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog', { name: 'Settle up with Bob' })).toBeInTheDocument();
  });

  it('keeps rendering once the friend is fully settled (the dialog refreshes while it closes)', async () => {
    const { wrapper } = renderWithApp(<FriendSettleDialog open onClose={() => undefined} friend={dia} />);
    render(wrapper);
    const dialog = await screen.findByRole('dialog', { name: 'Settle up with Dia' });
    expect(within(dialog).getByLabelText('Amount paid')).toHaveValue('');
  });
});

describe('friend page', () => {
  function renderDetail(detail: FriendDetailResponse) {
    const { store, wrapper } = renderWithApp(
      <Routes>
        <Route path="/friends/:friendKey" element={<FriendDetail />} />
      </Routes>,
      { route: `/friends/${encodeURIComponent(detail.friend.key)}` },
    );
    store.dispatch(api.util.upsertQueryData('friend', detail.friend.key, detail));
    render(wrapper);
  }

  it('offers a reminder only when the friend owes you', async () => {
    const owing = friend('u.user-5', 'Eve', [group('flat', 'Flat', 4000)]);
    renderDetail({ friend: owing, expenses: [], settlements: [] });
    expect(await screen.findByRole('button', { name: 'Remind' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settle up' })).toBeEnabled();
  });

  it('hides the reminder when you are the one who owes', async () => {
    renderDetail({ friend: bob, expenses: [], settlements: [] });
    expect(await screen.findByRole('button', { name: 'Settle up' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remind' })).not.toBeInTheDocument();
  });

  it('shows balances per group, your position on shared expenses and repayments in words', async () => {
    renderDetail({
      friend: bob,
      expenses: [
        {
          id: 'e1',
          groupId: 'trip',
          title: 'Hotel',
          amountMinor: 30000,
          currency: 'INR',
          originalAmountMinor: 30000,
          originalCurrency: 'INR',
          fxRate: null,
          date: '2026-10-20',
          category: 'accommodation',
          splitMethod: 'EXACT',
          repeatInterval: 'NONE',
          repeatNextDate: null,
          recurringSourceId: null,
          planId: null,
          payers: [{ memberId: 'trip-them', amountMinor: 30000 }],
          shares: [{ memberId: 'trip-me', amountMinor: 30000 }],
          createdById: 'user-2',
          createdAt: '2026-10-20T00:00:00.000Z',
          updatedAt: '2026-10-20T00:00:00.000Z',
          deletedAt: null,
          version: 1,
          commentCount: 0,
          attachmentCount: 0,
        },
      ],
      settlements: [
        {
          id: 's1',
          groupId: 'flat',
          fromMemberId: 'flat-them',
          toMemberId: 'flat-me',
          amountMinor: 2000,
          currency: 'INR',
          method: 'UPI',
          methodNote: null,
          date: '2026-10-21',
          notes: null,
          status: 'REVERSED',
          recordedById: 'user-1',
          createdAt: '2026-10-21T00:00:00.000Z',
          reversedAt: '2026-10-22T00:00:00.000Z',
          reversedById: 'user-1',
          reversalReason: 'Typo',
        },
      ],
    });
    expect(await screen.findByText('you owe Bob ₹300.00')).toBeInTheDocument();
    expect(screen.getByText('Bob owes you ₹50.00')).toBeInTheDocument();
    expect(screen.getByText('you borrowed')).toBeInTheDocument();
    expect(screen.getByText('Bob paid you ₹20.00')).toBeInTheDocument();
    expect(screen.getByText('Reversed')).toBeInTheDocument();
  });
});
