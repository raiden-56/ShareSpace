import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/api';
import type { BalancesResponse, GroupDetail, Member } from '../../api/types';
import { setCreateGroupOpen } from '../../store/ui';
import { groupFixture, renderWithApp } from '../expenses/__tests__/testUtils';
import { CreateGroupDialog } from '../groups/CreateGroupDialog';
import { SIMPLIFY_EXPLANATION } from '../groups/SimplifyDebts';
import GroupSettings from '../../pages/group/GroupSettings';
import GroupBalances from '../../pages/group/GroupBalances';
import GroupMembers from '../../pages/group/GroupMembers';
import GroupLayout from '../../pages/group/GroupLayout';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Captures API requests. jsdom's AbortSignal is not accepted by Node's Request, so requests are
 * built without it, and relative "/api" URLs are resolved against the test page.
 */
function stubApi(handler: (call: Call) => Response | undefined): Call[] {
  const NodeRequest = globalThis.Request;
  class TestRequest extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _signal, ...rest } = init ?? {};
      super(typeof input === 'string' ? new URL(input, location.href) : input, rest);
    }
  }
  vi.stubGlobal('Request', TestRequest);
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const text = req.method === 'GET' ? '' : await req.clone().text();
      const call = { method: req.method, path: new URL(req.url).pathname, body: text ? JSON.parse(text) : undefined };
      calls.push(call);
      return handler(call) ?? json({ error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);
    }),
  );
  return calls;
}

const withGroup = (patch: Partial<GroupDetail['group']>, rest: Partial<GroupDetail> = {}): GroupDetail => ({
  ...groupFixture,
  ...rest,
  group: { ...groupFixture.group, ...patch },
});

const balances = (simplifyDebts: boolean): BalancesResponse => ({
  currency: 'INR',
  totalSpendingMinor: 12000,
  simplifyDebts,
  balances: [
    { memberId: 'm1', paidMinor: 6000, shareMinor: 0, settlementsPaidMinor: 0, settlementsReceivedMinor: 0, netMinor: 6000 },
    { memberId: 'm2', paidMinor: 6000, shareMinor: 6000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0, netMinor: 0 },
    { memberId: 'm3', paidMinor: 0, shareMinor: 6000, settlementsPaidMinor: 0, settlementsReceivedMinor: 0, netMinor: -6000 },
  ],
  suggestions: simplifyDebts
    ? [{ fromMemberId: 'm3', toMemberId: 'm1', amountMinor: 6000 }]
    : [
        { fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 6000 },
        { fromMemberId: 'm3', toMemberId: 'm2', amountMinor: 6000 },
      ],
});

function renderGroupPage(path: string, element: React.ReactNode, detail: GroupDetail, seed?: BalancesResponse) {
  const { store, wrapper } = renderWithApp(
    <Routes>
      <Route path="/groups/:groupId" element={<GroupLayout />}>
        <Route path={path} element={element} />
      </Route>
    </Routes>,
    { route: `/groups/g1/${path}` },
  );
  store.dispatch(api.util.upsertQueryData('group', 'g1', detail));
  if (seed) store.dispatch(api.util.upsertQueryData('balances', 'g1', seed));
  render(wrapper);
  return store;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('simplify debts setting', () => {
  it('explains the current mode and saves a change only after the server confirms', async () => {
    const user = userEvent.setup();
    let current = withGroup({ simplifyDebts: true });
    const calls = stubApi((c) => {
      if (c.method === 'PATCH' && c.path === '/api/groups/g1') {
        current = withGroup({ simplifyDebts: (c.body as { simplifyDebts: boolean }).simplifyDebts });
        return json({ group: { id: 'g1' } });
      }
      if (c.method === 'GET' && c.path === '/api/groups/g1') return json(current);
      return undefined;
    });
    const store = renderGroupPage('settings', <GroupSettings />, current);

    const toggle = await screen.findByRole('switch', { name: /Simplify debts/ });
    expect(toggle).toBeChecked();
    expect(screen.getByText(SIMPLIFY_EXPLANATION.on)).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ simplifyDebts: false });
    expect(await screen.findByText(SIMPLIFY_EXPLANATION.off)).toBeInTheDocument();
    await waitFor(() => expect(store.getState().ui.toast?.message).toBe('Debts now stay between the people who owe them'));
  });

  it('shows the server error and keeps the setting when saving fails', async () => {
    const user = userEvent.setup();
    const detail = withGroup({ simplifyDebts: true });
    stubApi((c) =>
      c.method === 'PATCH'
        ? json({ error: { message: 'Only the owner and admins can change group settings.' } }, 403)
        : c.path === '/api/groups/g1'
          ? json(detail)
          : undefined,
    );
    const store = renderGroupPage('settings', <GroupSettings />, detail);
    await user.click(await screen.findByRole('switch', { name: /Simplify debts/ }));
    expect(await screen.findByText('Only the owner and admins can change group settings.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Simplify debts/ })).toBeChecked();
    expect(store.getState().ui.toast).toBeFalsy();
  });

  it('is read-only for members who cannot manage settings', async () => {
    stubApi(() => undefined);
    renderGroupPage('settings', <GroupSettings />, withGroup({ simplifyDebts: false }, { role: 'MEMBER' }));
    expect(await screen.findByText(SIMPLIFY_EXPLANATION.off)).toBeInTheDocument();
    expect(screen.getByText(/Currently off/)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Simplify debts/ })).not.toBeInTheDocument();
  });

  it('is part of the create-group payload', async () => {
    const user = userEvent.setup();
    const calls = stubApi((c) =>
      c.method === 'POST' && c.path === '/api/groups' ? json({ group: { ...groupFixture.group, id: 'g9', name: 'Flat' }, invitations: [] }, 201) : undefined,
    );
    const { store, wrapper } = renderWithApp(<CreateGroupDialog />);
    render(wrapper);
    store.dispatch(setCreateGroupOpen(true));
    const dialog = await screen.findByRole('dialog', { name: 'Create a group' });
    const toggle = within(dialog).getByRole('switch', { name: /Simplify debts/ });
    expect(toggle).toBeChecked();
    await user.type(within(dialog).getByLabelText(/Group name/), 'Flat');
    await user.click(toggle);
    await user.click(within(dialog).getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ name: 'Flat', simplifyDebts: false });
  });
});

