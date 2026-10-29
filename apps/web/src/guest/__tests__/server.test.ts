import { beforeEach, describe, expect, it } from 'vitest';
import type { FetchArgs } from '@reduxjs/toolkit/query';
import type { BalancesResponse, DashboardResponse, GroupCard, GroupDetail, Paginated, ExpenseSummary } from '../../api/types';
import { handleGuestRequest, resetGuestData } from '../server';

async function call<T>(args: string | FetchArgs): Promise<T> {
  const result = await handleGuestRequest(args);
  if ('error' in result) throw new Error(`${typeof args === 'string' ? args : args.url}: ${JSON.stringify(result.error)}`);
  return result.data as T;
}

describe('guest mode sample API', () => {
  beforeEach(() => resetGuestData());

  it('answers every main screen with data', async () => {
    const { groups } = await call<{ groups: GroupCard[] }>('/groups');
    expect(groups.length).toBeGreaterThanOrEqual(3);
    const dashboard = await call<DashboardResponse>('/dashboard');
    expect(dashboard.recentExpenses.length).toBeGreaterThan(0);
    expect(dashboard.upcomingPlans.length).toBeGreaterThan(0);

    for (const g of groups) {
      const detail = await call<GroupDetail>(`/groups/${g.id}`);
      expect(detail.members.some((m) => m.isYou)).toBe(true);
      const balances = await call<BalancesResponse>(`/groups/${g.id}/balances`);
      expect(balances.balances.reduce((a, b) => a + b.netMinor, 0)).toBe(0);
      const expenses = await call<Paginated<ExpenseSummary>>(`/groups/${g.id}/expenses`);
      expect(expenses.items.length).toBeGreaterThan(0);
      expect((await call<{ items: unknown[] }>(`/groups/${g.id}/activity`)).items.length).toBeGreaterThan(0);
    }

    for (const path of ['/auth/me', '/expenses', '/settlements', '/friends', '/plans', '/reports', '/notifications', '/me/sessions', '/invitations/mine', '/search?q=goa']) {
      await expect(call(path)).resolves.toBeTruthy();
    }
  }, 30_000);

  it('applies writes to the in-memory data', async () => {
    const before = await call<GroupDetail>('/groups/g-trip');
    await call({
      url: '/groups/g-trip/expenses',
      method: 'POST',
      body: {
        clientRequestId: '00000000-0000-4000-8000-000000000000',
        title: 'Trek snacks',
        amountMinor: 150000,
        currency: 'INR',
        date: '2026-01-10',
        category: 'food',
        payers: [{ memberId: 'm-trip-you', amountMinor: 150000 }],
        split: { method: 'EQUAL', participants: [{ memberId: 'm-trip-you' }, { memberId: 'm-trip-priya' }] },
        repeat: 'NONE',
      },
    });
    const after = await call<GroupDetail>('/groups/g-trip');
    expect(after.group.expenseCount).toBe(before.group.expenseCount + 1);
    expect(after.group.myNetMinor).toBe(before.group.myNetMinor + 75000);
  }, 10_000);

  it('returns API-shaped errors and empty answers for unknown endpoints', async () => {
    const missing = await handleGuestRequest('/groups/nope');
    expect('error' in missing && missing.error.status).toBe(404);
    await expect(call('/not/a/real/endpoint')).resolves.toEqual({});
  });
});