describe('balances page', () => {
  const setup = (simplified: boolean, role: GroupDetail['role'] = 'OWNER') => {
    stubApi((c) => (c.path === '/api/groups/g1/settlements' ? json({ settlements: [] }) : undefined));
    renderGroupPage('balances', <GroupBalances />, withGroup({ simplifyDebts: simplified }, { role }), balances(simplified));
  };

  it('says debts are combined and shows the simplified mode', async () => {
    setup(true);
    const box = await screen.findByTestId('balance-mode');
    expect(within(box).getByText('All expenses and repayments in this group are combined, so each person has one balance.')).toBeInTheDocument();
    expect(within(box).getByText('Simplified: fewest repayments')).toBeInTheDocument();
    expect(within(box).getByRole('switch', { name: /Simplify debts/ })).toBeChecked();
    expect(await screen.findByText(/greedy method/)).toBeInTheDocument();
  });

  it('shows who owes whom when simplification is off, read-only for members', async () => {
    setup(false, 'MEMBER');
    const box = await screen.findByTestId('balance-mode');
    expect(within(box).getByText('Who owes whom')).toBeInTheDocument();
    expect(within(box).getByText(SIMPLIFY_EXPLANATION.off)).toBeInTheDocument();
    expect(within(box).queryByRole('switch')).not.toBeInTheDocument();
    expect(await screen.findByText(/Each suggestion is a real debt between two people/)).toBeInTheDocument();
  });
});

describe('expenses with a friend outside any group', () => {
  const friend: Member = {
    id: 'm2',
    displayName: 'Bob',
    email: 'bob@example.com',
    role: 'ADMIN',
    status: 'ACTIVE',
    userId: 'user-2',
    hasAccount: true,
    isYou: false,
    avatarColor: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
  };
  const direct = withGroup(
    { name: 'Alice & Bob', isDirect: true, memberCount: 2 },
    { members: [groupFixture.members[0]!, friend] },
  );

  it('titles the page after the friend and links back to them', async () => {
    stubApi((c) => (c.path === '/api/groups/g1/balances' ? json(balances(true)) : c.path === '/api/groups/g1/invitations' ? json({ invitations: [] }) : undefined));
    renderGroupPage('members', <GroupMembers />, direct);
    expect(await screen.findByRole('heading', { level: 1, name: 'You & Bob' })).toBeInTheDocument();
    expect(screen.getByText('Expenses outside any group')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All balances with Bob/ })).toHaveAttribute('href', `/friends/${encodeURIComponent('u.user-2')}`);
    expect(screen.queryByRole('tab', { name: 'Members' })).not.toBeInTheDocument();
  });

  it('offers no way to add, invite or remove people', async () => {
    const calls = stubApi((c) => (c.path === '/api/groups/g1/balances' ? json(balances(true)) : undefined));
    renderGroupPage('members', <GroupMembers />, direct);
    expect(await screen.findByText(/just between the two of you/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add person' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave group' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/invitations'))).toBe(false);
  });

  it('still offers invitations in a normal group', async () => {
    stubApi((c) => (c.path === '/api/groups/g1/balances' ? json(balances(true)) : c.path === '/api/groups/g1/invitations' ? json({ invitations: [] }) : undefined));
    renderGroupPage('members', <GroupMembers />, withGroup({}));
    expect(await screen.findByRole('button', { name: 'Invite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add person' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Members' })).toBeInTheDocument();
  });
});
